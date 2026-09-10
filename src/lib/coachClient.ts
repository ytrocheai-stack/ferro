import { canonicalJson, fnv1a64 } from '../../packages/adaptation-core/src/index'
import { agentDecisionSchema, coachRunResponseSchema, type CoachEvent, type CoachRunRequest, type FutureSession } from '../../packages/adaptation-core/src/contract'
import { db } from '../db/db'
import type { CoachMessage, CoachRunRecord, Routine } from '../db/types'
import { getCoachAccountId } from './coachAccount'
import { COACH_CONSENT_VERSION, getCoachConsent, getCoachConversationId, getCoachDeviceId, getCoachProfile, readCoachConsentRecord } from './coachConsent'
import { normalizeRoutine } from './adaptation'
import { uid } from './format'
import { useNutrition } from '../stores/nutrition'

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
function conversationVersion(messages: CoachMessage[]): string {
  return `coach-conversation-${fnv1a64(canonicalJson(messages.map(({ id, role, content, runId, contextVersion }) => ({ id, role, content, runId, contextVersion }))))}`
}

const MAX_SENT_CONVERSATION_CHARS = 36_000

function boundConversation(messages: CoachMessage[]): CoachMessage[] {
  const selected: CoachMessage[] = []
  let remaining = MAX_SENT_CONVERSATION_CHARS
  for (const message of [...messages].sort((a, b) => b.createdAt - a.createdAt)) {
    if (remaining <= 0) break
    const content = message.content.slice(0, Math.min(message.content.length, remaining))
    if (!content) continue
    selected.unshift({ ...message, content })
    remaining -= content.length
  }
  return selected
}

