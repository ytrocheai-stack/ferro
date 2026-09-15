import { canonicalJson, fnv1a64 } from '../../packages/adaptation-core/src/index'
import { agentDecisionSchema, coachRunRequestSchema, coachRunResponseSchema, coachRunSnapshotEventSchema, COACH_MAX_CONVERSATION_CHARS, COACH_MAX_CONVERSATION_MESSAGES, COACH_MAX_MESSAGE_CHARS, type CoachEvent, type CoachRunRequest, type CoachRunSnapshot, type FutureSession, type ParsedCoachRunRequest } from '../../packages/adaptation-core/src/contract'
import { db } from '../db/db'
import type { CoachMessage, CoachRunRecord, Routine } from '../db/types'
import { getCoachAccountId } from './coachAccount'
import { COACH_CONSENT_VERSION, getCoachConsent, getSelectedCoachConversation, getCoachDeviceId, getCoachProfile, readCoachConsentRecord } from './coachConsent'
import { isRenderableCoachProposal } from './coachPresentation'
import { normalizeRoutine } from './adaptation'
import { uid } from './format'
import { useNutrition } from '../stores/nutrition'
import { withPlannedSetCount } from './routineEditing'

function workerUrl(): string | undefined {
  return (import.meta.env.VITE_ADAPTATION_WORKER_URL as string | undefined)?.replace(/\/$/, '')
}

export function contextVersionFromSnapshot(snapshot: Record<string, unknown>): string {
  const data = { ...snapshot }
  delete data.message
  delete data.conversation
  delete data.conversationVersion
  return `coach-context-${fnv1a64(canonicalJson(data))}`
}
function messageError(message: string): Error { return new Error(message) }

type TransportCoachMessage = Pick<CoachMessage, 'id' | 'role' | 'content' | 'createdAt' | 'contextVersion'> & Partial<Pick<CoachMessage, 'runId'>>

/** Projects local records to the strict wire contract; ownerId never leaves IndexedDB. */
export function projectCoachMessageForTransport(message: CoachMessage): TransportCoachMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.runId ? { runId: message.runId } : {}),
    createdAt: message.createdAt,
    contextVersion: message.contextVersion,
  }
}

function validHistoricalMessage(value: unknown): value is CoachMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<CoachMessage>
  return typeof message.id === 'string' && typeof message.role === 'string' &&
    (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' &&
    message.content.trim().length > 0 && typeof message.createdAt === 'number' && Number.isFinite(message.createdAt) &&
    typeof message.contextVersion === 'string'
}

export function boundConversation(messages: CoachMessage[]): TransportCoachMessage[] {
  const chronological = messages
    .filter(validHistoricalMessage)
    .map((message, index) => ({ message, index }))
    .sort((a, b) => a.message.createdAt - b.message.createdAt || a.index - b.index)
    .map(({ message }) => projectCoachMessageForTransport(message))
    .slice(-COACH_MAX_CONVERSATION_MESSAGES)
  const selected: TransportCoachMessage[] = []
  let remaining = COACH_MAX_CONVERSATION_CHARS
  for (const message of [...chronological].reverse()) {
    if (remaining <= 0) break
    const content = message.content.slice(0, Math.min(COACH_MAX_MESSAGE_CHARS, remaining))
    if (!content) continue
    selected.unshift({ ...message, content })
    remaining -= content.length
  }
  return selected
}

function conversationVersion(messages: Array<{ id: string; role: CoachMessage['role']; content: string; runId?: string; contextVersion: string }>): string {
  return `coach-conversation-${fnv1a64(canonicalJson(messages.map(({ id, role, content, runId, contextVersion }) => ({ id, role, content, runId, contextVersion }))))}`
}

function parseCoachRequest(value: unknown, label = 'Solicitud del coach'): ParsedCoachRunRequest {
  const parsed = coachRunRequestSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? ` en ${issue.path.join('.')}` : ''
    throw messageError(`${label} inválida${path}: ${issue?.message ?? 'revisa los datos enviados'}`)
  }
  const serialized = JSON.stringify(parsed.data)
  if (new TextEncoder().encode(serialized).byteLength > 512 * 1024) throw messageError('El contexto del coach es demasiado grande para enviarlo')
  return parsed.data
}

/** Normalizes legacy queued requests without changing their event identity. */
export function normalizeCoachRequestForTransport(value: unknown): ParsedCoachRunRequest {
  if (!value || typeof value !== 'object') throw messageError('La solicitud pendiente del coach es inválida')
  const source = value as Record<string, unknown>
  const context = source.context && typeof source.context === 'object' ? source.context as Record<string, unknown> : {}
  const rawSnapshot = context.snapshot && typeof context.snapshot === 'object' ? context.snapshot as Record<string, unknown> : {}
  const event = source.event && typeof source.event === 'object' ? source.event as Record<string, unknown> : {}
  const selectedConversationId = typeof event.conversationId === 'string' ? event.conversationId : undefined
  const rawConversation = Array.isArray(rawSnapshot.conversation) ? rawSnapshot.conversation : []
  const conversation = boundConversation(rawConversation.filter((candidate) => {
    if (!validHistoricalMessage(candidate)) return false
    if (!selectedConversationId || !candidate || typeof candidate !== 'object') return false
    const candidateConversationId = (candidate as Partial<CoachMessage>).conversationId
    return candidateConversationId === selectedConversationId
  }))
  const normalizedSnapshot = { ...rawSnapshot, conversation, conversationVersion: conversationVersion(conversation) }
  const version = contextVersionFromSnapshot(normalizedSnapshot)
  return parseCoachRequest({
    ...source,
    event: { ...event, contextVersion: version },
    context: { ...context, version, conversationVersion: conversationVersion(conversation), snapshot: normalizedSnapshot },
  }, 'Solicitud pendiente del coach')
}

