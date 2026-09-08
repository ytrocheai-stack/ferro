import { analyzeAdaptation, type ExerciseAnalysisInput } from '../../packages/adaptation-core/src/index'
import { candidateChangeSchema, parseAnalysisResponse, type AnalysisResponse } from '../../packages/adaptation-core/src/contract'
import { db } from '../db/db'
import type { AdaptationEventJob, AdaptationJob, AdaptationJobErrorCode, AdaptationProposal } from '../db/types'
import {
  ADAPTATION_PROCESSING_LEASE_MS,
  buildAdaptationContext,
  invalidateAdaptationJobInTransaction,
  isRoutineContextCurrent,
  readCurrentAdaptationContext,
} from './adaptationContext'
import { localizeAdaptationJobError } from './adaptationErrors'
import { COACH_CONSENT_VERSION, getCoachConsent, getCoachDeviceId } from './coachConsent'
import { getCoachAccountId, setCoachAccountId } from './coachAccount'
import { uid } from './format'

export { getCoachAccountId, setCoachAccountId }

interface ClaimedAdaptationJob {
  id: string
  ownerId: string
  workoutId: string
  routineId: string
  routineRevision: number
  requestId: string
  contextKey: string
  runId: string
  leaseExpiresAt: number
  createdAt: number
  attempts: number
  payload: NonNullable<AdaptationJob['payload']>
}

function getWorkerUrl(): string | undefined {
  return (import.meta.env.VITE_ADAPTATION_WORKER_URL as string | undefined)?.replace(/\/$/, '')
}

function hasAccreditedContext(job: AdaptationJob): job is AdaptationJob & Required<Pick<AdaptationJob, 'requestId' | 'contextKey' | 'payload'>> {
  return Boolean(job.requestId && job.contextKey && job.payload)
}

async function stalePendingProposalsForWorkout(ownerId: string, workoutId: string): Promise<void> {
  const proposals = await db.adaptationProposals.toArray()
  const stale = proposals
    .filter((proposal) => proposal.ownerId === ownerId && proposal.status === 'pending' && proposal.workoutId === workoutId)
    .map((proposal) => ({ ...proposal, status: 'stale' as const }))
  if (stale.length) await db.adaptationProposals.bulkPut(stale)
}

function canReuseRequest(job: AdaptationJob, context: Awaited<ReturnType<typeof buildAdaptationContext>>, consentAcceptedAt: number): job is AdaptationJob & Required<Pick<AdaptationJob, 'requestId' | 'contextKey' | 'payload'>> {
  return hasAccreditedContext(job) &&
    job.contextKey === context.contextKey &&
    job.payload.deviceId === context.payload.deviceId &&
    job.payload.consentVersion === context.payload.consentVersion &&
    job.createdAt >= consentAcceptedAt
}

async function upsertManualAdaptationJob(workoutId: string, expectedJobId = `adapt-${workoutId}`): Promise<boolean> {
  const ownerId = getCoachAccountId()
  if (!ownerId) return false
  const now = Date.now()
  const consentAcceptedAt = getCoachConsent(ownerId)?.acceptedAt ?? 0
  return db.transaction('rw', [db.workouts, db.routines, db.adaptationJobs, db.adaptationProposals], async () => {
    const workout = await db.workouts.get(workoutId)
    if (!workout?.routineId || workout.routineRevision === undefined) return false
    const existing = await db.adaptationJobs.get(expectedJobId)
    if (existing?.ownerId && existing.ownerId !== ownerId) return false
    if (existing && !existing.ownerId) return false
    const context = await buildAdaptationContext(workout, { consentVersion: COACH_CONSENT_VERSION, deviceId: getCoachDeviceId() })
    const preserve = existing && existing.errorCode !== 'context-invalidated' && canReuseRequest(existing, context, consentAcceptedAt)
    if (existing?.status === 'completed' && preserve) return false
    if (existing && !preserve) await stalePendingProposalsForWorkout(ownerId, workoutId)
    await db.adaptationJobs.put({
      ...existing,
      id: expectedJobId,
      workoutId,
      ownerId,
      requestId: preserve ? existing.requestId : uid(),
      contextKey: preserve ? existing.contextKey : context.contextKey,
      status: 'pending',
      createdAt: preserve ? existing.createdAt : now,
      updatedAt: now,
      attempts: preserve ? existing.attempts ?? 0 : 0,
      analysisId: preserve ? existing.analysisId : undefined,
      lastError: undefined,
      nextRetryAt: undefined,
      payload: preserve ? existing.payload : context.payload,
      errorCode: undefined,
      pendingExplanation: preserve ? existing.pendingExplanation : undefined,
      runId: undefined,
      leaseExpiresAt: undefined,
    })
    return true
  })
}