export async function buildCoachRequest(message: string, causedByEventId?: string, eventType: CoachEvent['type'] = 'message-sent'): Promise<CoachRunRequest | null> {
  const accountId = getCoachAccountId()
  const consent = accountId ? getCoachConsent(accountId) : null
  if (!accountId || !consent || !message.trim()) return null
  const [routines, workouts, profile, previousMessages, customExercises, consentRecord] = await Promise.all([
    db.routines.toArray(),
    db.workouts.orderBy('startedAt').reverse().toArray(),
    getCoachProfile(accountId),
    db.coachMessages.where('ownerId').equals(accountId).toArray(),
    db.customExercises.toArray(),
    readCoachConsentRecord(accountId, consent.deviceId),
  ])
  const recentFinished = workouts.filter((workout) => Number.isFinite(workout.endedAt)).slice(0, 6)
  const messages = boundConversation(previousMessages)
  const conversationId = getCoachConversationId(accountId)
  const consentRevision = consentRecord?.revision ?? consent.acceptedAt
  const plan = routines.filter((routine) => !routine.retiredAt).map((routine) => ({ sessionId: routine.id, name: routine.name, expectedRevision: routine.revision, scheduledAt: routine.scheduledAt, exercises: normalizeRoutine(routine).exercises.map((exercise, order) => ({ occurrenceId: exercise.occurrenceId ?? `${routine.id}:${order}:${exercise.exerciseId}`, exerciseId: exercise.exerciseId, order, plannedSets: exercise.plannedSets, setTargets: exercise.setTargets ?? [], repRangeMin: exercise.repRangeMin, repRangeMax: exercise.repRangeMax, targetRpeMin: exercise.targetRpeMin, targetRpeMax: exercise.targetRpeMax, notes: exercise.notes })) }))
  const catalogEntries: Array<[string, { id: string; name: string; equipment: string[]; muscles: string[] }]> = [
    ...customExercises.map((exercise) => [exercise.id, { id: exercise.id, name: exercise.name, equipment: [exercise.equipment], muscles: [exercise.target] }] as [string, { id: string; name: string; equipment: string[]; muscles: string[] }]),
    ...routines.flatMap((routine) => routine.exercises.map((exercise) => [exercise.exerciseId, { id: exercise.exerciseId, name: exercise.exerciseId, equipment: [], muscles: [] }] as [string, { id: string; name: string; equipment: string[]; muscles: string[] }])),
  ]
  const catalog = [...new Map(catalogEntries).values()]
  const snapshotForHash = {
    profileRevision: profile.revision,
    consentVersion: consent.version,
    consentRevision,
    profile: { population: profile.population, populationConfirmed: profile.populationConfirmed, experience: profile.experience, goals: profile.goals },
    goals: profile.goals,
    restrictions: { injuriesOrPain: profile.injuriesOrPain, unavailableEquipment: profile.unavailableEquipment, excludedExercises: profile.excludedExercises, nutritionConstraints: profile.nutritionConstraints },
    catalog,
    metrics: { captured: true, workoutCount: workouts.length, totalVolumeKg: workouts.reduce((sum, workout) => sum + (workout.volumeKg ?? 0), 0), bestE1rmByExercise: {} },
    plan,
    history: recentFinished.map((workout) => ({ id: workout.id, startedAt: workout.startedAt, endedAt: workout.endedAt, name: workout.name, exercises: workout.exercises })),
    conversationVersion: conversationVersion(messages),
  }
  const version = contextVersionFromSnapshot(snapshotForHash)
  const event: CoachEvent = {
    id: uid(), accountId, deviceId: getCoachDeviceId(), conversationId, type: eventType, occurredAt: Date.now(), contextVersion: version,
    ...(causedByEventId ? { causedByEventId } : {}), payload: { message: message.trim() },
  }
  return {
    event,
    context: {
      version, capturedAt: Date.now(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', isCurrent: true,
      snapshot: {
        message: message.trim(),
        profileRevision: profile.revision,
        consentVersion: consent.version,
        consentRevision,
        profile: { population: profile.population, populationConfirmed: profile.populationConfirmed, experience: profile.experience, goals: profile.goals },
        goals: profile.goals.length ? profile.goals : (useNutrition.getState().goals.configured ? [`objetivo nutricional: ${useNutrition.getState().goals.goal ?? 'no informado'}`] : []),
        restrictions: { injuriesOrPain: profile.injuriesOrPain, unavailableEquipment: profile.unavailableEquipment, excludedExercises: profile.excludedExercises, nutritionConstraints: profile.nutritionConstraints },
        catalog,
        metrics: snapshotForHash.metrics,
        plan,
        history: snapshotForHash.history,
        conversation: messages,
        conversationVersion: snapshotForHash.conversationVersion,
      },
      conversationVersion: snapshotForHash.conversationVersion,
    },
  }
}

async function saveRun(request: CoachRunRequest, run: Partial<CoachRunRecord> & Pick<CoachRunRecord, 'id' | 'status'>): Promise<void> {
  const ownerId = request.event.accountId
  const now = Date.now()
  const record: CoachRunRecord = {
    id: run.id, ownerId, eventId: request.event.id, contextVersion: request.context.version, status: run.status, request,
    createdAt: run.createdAt ?? now, updatedAt: now, ...(run.decision ? { decision: run.decision } : {}), ...(run.error ? { error: run.error } : {}), ...(run.usage ? { usage: run.usage } : {}), ...(run.startedAt ? { startedAt: run.startedAt } : {}), ...(run.endedAt ? { endedAt: run.endedAt } : {}), ...(run.appliedAt ? { appliedAt: run.appliedAt } : {}),
  }
  await db.coachRuns.put(record)
}

async function saveAssistantMessage(run: CoachRunRecord): Promise<void> {
  if (!run.decision) return Promise.resolve()
  const content = run.decision.kind === 'ask' ? run.decision.questions.join('\n') : run.decision.explanation
  const message: CoachMessage = { id: `coach-message-${run.id}`, ownerId: run.ownerId, runId: run.id, role: 'assistant', content, createdAt: Date.now(), contextVersion: run.contextVersion }
  await db.coachMessages.put(message)
}

function fromResponse(value: unknown, request: CoachRunRequest, ownerId: string): CoachRunRecord {
  const parsed = coachRunResponseSchema.parse(value)
  return { id: parsed.run.id, ownerId, eventId: parsed.run.eventId, contextVersion: parsed.run.contextVersion, status: parsed.run.status, request, ...(parsed.decision ? { decision: parsed.decision } : {}), ...(parsed.error ? { error: parsed.error } : {}), ...(parsed.run.usage ? { usage: parsed.run.usage } : {}), createdAt: parsed.run.startedAt ?? Date.now(), updatedAt: Date.now(), ...(parsed.run.startedAt ? { startedAt: parsed.run.startedAt } : {}), ...(parsed.run.endedAt ? { endedAt: parsed.run.endedAt } : {}), ...(parsed.appliedAt ? { appliedAt: parsed.appliedAt } : {}) }
}

export async function startCoachRun(getToken: () => Promise<string | null>, message: string, options: { causedByEventId?: string } = {}): Promise<CoachRunRecord> {
  const request = await buildCoachRequest(message, options.causedByEventId)
  if (!request) throw new Error('Activa el consentimiento del coach y escribe un mensaje')
  const ownerId = request.event.accountId
  const localId = `coach-local-${request.event.id}`
  const existing = await db.coachRuns.get(localId)
  if (existing) return existing
  await saveRun(request, { id: localId, status: 'queued' })
  await db.coachMessages.put({ id: `coach-message-${localId}`, ownerId, runId: localId, role: 'user', content: message.trim(), createdAt: Date.now(), contextVersion: request.context.version })
  const url = workerUrl()
  const token = await getToken()
  if (!url || !navigator.onLine || !token) return (await db.coachRuns.get(localId))!
  let requestSent = false
  try {
    requestSent = true
    const response = await fetch(`${url}/v1/coach/runs`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': request.event.id, 'X-NextRep-Consent-Version': COACH_CONSENT_VERSION, 'X-NextRep-Device-Id': request.event.deviceId }, body: JSON.stringify(request) })
    const text = await response.text()
    if (!response.ok) {
      if (response.status < 500) requestSent = false
      const reason = (() => { try { return JSON.parse(text).error } catch { return undefined } })()
      throw new Error(typeof reason === 'string' ? reason : `No se pudo iniciar el coach (${response.status})`)
    }
    const remote = fromResponse(JSON.parse(text), request, ownerId)
    await db.coachRuns.delete(localId)
    await saveRun(request, remote)
    await saveAssistantMessage(remote)
    return remote
  } catch (cause) {
    const failed = { ...(await db.coachRuns.get(localId))!, status: 'failed' as const, error: requestSent ? 'unknown-outcome' : cause instanceof Error ? cause.message : 'No se pudo iniciar el coach', updatedAt: Date.now() }
    await db.coachRuns.put(failed)
    return failed
  }
}

/** Encola el evento durable de una sesión terminada; App lo sincroniza cuando hay cuenta/red. */
export async function queueCoachSessionFinished(workoutId: string): Promise<void> {
  const request = await buildCoachRequest(`Sesión terminada ${workoutId}. Revisa el contexto y dime si hay algo que deba observar antes de mi próximo entrenamiento.`, undefined, 'session-finished')
  if (!request) return
  const localId = `coach-local-${request.event.id}`
  if (await db.coachRuns.get(localId)) return
  await saveRun(request, { id: localId, status: 'queued' })
  await db.coachMessages.put({ id: `coach-message-${localId}`, ownerId: request.event.accountId, runId: localId, role: 'user', content: String(request.event.payload?.message ?? ''), createdAt: Date.now(), contextVersion: request.context.version })
}

export async function refreshCoachRun(getToken: () => Promise<string | null>, runId: string): Promise<CoachRunRecord | undefined> {
  const local = await db.coachRuns.get(runId)
  if (!local || !workerUrl() || !navigator.onLine) return local
  const token = await getToken()
  if (!token) return local
  const response = await fetch(`${workerUrl()}/v1/coach/runs/${encodeURIComponent(runId)}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) return local
  const remote = fromResponse(await response.json(), local.request, local.ownerId)
  await db.coachRuns.put(remote)
  if (remote.decision) await saveAssistantMessage(remote)
  return remote
}

/** Reenvía únicamente runs locales que nunca llegaron al Worker; la misma clave evita duplicados. */
export async function syncPendingCoachRuns(getToken: () => Promise<string | null>): Promise<void> {
  const ownerId = getCoachAccountId()
  const url = workerUrl()
  if (!ownerId || !url || !navigator.onLine) return
  const revoked = (await db.coachRuns.where('ownerId').equals(ownerId).toArray()).filter(run => run.error === 'cancelled-by-consent-revocation')
  for (const run of revoked) {
    try { await cancelCoachRun(getToken, run.id) } catch { /* Se conserva para reconciliar al reconectar. */ }
  }
  if (!getCoachConsent(ownerId)) return
  const token = await getToken()
  if (!token) return
  const pending = (await db.coachRuns.toArray()).filter((run) => run.ownerId === ownerId && run.id.startsWith('coach-local-') && run.status === 'queued')
  for (const local of pending) {
    if (!getCoachConsent(ownerId)) return
    let requestSent = false
    try {
      requestSent = true
      const response = await fetch(`${url}/v1/coach/runs`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': local.request.event.id, 'X-NextRep-Consent-Version': COACH_CONSENT_VERSION, 'X-NextRep-Device-Id': local.request.event.deviceId }, body: JSON.stringify(local.request) })
      if (!response.ok) {
        await db.coachRuns.put({ ...local, status: 'failed', error: response.status >= 500 ? 'unknown-outcome' : `Worker ${response.status}`, endedAt: Date.now(), updatedAt: Date.now() })
        continue
      }
      const remote = fromResponse(await response.json(), local.request, ownerId)
      await db.coachRuns.delete(local.id)
      await db.coachRuns.put(remote)
      await saveAssistantMessage(remote)
    } catch {
      await db.coachRuns.put({ ...local, status: 'failed', error: requestSent ? 'unknown-outcome' : 'No se pudo iniciar el coach', endedAt: Date.now(), updatedAt: Date.now() })
    }
  }
}

export async function cancelCoachRun(getToken: () => Promise<string | null>, runId: string): Promise<void> {
  const local = await db.coachRuns.get(runId)
  if (!local) return
  if (workerUrl() && navigator.onLine) {
    const token = await getToken()
    if (!token) throw new Error('Falta sesión para confirmar la cancelación remota')
    if (!runId.startsWith('coach-local-')) {
      const response = await fetch(`${workerUrl()}/v1/coach/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-NextRep-Consent-Version': COACH_CONSENT_VERSION, 'X-NextRep-Device-Id': local.request.event.deviceId }, body: '{}' })
      if (!response.ok && response.status !== 404) throw new Error('No se pudo confirmar la cancelación remota')
    }
  }
  await db.coachRuns.put({ ...local, status: 'cancelled', error: 'cancelled', endedAt: Date.now(), updatedAt: Date.now() })
}

/** Reintento explícito: una ejecución incierta no es una continuación completada. */
export async function retryCoachRun(getToken: () => Promise<string | null>, runId: string): Promise<CoachRunRecord> {
  const previous = await db.coachRuns.get(runId)
  if (!previous || previous.ownerId !== getCoachAccountId() || previous.error !== 'unknown-outcome') throw new Error('Solo se puede reintentar una ejecución con desenlace incierto')
  const message = String(previous.request.event.payload?.message ?? 'Continúa la revisión anterior')
  return startCoachRun(getToken, message)
}

export async function applyCoachChangeSet(runId: string): Promise<void> {
  const ownerId = getCoachAccountId()
  if (!ownerId) throw new Error('Se requiere una cuenta para aplicar la propuesta')
  const initial = await db.coachRuns.get(runId)
  if (!initial || initial.ownerId !== ownerId || initial.decision?.kind !== 'propose') throw new Error('No hay una propuesta aplicable de tu cuenta')
  if (initial.appliedAt) return
  const parsed = agentDecisionSchema.parse(initial.decision)
  if (parsed.kind !== 'propose' || parsed.changeSet.accountId !== ownerId || parsed.changeSet.expectedContextVersion !== initial.contextVersion) throw new Error('La propuesta ya no pertenece al contexto vigente')
  if (initial.request.event.conversationId && initial.request.event.conversationId !== 'legacy-conversation') {
    const current = await buildCoachRequest(String(initial.request.event.payload?.message ?? ''), initial.request.event.causedByEventId, initial.request.event.type)
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
        return {
          ...exercise,
          ...(operation.patch.plannedSets !== undefined ? { plannedSets: operation.patch.plannedSets } : {}),
          ...(operation.patch.repRangeMin !== undefined ? { repRangeMin: operation.patch.repRangeMin } : {}),
          ...(operation.patch.repRangeMax !== undefined ? { repRangeMax: operation.patch.repRangeMax } : {}),
          ...(operation.patch.loadKg !== undefined ? { setTargets: (exercise.setTargets ?? []).map((set) => set.type === 'warmup' ? { ...set } : { ...set, weightKg: operation.patch.loadKg }) } : {}),
          ...(operation.patch.exerciseId ? { exerciseId: operation.patch.exerciseId } : {}),
        }
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
          notes: exercise.notes,
        }))
        const explicitlyRetired = parsed.changeSet.operations.some((operation) => operation.kind === 'routine-retire' && operation.routineId === session.sessionId)
        if ((!exercises.length && !explicitlyRetired) || exercises.some((exercise) => exercise.setTargets && exercise.setTargets.length !== exercise.plannedSets)) throw new Error('futurePlan no cubre los objetivos por serie')
        byRoutine.set(session.sessionId, { ...normalized, name: session.name, scheduledAt: session.scheduledAt, exercises, revision: byRoutine.has(session.sessionId) ? normalized.revision : normalized.revision })
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