export async function buildCoachRequest(message: string, causedByEventId?: string, eventType: CoachEvent['type'] = 'message-sent', options: { eventId?: string; payload?: Record<string, unknown>; conversationId?: string } = {}): Promise<ParsedCoachRunRequest | null> {
  const trimmedMessage = message.trim()
  if (!trimmedMessage) throw messageError('Escribe un mensaje para el coach')
  if (trimmedMessage.length > COACH_MAX_MESSAGE_CHARS) throw messageError(`El mensaje del coach no puede superar ${COACH_MAX_MESSAGE_CHARS} caracteres`)
  const accountId = getCoachAccountId()
  const consent = accountId ? getCoachConsent(accountId) : null
  if (!accountId || !consent) return null
  const [routines, workouts, profile, previousMessages, customExercises, consentRecord] = await Promise.all([
    db.routines.toArray(),
    db.workouts.orderBy('startedAt').reverse().toArray(),
    getCoachProfile(accountId),
    db.coachMessages.where('ownerId').equals(accountId).toArray(),
    db.customExercises.toArray(),
    readCoachConsentRecord(accountId, consent.deviceId),
  ])
  const recentFinished = workouts.filter((workout) => Number.isFinite(workout.endedAt)).slice(0, 6)
  const conversation = options.conversationId
    ? await db.coachConversations.get(options.conversationId).then((value) => {
      if (!value || value.ownerId !== accountId || value.pendingDeletion) throw messageError('La conversación seleccionada no existe o no pertenece a esta cuenta')
      return value
    })
    : await getSelectedCoachConversation(accountId)
  const messages = boundConversation(previousMessages.filter((message) => message.conversationId === conversation.id))
  const conversationId = conversation.id
  const consentRevision = consentRecord?.revision ?? consent.acceptedAt
  const plan = routines.filter((routine) => !routine.retiredAt).map((routine) => ({ sessionId: routine.id, name: routine.name, expectedRevision: routine.revision, scheduledAt: routine.scheduledAt, exercises: normalizeRoutine(routine).exercises.map((exercise, order) => ({ occurrenceId: exercise.occurrenceId ?? `${routine.id}:${order}:${exercise.exerciseId}`, exerciseId: exercise.exerciseId, order, plannedSets: exercise.plannedSets, setTargets: exercise.setTargets ?? [], repRangeMin: exercise.repRangeMin, repRangeMax: exercise.repRangeMax, targetRpeMin: exercise.targetRpeMin, targetRpeMax: exercise.targetRpeMax, notes: exercise.notes })) }))
  const catalogEntries: Array<[string, { id: string; name: string; equipment: string[]; muscles: string[] }]> = [
    ...customExercises.map((exercise) => [exercise.id, { id: exercise.id, name: exercise.name, equipment: [exercise.equipment], muscles: [exercise.target] }] as [string, { id: string; name: string; equipment: string[]; muscles: string[] }]),
    ...routines.flatMap((routine) => routine.exercises.map((exercise) => [exercise.exerciseId, { id: exercise.exerciseId, name: exercise.exerciseId, equipment: [], muscles: [] }] as [string, { id: string; name: string; equipment: string[]; muscles: string[] }])),
  ]
  const catalog = [...new Map(catalogEntries).values()]
  const nutritionGoals = useNutrition.getState().goals
  const goals = profile.goals.length ? profile.goals : (nutritionGoals.configured ? [`objetivo nutricional: ${nutritionGoals.goal ?? 'no informado'}`] : [])
  const snapshot = {
    message: trimmedMessage,
    profileRevision: profile.revision,
    consentVersion: consent.version,
    consentRevision,
    profile: { population: profile.population, populationConfirmed: profile.populationConfirmed, experience: profile.experience, goals: profile.goals },
    goals,
    restrictions: { injuriesOrPain: profile.injuriesOrPain, unavailableEquipment: profile.unavailableEquipment, excludedExercises: profile.excludedExercises, nutritionConstraints: profile.nutritionConstraints },
    catalog,
    metrics: { captured: true, workoutCount: workouts.length, totalVolumeKg: workouts.reduce((sum, workout) => sum + (workout.volumeKg ?? 0), 0), bestE1rmByExercise: {} },
    plan,
    history: recentFinished.map((workout) => ({ id: workout.id, startedAt: workout.startedAt, endedAt: workout.endedAt, name: workout.name, exercises: workout.exercises })),
    conversation: messages,
    conversationVersion: conversationVersion(messages),
  }
  const version = contextVersionFromSnapshot(snapshot)
  const event: CoachEvent = {
    id: options.eventId ?? uid(), accountId, deviceId: getCoachDeviceId(), conversationId, type: eventType, occurredAt: Date.now(), contextVersion: version,
    ...(causedByEventId ? { causedByEventId } : {}), payload: { message: trimmedMessage, ...(options.payload ?? {}) },
  }
  return parseCoachRequest({
    event,
    context: {
      version, capturedAt: Date.now(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', isCurrent: true,
      snapshot,
      conversationVersion: snapshot.conversationVersion,
    },
  })
}

const activeRun = (run: CoachRunRecord) => run.status === 'queued' || run.status === 'running'
const remoteId = (run: CoachRunRecord) => run.remoteRunId ?? (run.id.startsWith('coach-local-') ? undefined : run.id)
const DISPATCH_LEASE_MS = 60_000
export const COACH_CLIENT_TIMEOUT_MS = 30_000

export function isCoachStreamingEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_COACH_STREAMING as string | undefined
  return flag === '1' || flag?.toLowerCase() === 'true'
}