export async function enqueueAdaptationJob(workoutId: string): Promise<void> {
  if (await upsertManualAdaptationJob(workoutId)) {
    wakeAdaptationProcessor()
    await scheduleAdaptationRetryWake()
  }
}

export async function retryFailedAdaptationJob(jobId: string): Promise<void> {
  const ownerId = getCoachAccountId()
  const job = await db.adaptationJobs.get(jobId)
  if (!ownerId || !job || job.ownerId !== ownerId || job.status !== 'failed') return
  if (await upsertManualAdaptationJob(job.workoutId, jobId)) {
    wakeAdaptationProcessor()
    await scheduleAdaptationRetryWake(ownerId)
  }
}

export async function enqueueAdaptationEvent(event: { analysisId: string; exerciseId: string; candidateId?: string; event: 'accepted' | 'rejected' | 'edited' | 'reverted' }): Promise<void> {
  const ownerId = getCoachAccountId()
  if (!ownerId) return
  await db.adaptationEventJobs.put({ id: `event-${event.analysisId}-${event.exerciseId}-${event.event}-${Date.now()}`, ...event, ownerId, status: 'pending', createdAt: Date.now(), attempts: 0 })
  wakeAdaptationProcessor()
  await scheduleAdaptationRetryWake(ownerId)
}

const WAKE_EVENT = 'nextrep:adaptation-wake'
const CONSENT_EVENT = 'nextrep:coach-consent-changed'

function wakeAdaptationProcessor(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(WAKE_EVENT))
}

type RetryableJob = Pick<AdaptationJob | AdaptationEventJob, 'ownerId' | 'status' | 'nextRetryAt'> & { leaseExpiresAt?: number }

export function nextAdaptationWakeAt(jobs: RetryableJob[], ownerId: string, now = Date.now()): number | undefined {
  return jobs
    .filter((job) => job.ownerId === ownerId && (job.status === 'pending' || job.status === 'processing'))
    .map((job) => {
      const candidates = [
        job.nextRetryAt,
        job.status === 'processing' ? job.leaseExpiresAt : undefined,
      ].filter((value): value is number => value !== undefined && value > now)
      return candidates.length ? Math.min(...candidates) : undefined
    })
    .filter((value): value is number => value !== undefined)
    .reduce<number | undefined>((earliest, retryAt) => earliest === undefined ? retryAt : Math.min(earliest, retryAt), undefined)
}

const retryWakeTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearRetryWake(ownerId: string): void {
  const timer = retryWakeTimers.get(ownerId)
  if (timer !== undefined) clearTimeout(timer)
  retryWakeTimers.delete(ownerId)
}

export async function scheduleAdaptationRetryWake(ownerId = getCoachAccountId()): Promise<void> {
  if (!ownerId) return
  clearRetryWake(ownerId)
  const [jobs, events] = await Promise.all([db.adaptationJobs.toArray(), db.adaptationEventJobs.toArray()])
  const wakeAt = nextAdaptationWakeAt([...jobs, ...events], ownerId)
  if (wakeAt === undefined) return
  const delay = Math.max(0, Math.min(2_147_483_647, wakeAt - Date.now()))
  retryWakeTimers.set(ownerId, setTimeout(() => {
    retryWakeTimers.delete(ownerId)
    wakeAdaptationProcessor()
  }, delay))
}