export const COACH_STREAM_MAX_RECONNECTS = 4
const COACH_STREAM_BACKOFF_MS = [250, 500, 1_000, 2_000]
type CoachStreamOptions = { sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>; maxReconnects?: number }

function streamAbortError(): Error {
  const error = new Error('coach-stream-aborted'); error.name = 'AbortError'; return error
}

function waitForStreamRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(streamAbortError())
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, milliseconds)
    const abort = () => { window.clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(streamAbortError()) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Fetches and buffers the complete body before releasing the timeout lease. */
export async function fetchCoach(url: string, init: RequestInit = {}, timeoutMs = COACH_CLIENT_TIMEOUT_MS, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController()
  const callerSignal = signal ?? init.signal ?? undefined
  const abortFromCaller = () => controller.abort()
  if (callerSignal?.aborted) controller.abort()
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  let timedOut = false
  let rejectTimeout!: (error: Error) => void
  const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject })
  const timer = setTimeout(() => { timedOut = true; controller.abort(); rejectTimeout(messageError('coach-call-timeout')) }, timeoutMs)
  try {
    const response = await Promise.race([fetch(url, { ...init, signal: controller.signal }), timeout])
    const text = await Promise.race([response.text(), timeout])
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (cause) {
    if (callerSignal?.aborted) throw cause
    if (timedOut || controller.signal.aborted) throw messageError('coach-call-timeout')
    throw cause
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

function coachHttpError(response: Response, text: string): Error {
  let reason: unknown
  try { reason = JSON.parse(text).error } catch { /* respuesta no JSON */ }
  if (typeof reason === 'string' && reason.trim()) return messageError(reason)
  if (response.status === 401) return messageError('coach-auth-required')
  if (response.status === 403) return messageError('coach-forbidden')
  if (response.status === 409) return messageError('coach-conflict')
  if (response.status === 429) return messageError('provider-rate-limited')
  if (response.status >= 500) return messageError('server-error')
  return messageError(`No se pudo iniciar el coach (${response.status})`)
}

async function findRemoteRunByEvent(getToken: () => Promise<string | null>, request: CoachRunRequest): Promise<unknown | undefined> {
  const url = workerUrl()
  if (!url || !navigator.onLine) return undefined
  const token = await getToken()
  if (!token) return undefined
  const response = await fetchCoach(`${url}/v1/coach/runs/by-event/${encodeURIComponent(request.event.id)}`, { headers: { Authorization: `Bearer ${token}` } })
  if (response.status === 404) return undefined
  const text = await response.text()
  if (!response.ok) throw coachHttpError(response, text)
  return JSON.parse(text)
}

/** IndexedDB serializa estas transacciones incluso entre conexiones/pestañas. */
export async function admitCoachRun(request: CoachRunRequest): Promise<CoachRunRecord> {
  return db.transaction('rw', [db.coachRuns, db.coachMessages, db.coachConversations], async () => {
    const ownerId = request.event.accountId
    const runs = await db.coachRuns.where('ownerId').equals(ownerId).toArray()
    const existing = runs.find((run) => run.eventId === request.event.id || (
      request.event.type === 'session-finished' && run.request.event.type === 'session-finished' &&
      (run.request.event.payload?.workoutId === request.event.payload?.workoutId ||
        String(run.request.event.payload?.message ?? '').includes(`Sesión terminada ${request.event.payload?.workoutId}.`))
    ))
    if (existing) return existing
    if (runs.some(activeRun)) throw new Error('Ya existe una ejecución activa del coach. Espera a que termine o cancélala.')
    const now = Date.now()
    const messageId = `coach-message-coach-local-${request.event.id}`
    const requestedConversationId = request.event.conversationId
    if (!requestedConversationId) throw new Error('La solicitud no tiene una conversación seleccionada')
    const conversationId = requestedConversationId
    const conversation = await db.coachConversations.get(conversationId)
    if (!conversation || conversation.ownerId !== ownerId || conversation.pendingDeletion) {
      throw new Error('La conversación seleccionada no existe o no pertenece a esta cuenta')
    }
    const sequence = conversation?.nextSequence ?? 1
    const run: CoachRunRecord = {
      id: `coach-local-${request.event.id}`, ownerId, eventId: request.event.id,
      conversationId, messageId, reconciliationState: 'pending',
      contextVersion: request.context.version, status: 'queued', request, createdAt: now, updatedAt: now,
    }
    await db.coachRuns.add(run)
    await db.coachMessages.add({ id: messageId, ownerId, runId: run.id, conversationId, sequence, deliveryState: 'pending', role: 'user', content: String(request.event.payload?.message ?? ''), createdAt: now, contextVersion: run.contextVersion })
    if (conversation) await db.coachConversations.put({ ...conversation, nextSequence: sequence + 1, updatedAt: now })
    return run
  })
}

/** Fusiona la fila vigente dentro de la transacción, no el snapshot anterior al fetch. */
async function reconcileRun(localId: string, value: unknown): Promise<CoachRunRecord> {
  const parsed = coachRunResponseSchema.parse(value)
  return db.transaction('rw', [db.coachRuns, db.coachMessages, db.coachConversations], async () => {
    const local = await db.coachRuns.get(localId)
    if (!local) throw new Error('La ejecución local del coach ya no existe')
    if (parsed.run.accountId !== local.ownerId || parsed.run.eventId !== local.eventId || parsed.run.contextVersion !== local.contextVersion ||
      (remoteId(local) && remoteId(local) !== parsed.run.id)) throw new Error('La respuesta del coach no corresponde a la ejecución local')
    const ignoreStatus = local.status === 'cancelled' || local.status === 'completed' ||
      (local.status === 'failed' && (!isRetryableCoachError(local.error) || parsed.run.status === 'queued' || parsed.run.status === 'running')) ||
      (local.status === 'running' && parsed.run.status === 'queued')
    const remoteTerminal = parsed.run.status === 'completed' || parsed.run.status === 'failed' || parsed.run.status === 'cancelled'
    const keepCancellationPending = cancellationPending(local) && !remoteTerminal
    const next: CoachRunRecord = {
      ...local, remoteRunId: parsed.run.id, updatedAt: Date.now(),
      dispatchToken: undefined, dispatchLeaseExpiresAt: undefined,
      reconciliationState: remoteTerminal ? 'reconciled' : local.reconciliationState,
      cancelRequestedAt: remoteTerminal ? undefined : local.cancelRequestedAt,
      lastError: remoteTerminal ? undefined : local.lastError,
      ...(!ignoreStatus ? {
        status: parsed.run.status, decision: parsed.decision ?? local.decision,
        error: keepCancellationPending ? 'cancellation-pending' : parsed.error, usage: parsed.run.usage ?? local.usage,
        startedAt: parsed.run.startedAt ?? local.startedAt, endedAt: parsed.run.endedAt ?? local.endedAt,
        appliedAt: local.appliedAt ?? parsed.appliedAt,
      } : {}),
    }
    await db.coachRuns.put(next)
    if (next.decision && next.status !== 'cancelled') {
      const previous = await db.coachMessages.where('runId').equals(localId)
        .filter((message) => message.ownerId === next.ownerId && message.role === 'assistant').first()
      const content = next.decision.kind === 'ask'
        ? [next.decision.explanation, ...next.decision.questions].join('\n\n') : next.decision.explanation
      const assistantConversation = next.conversationId ? await db.coachConversations.get(next.conversationId) : undefined
      await db.coachMessages.put({
        ...previous, id: previous?.id ?? `coach-assistant-${localId}`, ownerId: next.ownerId,
        runId: localId, conversationId: next.conversationId, sequence: previous?.sequence ?? assistantConversation?.nextSequence, deliveryState: 'delivered', role: 'assistant', content, createdAt: previous?.createdAt ?? Date.now(), contextVersion: next.contextVersion,
      })
      if (!previous && assistantConversation) await db.coachConversations.update(assistantConversation.id, { nextSequence: assistantConversation.nextSequence + 1, updatedAt: Date.now() })
    }
    return next
  })
}

export function isRetryableCoachError(error: string | undefined): boolean {
  return Boolean(error && new Set([
    'legacy-imported', 'unknown-outcome', 'uncertain-outcome', 'coach-call-timeout', 'provider-timeout',
    'agent-deadline-exceeded', 'coach-global-deadline-exceeded', 'provider-rate-limited',
    'provider-server-error', 'provider-circuit-open', 'coach-providers-unavailable', 'server-error', 'workflow-create-failed', 'workflow-not-configured',
  ]).has(error))
}

export function isRecoverableCoachError(error: string | undefined): boolean {
  return Boolean(error && new Set([
    'coach-auth-required', 'coach-forbidden', 'coach-conflict', 'coach-call-timeout',
    'provider-rate-limited', 'provider-server-error', 'provider-circuit-open', 'coach-providers-unavailable', 'server-error', 'unknown-outcome', 'uncertain-outcome',
  ]).has(error))
}

function cancellationPending(run: CoachRunRecord): boolean {
  return run.cancelRequestedAt !== undefined || run.error === 'cancellation-pending' || (run.status as string) === 'cancellation-pending'
}

async function persistTransportError(runId: string, error: string): Promise<CoachRunRecord | undefined> {
  return db.transaction('rw', db.coachRuns, async () => {
    const current = await db.coachRuns.get(runId)
    if (!current) return undefined
    const next: CoachRunRecord = cancellationPending(current)
      ? { ...current, error: 'cancellation-pending', lastError: error, updatedAt: Date.now() }
      : { ...current, error, lastError: undefined, updatedAt: Date.now() }
    await db.coachRuns.put(next)
    return next
  })
}

function coachStatusError(response: Response, text: string): string {
  if (response.status === 401) return 'coach-auth-required'
  if (response.status === 403) return 'coach-forbidden'
  if (response.status === 409) return 'coach-conflict'
  if (response.status === 429) return 'provider-rate-limited'
  if (response.status >= 500) return 'server-error'
  return coachHttpError(response, text).message
}

function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'name' in cause && (cause as { name?: unknown }).name === 'AbortError'
}

async function dispatchRun(getToken: () => Promise<string | null>, localId: string): Promise<CoachRunRecord> {
  const initial = (await db.coachRuns.get(localId))!
  const url = workerUrl()
  if (!url || !navigator.onLine) return initial
  const token = await getToken()
  if (!token) return (await db.coachRuns.get(localId))!
  const claimed = await db.transaction('rw', db.coachRuns, async () => {
    const local = await db.coachRuns.get(localId)
    if (!local || local.legacy || !activeRun(local) || remoteId(local) || (local.dispatchLeaseExpiresAt ?? 0) > Date.now() ||
      local.ownerId !== getCoachAccountId() || !getCoachConsent(local.ownerId)) return undefined
    // Las bases antiguas pueden contener varios pendientes: se envían de uno
    // en uno, conservando todas las filas del historial heredado.
    const siblings = await db.coachRuns.where('ownerId').equals(local.ownerId).toArray()
    if (siblings.some((run) => run.id !== localId && activeRun(run) &&
      (remoteId(run) || (run.dispatchLeaseExpiresAt ?? 0) > Date.now()))) return undefined
    const request = normalizeCoachRequestForTransport(local.request)
    const next: CoachRunRecord = { ...local, request, contextVersion: request.context.version, dispatchToken: uid(), dispatchLeaseExpiresAt: Date.now() + DISPATCH_LEASE_MS, updatedAt: Date.now() }
    await db.coachRuns.put(next)
    return next
  })
  if (!claimed) return (await db.coachRuns.get(localId))!
  const request = claimed.request
  let outcomeUnknown = false
  let value: unknown
  try {
    outcomeUnknown = true
    const response = await fetchCoach(`${url}/v1/coach/runs`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': request.event.id, 'X-NextRep-Consent-Version': COACH_CONSENT_VERSION, 'X-NextRep-Device-Id': request.event.deviceId }, body: JSON.stringify(request) })
    const text = await response.text()
    outcomeUnknown = false
    if (!response.ok) {
      throw coachHttpError(response, text)
    }
    value = JSON.parse(text)
  } catch (cause) {
    if (outcomeUnknown) {
      try {
        const found = await findRemoteRunByEvent(getToken, request)
        if (found !== undefined) return reconcileRun(localId, found)
      } catch { /* La incertidumbre sigue visible y se puede resolver manualmente. */ }
    }
    return db.transaction('rw', db.coachRuns, async () => {
      const current = (await db.coachRuns.get(localId))!
      if (!activeRun(current) || remoteId(current) || current.dispatchToken !== claimed.dispatchToken) return current
      const error = cause instanceof Error ? cause.message : 'No se pudo iniciar el coach'
      const failed: CoachRunRecord = { ...current, status: 'failed', error: outcomeUnknown && error !== 'coach-call-timeout' ? 'unknown-outcome' : error, endedAt: Date.now(), updatedAt: Date.now(), dispatchToken: undefined, dispatchLeaseExpiresAt: undefined }
      await db.coachRuns.put(failed)
      return failed
    })
  }
  // Un fallo de persistencia aborta la fusión y conserva la solicitud encolada.
  // Al vencer el lease se puede reenviar con la misma clave tras una interrupción.
  return reconcileRun(localId, value)
}

export async function startCoachRun(getToken: () => Promise<string | null>, message: string, options: { causedByEventId?: string; conversationId?: string } = {}): Promise<CoachRunRecord> {
  const request = await buildCoachRequest(message, options.causedByEventId, 'message-sent', { conversationId: options.conversationId })
  if (!request) throw new Error('Activa el consentimiento del coach y escribe un mensaje')
  const local = await admitCoachRun(request)
  return dispatchRun(getToken, local.id)
}

/** Encola el evento durable de una sesión terminada; App lo sincroniza cuando hay cuenta/red. */
export async function queueCoachSessionFinished(workoutId: string): Promise<void> {
  const request = await buildCoachRequest(`Sesión terminada ${workoutId}. Revisa el contexto y dime si hay algo que deba observar antes de mi próximo entrenamiento.`, undefined, 'session-finished', { eventId: `coach-session-finished-${workoutId}`, payload: { workoutId } })
  if (!request) return
  await admitCoachRun(request)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('nextrep:coach-wake'))
}

export async function refreshCoachRun(getToken: () => Promise<string | null>, runId: string, signal?: AbortSignal): Promise<CoachRunRecord | undefined> {
  const local = await db.coachRuns.get(runId)
  if (!local || !remoteId(local) || !workerUrl() || !navigator.onLine) return local
  const token = await getToken()
  if (!token) return local
  let response: Response
  try {
    response = await fetchCoach(`${workerUrl()}/v1/coach/runs/${encodeURIComponent(remoteId(local)!)}`, { headers: { Authorization: `Bearer ${token}` } }, COACH_CLIENT_TIMEOUT_MS, signal)
  } catch (cause) {
    if (signal?.aborted || isAbortError(cause)) throw cause
    const error = cause instanceof Error ? cause.message : 'unknown-outcome'
    if (isRecoverableCoachError(error)) return persistTransportError(runId, error)
    throw cause
  }
  if (!response.ok) return persistTransportError(runId, coachStatusError(response, await response.text()))
  return reconcileRun(local.id, await response.json())
}

async function applyCoachSnapshot(localId: string, snapshot: CoachRunSnapshot): Promise<CoachRunRecord | undefined> {
  return db.transaction('rw', db.coachRuns, async () => {
    const local = await db.coachRuns.get(localId)
    if (!local || remoteId(local) !== snapshot.runId || (local.snapshotSequence ?? 0) >= snapshot.sequence) return local
    const terminal = snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled'
    const next: CoachRunRecord = {
      ...local, snapshotSequence: snapshot.sequence, partialExplanation: snapshot.text,
      ...(terminal ? { status: snapshot.status, error: snapshot.error, endedAt: local.endedAt ?? snapshot.createdAt } : { status: 'running' }),
      ...(snapshot.decision ? { decision: snapshot.decision } : {}), updatedAt: Date.now(),
    }
    await db.coachRuns.put(next)
    return next
  })
}

function sseRecords(buffer: string): { records: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/)
  return { records: parts.slice(0, -1), rest: parts.at(-1) ?? '' }
}