class ProcessingCancelled extends Error {
  constructor() { super('Procesamiento cancelado') }
}

function assertProcessingActive(userId: string | null | undefined, signal: AbortSignal): void {
  if (signal.aborted || !navigator.onLine || !getCoachConsent(userId)) throw new ProcessingCancelled()
}

function cancelRun(run: { userId: string | null; controller: AbortController } | undefined, userId?: string | null): void {
  if (run && (userId === undefined || run.userId === userId)) run.controller.abort()
}

let eventsRun: { userId: string | null; controller: AbortController; promise: Promise<void> } | undefined
const pendingEventPasses = new Set<string>()
export function processPendingAdaptationEvents(getToken: () => Promise<string | null>, userId?: string | null): Promise<void> {
  const key = userId ?? null
  if (eventsRun?.userId === key) {
    if (key) pendingEventPasses.add(key)
    return eventsRun.promise
  }
  cancelRun(eventsRun)
  const controller = new AbortController()
  const promise = processPendingAdaptationEventsInternal(getToken, userId, controller.signal).finally(async () => {
    if (eventsRun?.promise === promise) eventsRun = undefined
    await scheduleAdaptationRetryWake(userId)
  })
  eventsRun = { userId: key, controller, promise }
  return promise
}

async function processPendingAdaptationEventsInternal(getToken: () => Promise<string | null>, userId: string | null | undefined, signal: AbortSignal): Promise<void> {
  const workerUrl = getWorkerUrl()
  if (!workerUrl || !navigator.onLine || !getCoachConsent(userId)) return
  const token = await getToken()
  if (!token) return
  assertProcessingActive(userId, signal)
  let continuePass = true
  while (continuePass) {
    if (userId) pendingEventPasses.delete(userId)
    const jobs = (await db.adaptationEventJobs.where('status').equals('pending').toArray()).filter((job) => job.ownerId === userId)
    for (const job of jobs) {
      assertProcessingActive(userId, signal)
      if (job.nextRetryAt && job.nextRetryAt > Date.now()) continue
      try {
        const response = await fetch(`${workerUrl}/v1/adaptations/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ analysisId: job.analysisId, exerciseId: job.exerciseId, candidateId: job.candidateId ?? null, event: job.event }), signal })
        if (!response.ok) throw new Error(`Worker ${response.status}`)
        assertProcessingActive(userId, signal)
        await db.adaptationEventJobs.update(job.id, { status: 'sent' })
      } catch (cause) {
        if (cause instanceof ProcessingCancelled || signal.aborted || !getCoachConsent(userId)) return
        const attempts = job.attempts + 1
        await db.adaptationEventJobs.update(job.id, { status: attempts >= 3 ? 'failed' : 'pending', attempts, nextRetryAt: Date.now() + Math.min(60_000, attempts * 10_000) })
      }
      if (userId && pendingEventPasses.has(userId)) break
    }
    const immediate = (await db.adaptationEventJobs.toArray()).some((job) => job.ownerId === userId && job.status === 'pending' && (!job.nextRetryAt || job.nextRetryAt <= Date.now()))
    continuePass = Boolean(userId && (pendingEventPasses.delete(userId) || immediate))
  }
}

function parseCandidate(value: unknown): AdaptationProposal['candidate'] {
  const result = candidateChangeSchema.safeParse(value)
  if (!result.success) throw new Error('El Worker devolvió un candidato inválido')
  return result.data
}

export function parseWorkerAnalysisResponse(value: unknown): AnalysisResponse {
  return parseAnalysisResponse(value)
}

function errorCodeFor(status: number | undefined, message?: string): AdaptationJobErrorCode {
  if (status === 401) return 'session-expired'
  if (status === 403) return 'unauthorized'
  if (status === 429) return 'quota-exhausted'
  if (status === 409) return message?.includes('sigue en curso') ? 'temporary' : 'conflict'
  if (status !== undefined && status >= 400 && status < 500) return 'invalid-response'
  return 'temporary'
}

export function reconcileWorkerAnalysis(response: AnalysisResponse, inputs: ExerciseAnalysisInput[]) {
  const local = analyzeAdaptation(inputs)
  const key = (exercise: { exerciseId: string; occurrenceId?: string }) => `${exercise.exerciseId}:${exercise.occurrenceId ?? 'default'}`
  const expected = new Set(local.decisions.map(key))
  const received = new Set(response.decisions.map(key))
  if (response.decisions.length !== local.decisions.length || received.size !== response.decisions.length || [...expected].some((item) => !received.has(item))) throw new Error('La respuesta no contiene exactamente las ocurrencias solicitadas')
  return response.decisions.map((serverDecision) => {
    const localDecision = local.decisions.find((decision) => serverDecision.occurrenceId ? decision.occurrenceId === serverDecision.occurrenceId : decision.exerciseId === serverDecision.exerciseId)
    if (!localDecision || localDecision.exerciseId !== serverDecision.exerciseId) throw new Error('La respuesta no coincide con los ejercicios solicitados')
    const localById = new Map(localDecision.candidates.map((candidate) => [candidate.candidateId, candidate]))
    const serverCandidates = serverDecision.candidates.map(parseCandidate)
    if (serverDecision.candidates.some((candidate) => { const id = (candidate as { candidateId?: string }).candidateId; return !id || !localById.has(id) })) throw new Error('El Worker devolvió un candidato no permitido')
    const selectedId = serverDecision.selectedCandidateId ?? serverDecision.fallbackCandidateId
    if (!localById.has(selectedId) || !serverDecision.candidates.some((candidate) => (candidate as { candidateId?: string }).candidateId === selectedId)) throw new Error('La selección del Worker no pertenece a la ocurrencia')
    const serverSelected = serverCandidates.find((candidate) => candidate.candidateId === selectedId)
    const localSelected = localById.get(selectedId)!
    if (!serverSelected || JSON.stringify({ previous: serverSelected.previous, next: serverSelected.next, kind: serverSelected.kind, exerciseId: serverSelected.exerciseId, occurrenceId: serverSelected.occurrenceId }) !== JSON.stringify({ previous: localSelected.previous, next: localSelected.next, kind: localSelected.kind, exerciseId: localSelected.exerciseId, occurrenceId: localSelected.occurrenceId })) throw new Error('El Worker modificó un candidato determinista')
    return {
      ...localDecision,
      comparableWorkoutIds: serverDecision.comparableWorkoutIds,
      warnings: [...new Set([...localDecision.warnings, ...serverDecision.warnings])],
      selectedCandidateId: selectedId,
      candidates: localDecision.candidates.map((candidate) => candidate.candidateId === selectedId ? { ...candidate, explanation: serverSelected.explanation, citations: serverSelected.citations ?? [], warnings: [...new Set([...candidate.warnings, ...serverSelected.warnings])] } : candidate),
    }
  })
}

async function claimAdaptationJob(jobId: string, userId: string, signal: AbortSignal): Promise<ClaimedAdaptationJob | undefined> {
  const consent = getCoachConsent(userId)
  if (!consent) return undefined
  return db.transaction('rw', [db.workouts, db.routines, db.adaptationJobs, db.adaptationProposals], async () => {
    const now = Date.now()
    const job = await db.adaptationJobs.get(jobId)
    if (!job || job.ownerId !== userId) return undefined
    const leaseExpiresAt = job.leaseExpiresAt ?? ((job.updatedAt ?? job.createdAt) + ADAPTATION_PROCESSING_LEASE_MS)
    if (job.status !== 'pending' && !(job.status === 'processing' && leaseExpiresAt <= now)) return undefined
    if (!hasAccreditedContext(job) || job.payload.deviceId !== consent.deviceId || job.payload.consentVersion !== consent.version || job.createdAt < consent.acceptedAt) {
      await invalidateAdaptationJobInTransaction(job)
      return undefined
    }
    const current = await readCurrentAdaptationContext(job.workoutId, job.payload)
    if (!current || !isRoutineContextCurrent(current.workout, current.routine) || current.context.contextKey !== job.contextKey) {
      await invalidateAdaptationJobInTransaction(job)
      return undefined
    }
    assertProcessingActive(userId, signal)
    const runId = uid()
    const nextLease = now + ADAPTATION_PROCESSING_LEASE_MS
    await db.adaptationJobs.update(job.id, {
      status: 'processing',
      updatedAt: now,
      runId,
      leaseExpiresAt: nextLease,
    })
    return {
      id: job.id,
      ownerId: userId,
      workoutId: job.workoutId,
      routineId: current.workout.routineId!,
      routineRevision: current.workout.routineRevision!,
      requestId: job.requestId,
      contextKey: job.contextKey,
      runId,
      leaseExpiresAt: nextLease,
      createdAt: job.createdAt,
      attempts: job.attempts ?? 0,
      payload: job.payload,
    }
  })
}

function isPermanentFailure(errorCode: AdaptationJobErrorCode, attempts: number): boolean {
  return attempts >= 3 || errorCode === 'session-expired' || errorCode === 'unauthorized' || errorCode === 'quota-exhausted' || errorCode === 'conflict' || errorCode === 'context-invalidated'
}

async function persistFailureForClaim(claimed: ClaimedAdaptationJob, userId: string, signal: AbortSignal, errorCode: AdaptationJobErrorCode): Promise<void> {
  if (signal.aborted) return
  await db.transaction('rw', [db.workouts, db.routines, db.adaptationJobs, db.adaptationProposals], async () => {
    const job = await db.adaptationJobs.get(claimed.id)
    if (!job || job.ownerId !== claimed.ownerId || job.requestId !== claimed.requestId || job.runId !== claimed.runId || job.contextKey !== claimed.contextKey) return
    const consent = getCoachConsent(userId)
    if (!consent || claimed.payload.deviceId !== consent.deviceId || claimed.payload.consentVersion !== consent.version || job.createdAt < consent.acceptedAt) return
    const current = await readCurrentAdaptationContext(claimed.workoutId, claimed.payload)
    if (!current || !isRoutineContextCurrent(current.workout, current.routine) || current.context.contextKey !== claimed.contextKey) {
      await invalidateAdaptationJobInTransaction(job)
      return
    }
    const attempts = (job.attempts ?? claimed.attempts) + 1
    const failed = isPermanentFailure(errorCode, attempts)
    await db.adaptationJobs.update(job.id, {
      status: failed ? 'failed' : 'pending',
      nextRetryAt: failed ? undefined : Date.now() + Math.min(60_000, attempts * 10_000),
      attempts,
      lastError: localizeAdaptationJobError(errorCode),
      errorCode,
      updatedAt: Date.now(),
      runId: undefined,
      leaseExpiresAt: undefined,
    })
  })
}

async function releaseCancelledClaim(claimed: ClaimedAdaptationJob): Promise<void> {
  await db.transaction('rw', [db.adaptationJobs], async () => {
    const job = await db.adaptationJobs.get(claimed.id)
    if (!job || job.ownerId !== claimed.ownerId || job.requestId !== claimed.requestId || job.contextKey !== claimed.contextKey || job.runId !== claimed.runId) return
    await db.adaptationJobs.update(job.id, { status: 'pending', runId: undefined, leaseExpiresAt: undefined, nextRetryAt: undefined, updatedAt: Date.now() })
  })
}

async function persistSuccessForClaim(
  claimed: ClaimedAdaptationJob,
  userId: string,
  signal: AbortSignal,
  body: AnalysisResponse,
  decisions: ReturnType<typeof reconcileWorkerAnalysis>,
): Promise<void> {
  if (signal.aborted || !getCoachConsent(userId)) throw new ProcessingCancelled()
  await db.transaction('rw', [db.workouts, db.routines, db.adaptationJobs, db.adaptationProposals], async () => {
    const job = await db.adaptationJobs.get(claimed.id)
    if (!job || job.ownerId !== claimed.ownerId || job.requestId !== claimed.requestId || job.runId !== claimed.runId || job.contextKey !== claimed.contextKey) return
    const consent = getCoachConsent(userId)
    if (!consent || claimed.payload.deviceId !== consent.deviceId || claimed.payload.consentVersion !== consent.version || job.createdAt < consent.acceptedAt) return
    const current = await readCurrentAdaptationContext(claimed.workoutId, claimed.payload)
    if (!current || !isRoutineContextCurrent(current.workout, current.routine) || current.context.contextKey !== claimed.contextKey || current.workout.routineId !== claimed.routineId || current.workout.routineRevision !== claimed.routineRevision) {
      await invalidateAdaptationJobInTransaction(job)
      return
    }
    await stalePendingProposalsForWorkout(claimed.ownerId, claimed.workoutId)
    const now = Date.now()
    for (const decision of decisions) {
      const candidates = decision.candidates
      const selected = candidates.find((candidate) => candidate.candidateId === decision.selectedCandidateId) ?? candidates.find((candidate) => candidate.candidateId === decision.fallbackCandidateId) ?? candidates.find((candidate) => candidate.kind === 'maintain') ?? candidates[0]
      if (!selected) continue
      const proposal: AdaptationProposal = {
        id: `${body.analysisId}-${decision.exerciseId}-${decision.occurrenceId ?? 'default'}`,
        ownerId: claimed.ownerId,
        workoutId: claimed.workoutId,
        requestId: claimed.requestId,
        contextKey: claimed.contextKey,
        analysisId: body.analysisId,
        baseRoutineId: claimed.routineId,
        baseRoutineRevision: claimed.routineRevision,
        exerciseId: decision.exerciseId,
        status: 'pending',
        createdAt: now,
        candidateId: selected.candidateId,
        candidate: selected,
        candidateOptions: candidates,
        proposalRevision: 1,
        policyVersion: body.policyVersion,
        corpusVersion: body.corpusVersion ?? 'none',
        previousValues: selected.previous,
        proposedValues: selected.next,
        rule: selected.rule,
        confidence: selected.confidence,
        citations: selected.citations ?? [],
        warnings: selected.warnings,
        selectedModel: body.provider ?? 'deterministic',
        occurrenceId: decision.occurrenceId,
        sources: body.sources,
      }
      await db.adaptationProposals.put(proposal)
    }
    await db.adaptationJobs.update(job.id, {
      status: 'completed',
      analysisId: body.analysisId,
      pendingExplanation: body.pendingExplanation,
      nextRetryAt: undefined,
      lastError: undefined,
      errorCode: undefined,
      updatedAt: now,
      runId: undefined,
      leaseExpiresAt: undefined,
    })
  })
}

let jobsRun: { userId: string | null; controller: AbortController; promise: Promise<void> } | undefined
const pendingJobPasses = new Set<string>()
export function processPendingAdaptationJobs(getToken: () => Promise<string | null>, userId?: string | null): Promise<void> {
  const key = userId ?? null
  if (jobsRun?.userId === key) {
    if (key) pendingJobPasses.add(key)
    return jobsRun.promise
  }
  cancelRun(jobsRun)
  const controller = new AbortController()
  const promise = processPendingAdaptationJobsInternal(getToken, userId, controller.signal).finally(async () => {
    if (jobsRun?.promise === promise) jobsRun = undefined
    await scheduleAdaptationRetryWake(userId)
  })
  jobsRun = { userId: key, controller, promise }
  return promise
}

async function processPendingAdaptationJobsInternal(getToken: () => Promise<string | null>, userId: string | null | undefined, signal: AbortSignal): Promise<void> {
  const workerUrl = getWorkerUrl()
  const consent = getCoachConsent(userId)
  if (!workerUrl || !navigator.onLine || !consent || !userId) return
  let continuePass = true
  while (continuePass) {
    pendingJobPasses.delete(userId)
    const jobs = (await db.adaptationJobs.toArray()).filter((job) => job.ownerId === userId && (
      (job.status === 'pending' && (!job.nextRetryAt || job.nextRetryAt <= Date.now())) ||
      (job.status === 'processing' && (job.leaseExpiresAt ?? ((job.updatedAt ?? job.createdAt) + ADAPTATION_PROCESSING_LEASE_MS)) <= Date.now())
    ))
    for (const candidate of jobs) {
      assertProcessingActive(userId, signal)
      const claimed = await claimAdaptationJob(candidate.id, userId, signal)
      if (!claimed) continue
      const token = await getToken()
      if (!token) {
        await persistFailureForClaim(claimed, userId, signal, 'session-expired')
        return
      }
      assertProcessingActive(userId, signal)
      try {
        const response = await fetch(`${workerUrl}/v1/adaptations/analyze`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': claimed.requestId,
            'X-NextRep-Consent-Version': claimed.payload.consentVersion,
            'X-NextRep-Device-Id': claimed.payload.deviceId,
          },
          body: JSON.stringify({
            inputs: claimed.payload.inputs,
            consentVersion: claimed.payload.consentVersion,
            deviceId: claimed.payload.deviceId,
          }),
          signal,
        })
        const responseText = await response.text()
        if (!response.ok) {
          const cause = new Error(`Worker ${response.status}${responseText ? `: ${responseText}` : ''}`)
          Object.assign(cause, { status: response.status })
          throw cause
        }
        assertProcessingActive(userId, signal)
        let responseValue: unknown
        try {
          responseValue = JSON.parse(responseText)
        } catch {
          throw Object.assign(new Error('El Worker devolvió JSON inválido'), { adaptationCode: 'invalid-response' })
        }
        let body: AnalysisResponse
        let decisions
        try {
          body = parseWorkerAnalysisResponse(responseValue)
          decisions = reconcileWorkerAnalysis(body, claimed.payload.inputs)
        } catch (cause) {
          throw Object.assign(cause instanceof Error ? cause : new Error('Respuesta del Worker inválida'), { adaptationCode: 'invalid-response' })
        }
        await persistSuccessForClaim(claimed, userId, signal, body, decisions)
      } catch (cause) {
        if (cause instanceof ProcessingCancelled || signal.aborted || !getCoachConsent(userId)) {
          await releaseCancelledClaim(claimed)
          return
        }
        const status = (cause as { status?: number }).status
        const message = cause instanceof Error ? cause.message : undefined
        const errorCode = (cause as { adaptationCode?: AdaptationJobErrorCode }).adaptationCode ?? errorCodeFor(status, message)
        await persistFailureForClaim(claimed, userId, signal, errorCode)
      }
      if (pendingJobPasses.has(userId)) break
    }
    const immediate = (await db.adaptationJobs.toArray()).some((job) => job.ownerId === userId && ((job.status === 'pending' && (!job.nextRetryAt || job.nextRetryAt <= Date.now())) || (job.status === 'processing' && (job.leaseExpiresAt ?? ((job.updatedAt ?? job.createdAt) + ADAPTATION_PROCESSING_LEASE_MS)) <= Date.now())))
    continuePass = pendingJobPasses.delete(userId) || immediate
  }
}

export function cancelPendingAdaptationProcessing(userId?: string | null): void {
  cancelRun(jobsRun, userId)
  cancelRun(eventsRun, userId)
  if (userId === undefined || userId === null) {
    pendingJobPasses.clear()
    pendingEventPasses.clear()
    for (const ownerId of [...retryWakeTimers.keys()]) clearRetryWake(ownerId)
  } else {
    pendingJobPasses.delete(userId)
    pendingEventPasses.delete(userId)
    clearRetryWake(userId)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(CONSENT_EVENT, (event) => {
    const userId = (event as CustomEvent<{ userId?: string }>).detail?.userId
    cancelPendingAdaptationProcessing(userId)
  })
}