/** Cliente de reconexión opt-in: nunca crea un run ni sustituye el polling existente. */
export type CoachStreamResult =
  | { kind: 'terminal'; run: CoachRunRecord }
  | { kind: 'cancelled'; run: CoachRunRecord }
  | { kind: 'polling'; run: CoachRunRecord }

function streamResult(run: CoachRunRecord): CoachStreamResult {
  if (run.status === 'cancelled') return { kind: 'cancelled', run }
  if (run.status === 'completed' || run.status === 'failed') return { kind: 'terminal', run }
  return { kind: 'polling', run }
}

export async function streamCoachRun(getToken: () => Promise<string | null>, runId: string, signal?: AbortSignal, onSnapshot?: (run: CoachRunRecord) => void | Promise<void>, options: CoachStreamOptions = {}): Promise<CoachStreamResult | undefined> {
  const local = await db.coachRuns.get(runId)
  const url = workerUrl()
  const remoteRunId = local ? remoteId(local) : undefined
  if (!local || !remoteRunId || !url || !navigator.onLine || !isCoachStreamingEnabled()) return local ? streamResult(local) : undefined
  const token = await getToken()
  if (!token) return streamResult(local)
  const sleep = options.sleep ?? waitForStreamRetry
  const maxReconnects = options.maxReconnects ?? COACH_STREAM_MAX_RECONNECTS
  let reconnects = 0
  let current = local
  while (true) {
    if (signal?.aborted) throw streamAbortError()
    const latest = await db.coachRuns.get(runId)
    if (latest) current = latest
    if (!activeRun(current)) return streamResult(current)
    const cursor = current.snapshotSequence ?? 0
    let shouldReconnect: boolean
    try {
      const response = await fetch(`${url}/v1/coach/runs/${encodeURIComponent(remoteRunId)}/events`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', 'Last-Event-ID': String(cursor) }, signal,
      })
      if (!response.ok) {
        if (response.status === 404 || response.status === 405 || response.status === 415) return { kind: 'polling', run: current }
        if (response.status === 401 || response.status === 403 || response.status === 409) {
          const persisted = await persistTransportError(runId, coachStatusError(response, await response.text()))
          return streamResult(persisted ?? current)
        }
        shouldReconnect = response.status === 408 || response.status >= 500
        if (!shouldReconnect) {
          const persisted = await persistTransportError(runId, coachStatusError(response, await response.text()))
          return streamResult(persisted ?? current)
        }
      } else {
        const reader = response.body?.getReader()
        if (!reader) return { kind: 'polling', run: current }
        else {
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const part = await reader.read()
            buffer += decoder.decode(part.value ?? new Uint8Array(), { stream: !part.done })
            const parsed = sseRecords(buffer); buffer = parsed.rest
            for (const record of parsed.records) {
              const data = record.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
              if (!data) continue
              const event = coachRunSnapshotEventSchema.parse(JSON.parse(data))
              const next = await applyCoachSnapshot(runId, event.snapshot)
              if (next) { current = next; await onSnapshot?.(next) }
            }
            if (part.done) break
          }
          shouldReconnect = activeRun(current)
        }
      }
    } catch (cause) {
      if (signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')) throw cause
      shouldReconnect = true
    }
    if (!shouldReconnect || !activeRun(current)) return streamResult(current)
    if (reconnects >= maxReconnects) return { kind: 'polling', run: current }
    const delay = COACH_STREAM_BACKOFF_MS[Math.min(reconnects, COACH_STREAM_BACKOFF_MS.length - 1)]
    reconnects += 1
    await sleep(delay, signal)
  }
}

/** Reconcilia pendientes sin ID remoto usando siempre la misma clave idempotente. */
let coachSync: { ownerId: string; promise: Promise<void> } | undefined

export function syncPendingCoachRuns(getToken: () => Promise<string | null>): Promise<void> {
  const ownerId = getCoachAccountId()
  if (!ownerId) return Promise.resolve()
  if (coachSync?.ownerId === ownerId) return coachSync.promise
  const promise = syncPendingCoachRunsInternal(getToken, ownerId).finally(() => {
    if (coachSync?.promise === promise) coachSync = undefined
  })
  coachSync = { ownerId, promise }
  return promise
}

async function syncPendingCoachRunsInternal(getToken: () => Promise<string | null>, ownerId: string): Promise<void> {
  const url = workerUrl()
  if (!url || !navigator.onLine) return
  const revoked = (await db.coachRuns.where('ownerId').equals(ownerId).toArray()).filter(run => run.error === 'cancelled-by-consent-revocation')
  for (const run of revoked) {
    try { await cancelCoachRun(getToken, run.id) } catch { /* Se conserva para reconciliar al reconectar. */ }
  }
  if (!getCoachConsent(ownerId)) return
  const pending = (await db.coachRuns.where('ownerId').equals(ownerId).toArray()).filter((run) => !run.legacy && !remoteId(run) && activeRun(run))
  for (const local of pending) {
    if (getCoachAccountId() !== ownerId) return
    if (!getCoachConsent(ownerId)) return
    const sent = await dispatchRun(getToken, local.id)
    if (sent.cancelRequestedAt) await cancelCoachRun(getToken, local.id)
  }
}

export async function cancelCoachRun(getToken: () => Promise<string | null>, runId: string): Promise<void> {
  const local = await db.coachRuns.get(runId)
  if (!local) return
  const requestedAt = local.cancelRequestedAt ?? Date.now()
  await db.coachRuns.update(runId, { cancelRequestedAt: requestedAt, error: 'cancellation-pending', lastError: undefined, updatedAt: Date.now() })
  try {
    if (workerUrl() && navigator.onLine) {
      const token = await getToken()
      if (!token) throw new Error('Falta sesión para confirmar la cancelación remota')
      if (remoteId(local)) {
        const response = await fetchCoach(`${workerUrl()}/v1/coach/runs/${encodeURIComponent(remoteId(local)!)}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-NextRep-Consent-Version': COACH_CONSENT_VERSION, 'X-NextRep-Device-Id': local.request.event.deviceId }, body: '{}' })
        if (response.status === 404) {
          await db.coachRuns.update(runId, { status: 'cancelled', error: 'cancelled', endedAt: Date.now(), updatedAt: Date.now(), cancelRequestedAt: undefined, lastError: undefined })
          return
        }
        if (!response.ok) throw coachHttpError(response, await response.text())
        await reconcileRun(runId, await response.json())
        return
      }
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : 'unknown-outcome'
    await db.coachRuns.update(runId, { error: 'cancellation-pending', lastError: error, cancelRequestedAt: requestedAt, updatedAt: Date.now() })
    throw cause
  }
  if (!navigator.onLine || !remoteId(local)) return
  await db.transaction('rw', db.coachRuns, async () => {
    const current = await db.coachRuns.get(runId)
    if (current) await db.coachRuns.put({ ...current, status: 'cancelled', error: 'cancelled', endedAt: current.endedAt ?? Date.now(), updatedAt: Date.now() })
  })
}

/** Reintento explícito: una ejecución incierta no es una continuación completada. */
export async function retryCoachRun(getToken: () => Promise<string | null>, runId: string): Promise<CoachRunRecord> {
  const previous = await db.coachRuns.get(runId)
  if (!previous || previous.ownerId !== getCoachAccountId() || !isRetryableCoachError(previous.error)) throw new Error('Esta ejecución no tiene un fallo recuperable para reintentar')
  if (remoteId(previous)) return (await refreshCoachRun(getToken, runId)) ?? previous
  await db.coachRuns.update(runId, { status: 'queued', legacy: false, error: undefined, endedAt: undefined, updatedAt: Date.now() })
  return dispatchRun(getToken, runId)
}

export async function applyCoachChangeSet(runId: string): Promise<void> {
  const ownerId = getCoachAccountId()
  if (!ownerId) throw new Error('Se requiere una cuenta para aplicar la propuesta')
  const initial = await db.coachRuns.get(runId)
  if (!initial || initial.ownerId !== ownerId || initial.decision?.kind !== 'propose') throw new Error('No hay una propuesta aplicable de tu cuenta')
  if (!isRenderableCoachProposal(initial)) throw new Error('La propuesta aún no está completada y validada')
  if (initial.appliedAt) return
  const parsed = agentDecisionSchema.parse(initial.decision)
  if (parsed.kind !== 'propose' || parsed.changeSet.accountId !== ownerId || parsed.changeSet.expectedContextVersion !== initial.contextVersion) throw new Error('La propuesta ya no pertenece al contexto vigente')
  if (initial.request.event.conversationId && initial.request.event.conversationId !== 'legacy-conversation') {
    const current = await buildCoachRequest(String(initial.request.event.payload?.message ?? ''), initial.request.event.causedByEventId, initial.request.event.type, { conversationId: initial.request.event.conversationId })
    if (!current || current.context.version !== initial.contextVersion) throw new Error('El contexto cambió; recalcula la propuesta antes de aplicarla')
  }
  const futurePlan = parsed.changeSet.futurePlan
  if (!futurePlan && parsed.changeSet.policyVersion !== 'v1') throw new Error('La propuesta no contiene un futurePlan completo')
  await db.transaction('rw', [db.routines, db.routineRevisionSnapshots, db.coachRuns, db.coachConsents], async () => {
    const run = await db.coachRuns.get(runId)
    if (!run || run.ownerId !== ownerId || run.appliedAt) return
    const consent = await db.coachConsents.get(`${ownerId}:${run.request.event.deviceId}`)
    if (consent && (!consent.enabled || consent.version !== COACH_CONSENT_VERSION)) throw new Error('El consentimiento ya no está vigente')
    const byRoutine = new Map<string, Routine>()
    const baseByRoutine = new Map<string, Routine>()
    for (const operation of parsed.changeSet.operations) {
      if (operation.kind === 'nutrition-goals') throw new Error('Esta app aún no permite aplicar cambios nutricionales del coach')
      if (operation.kind === 'routine-create' || operation.kind === 'routine-retire') continue
      const base = baseByRoutine.get(operation.routineId) ?? await db.routines.get(operation.routineId)
      if (!base) throw new Error('La rutina propuesta ya no existe')
      const normalizedBase = normalizeRoutine(base)
      baseByRoutine.set(operation.routineId, normalizedBase)
      if (normalizedBase.revision !== operation.expectedRevision || normalizedBase.retiredAt) throw new Error('La rutina cambió; la propuesta quedó obsoleta')
      const routine = byRoutine.get(operation.routineId) ?? cloneRoutine(normalizedBase)
      const occurrences = operation.kind === 'routine'
        ? routine.exercises.filter((exercise) => operation.occurrenceId ? exercise.occurrenceId === operation.occurrenceId : exercise.exerciseId === operation.patch.exerciseId)
        : routine.exercises.filter((exercise) => exercise.occurrenceId === operation.occurrenceId)
      if (occurrences.length !== 1) throw new Error('La operación no identifica exactamente una ocurrencia')
      const targetOccurrence = occurrences[0].occurrenceId
      const exercises = routine.exercises.map((exercise) => {
        if (exercise.occurrenceId !== targetOccurrence) return exercise
        if (operation.kind === 'exercise-substitution') return { ...exercise, exerciseId: operation.exerciseId }
        const patched = {
          ...exercise,
          ...(operation.patch.plannedSets !== undefined ? { plannedSets: operation.patch.plannedSets } : {}),
          ...(operation.patch.repRangeMin !== undefined ? { repRangeMin: operation.patch.repRangeMin } : {}),
          ...(operation.patch.repRangeMax !== undefined ? { repRangeMax: operation.patch.repRangeMax } : {}),
          ...(operation.patch.loadKg !== undefined ? { setTargets: (exercise.setTargets ?? []).map((set) => set.type === 'warmup' ? { ...set } : { ...set, weightKg: operation.patch.loadKg }) } : {}),
          ...(operation.patch.exerciseId ? { exerciseId: operation.patch.exerciseId } : {}),
        }
        return operation.patch.plannedSets !== undefined ? withPlannedSetCount(patched, operation.patch.plannedSets) : patched
      })
      byRoutine.set(operation.routineId, { ...routine, exercises, revision: normalizedBase.revision + 1 })
    }
    if (futurePlan) {
      for (const session of futurePlan.sessions) {
        const current = byRoutine.get(session.sessionId) ?? baseByRoutine.get(session.sessionId) ?? await db.routines.get(session.sessionId)
        if (!current) continue
        const expected = session.expectedRevision
        if (expected !== undefined && expected !== 0 && normalizeRoutine(current).revision !== expected && !byRoutine.has(session.sessionId)) throw new Error('La revisión de futurePlan no coincide')
        const normalized = byRoutine.get(session.sessionId) ?? normalizeRoutine(current)
        const planned = session.exercises
        if (new Set(planned.map((exercise) => exercise.occurrenceId)).size !== planned.length) throw new Error('futurePlan contiene ocurrencias duplicadas')
        const exercises = planned.map((exercise) => ({
          ...normalized.exercises.find((candidate) => candidate.occurrenceId === exercise.occurrenceId) ?? { exerciseId: exercise.exerciseId, restSec: 0, loadIncrementKg: normalized.loadIncrementKg, trainingRole: normalized.trainingRole },
          occurrenceId: exercise.occurrenceId,
          exerciseId: exercise.exerciseId,
          plannedSets: exercise.plannedSets,
          setTargets: exercise.setTargets.map((set) => ({ ...set })),
          repRangeMin: exercise.repRangeMin,
          repRangeMax: exercise.repRangeMax,
          targetRpeMin: exercise.targetRpeMin,
          targetRpeMax: exercise.targetRpeMax,
          ...(exercise.notes !== undefined ? { notes: exercise.notes } : {}),
        }))
        const explicitlyRetired = parsed.changeSet.operations.some((operation) => operation.kind === 'routine-retire' && operation.routineId === session.sessionId)
        if ((!exercises.length && !explicitlyRetired) || exercises.some((exercise) => exercise.setTargets && exercise.setTargets.length !== exercise.plannedSets)) throw new Error('futurePlan no cubre los objetivos por serie')
        byRoutine.set(session.sessionId, { ...normalized, name: session.name, ...(session.scheduledAt !== undefined ? { scheduledAt: session.scheduledAt } : {}), exercises, revision: byRoutine.has(session.sessionId) ? normalized.revision : normalized.revision })
      }
    }
    for (const operation of parsed.changeSet.operations) {
      if (operation.kind === 'routine-create') {
        if (await db.routines.get(operation.routineId)) throw new Error('La sesión nueva ya existe')
        const session = futurePlan?.sessions.find((item) => item.sessionId === operation.routineId)
        if (!session) throw new Error('La sesión creada no aparece en futurePlan')
        byRoutine.set(operation.routineId, routineFromFuture(operation.routineId, session, operation.expectedRevision))
      }
      if (operation.kind === 'routine-retire') {
        const current = await db.routines.get(operation.routineId)
        if (!current || normalizeRoutine(current).revision !== operation.expectedRevision) throw new Error('La sesión a retirar cambió')
        byRoutine.set(operation.routineId, { ...normalizeRoutine(current), retiredAt: Date.now(), revision: current.revision + 1 })
      }
    }
    for (const [routineId, next] of byRoutine) {
      const previous = await db.routines.get(routineId)
      if (!previous) {
        await db.routines.put(next)
        continue
      }
      const normalizedPrevious = normalizeRoutine(previous)
      await db.routineRevisionSnapshots.put({ id: `${routineId}:revision:${normalizedPrevious.revision}`, routineId, revision: normalizedPrevious.revision, createdAt: Date.now(), analysisId: run.id, routine: normalizedPrevious })
      await db.routines.put({ ...next, revision: next.revision <= normalizedPrevious.revision ? normalizedPrevious.revision + 1 : next.revision })
    }
    await db.coachRuns.put({ ...run, appliedAt: Date.now(), updatedAt: Date.now() })
  })
}

function cloneRoutine(routine: Routine): Routine {
  return { ...routine, exercises: routine.exercises.map((exercise) => ({ ...exercise, setTargets: exercise.setTargets?.map((set) => ({ ...set })) })) }
}

function routineFromFuture(routineId: string, session: FutureSession, expectedRevision: number): Routine {
  return {
    id: routineId,
    name: session.name,
    sortOrder: 0,
    createdAt: Date.now(),
    revision: Math.max(1, expectedRevision),
    trainingRole: 'hypertrophy',
    loadIncrementKg: 2.5,
    coachReviewed: true,
    scheduledAt: session.scheduledAt,
    exercises: session.exercises.map((exercise) => ({ occurrenceId: exercise.occurrenceId, exerciseId: exercise.exerciseId, plannedSets: exercise.plannedSets, setTargets: exercise.setTargets.map((set) => ({ ...set })), restSec: 0, repRangeMin: exercise.repRangeMin, repRangeMax: exercise.repRangeMax, targetRpeMin: exercise.targetRpeMin, targetRpeMax: exercise.targetRpeMax, notes: exercise.notes, trainingRole: 'hypertrophy', loadIncrementKg: 2.5 })),
  }
}
