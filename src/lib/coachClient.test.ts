import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { setCoachAccountId } from './coachAccount'
import { applyCoachChangeSet, boundConversation, buildCoachRequest, contextVersionFromSnapshot, normalizeCoachRequestForTransport, queueCoachSessionFinished, retryCoachRun, startCoachRun } from './coachClient'
import { grantCoachConsent } from './coachConsent'
import type { CoachRunRecord, Routine } from '../db/types'
import { coachRunRequestSchema } from '../../packages/adaptation-core/src/contract'

const accountId = 'user_coach_apply_test'
const routineId = 'routine-coach-test'
const contextVersion = `coach-context-${routineId}:1`

describe('coach submission failures', () => {
  beforeEach(async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    setCoachAccountId(accountId)
    vi.stubEnv('VITE_ADAPTATION_WORKER_URL', 'https://coach.example')
    await grantCoachConsent(accountId)
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await db.coachRuns.clear()
    await db.coachMessages.clear()
    await db.coachConsents.clear()
    setCoachAccountId(null)
  })
  it('shows a confirmed rejection without treating it as an uncertain dispatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'La beta del coach está cerrada' }), { status: 403 })))
    const result = await startCoachRun(async () => 'test-token', 'Hola')
    expect(result.status).toBe('failed')
    expect(result.error).toBe('La beta del coach está cerrada')
  })
  it('preserves uncertain outcome on a lost response so a new request is not sent automatically', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')))
    const result = await startCoachRun(async () => 'test-token', 'Hola')
    expect(result.error).toBe('unknown-outcome')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('an explicit retry does not require the uncertain run to be a completed conversation turn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')))
    const initial = await startCoachRun(async () => 'test-token', 'Hola')
    const retry = await retryCoachRun(async () => 'test-token', initial.id)
    expect(retry.eventId).not.toBe(initial.eventId)
    expect(retry.request.event.causedByEventId).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('projects the strict transport contract and bounds old conversation history', async () => {
    await db.coachMessages.bulkPut(Array.from({ length: 105 }, (_, index) => ({
      id: `old-${index}`, ownerId: accountId, runId: `run-${index}`, role: index % 2 ? 'assistant' as const : 'user' as const,
      content: 'x'.repeat(300), createdAt: index, contextVersion: `ctx-${index}`,
    })))
    const built = await buildCoachRequest('Primer mensaje')
    expect(built).not.toBeNull()
    const request = built!
    const conversation = request.context.snapshot.conversation
    expect(conversation).toHaveLength(100)
    expect(conversation[0]).not.toHaveProperty('ownerId')
    expect(Math.max(...conversation.map((message) => message.content.length))).toBeLessThanOrEqual(4_000)
    expect(conversation.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(36_000)
    expect(() => coachRunRequestSchema.parse(request)).not.toThrow()
    const capped = boundConversation(Array.from({ length: 105 }, (_, index) => ({ id: `cap-${index}`, ownerId: accountId, runId: `cap-run-${index}`, role: 'user' as const, content: 'y'.repeat(400), createdAt: index, contextVersion: 'ctx' })))
    expect(capped.reduce((total, message) => total + message.content.length, 0)).toBe(36_000)

    const legacy = structuredClone(request)
    legacy.context.snapshot.conversation = legacy.context.snapshot.conversation.map((message) => ({ ...message, ownerId: accountId }))
    const normalized = normalizeCoachRequestForTransport(legacy)
    expect(normalized.event.id).toBe(request!.event.id)
    expect(normalized.context.snapshot.conversation[0]).not.toHaveProperty('ownerId')
    expect(() => coachRunRequestSchema.parse(normalized)).not.toThrow()
  })

  it('rejects an invalid new message before persisting it and allows the next valid message', async () => {
    await expect(startCoachRun(async () => 'test-token', 'x'.repeat(4_001))).rejects.toThrow('4000')
    expect(await db.coachMessages.count()).toBe(0)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'La beta del coach está cerrada' }), { status: 403 })))
    const result = await startCoachRun(async () => 'test-token', 'Siguiente mensaje válido')
    expect(result.status).toBe('failed')
    expect(await db.coachMessages.count()).toBe(1)
  })

  it('enqueues one durable coach review per finished workout', async () => {
    await queueCoachSessionFinished('workout-once')
    await queueCoachSessionFinished('workout-once')
    expect(await db.coachRuns.count()).toBe(1)
    const run = await db.coachRuns.toCollection().first()
    expect(run?.request.event.id).toBe('coach-session-finished-workout-once')
    expect(run?.request.event.type).toBe('session-finished')
  })
})

function request() {
  return {
    event: { id: 'event-coach-apply', accountId, deviceId: 'device-test', type: 'message-sent' as const, occurredAt: 1, contextVersion, payload: { message: 'Ajusta la rutina' } },
    context: { version: contextVersion, capturedAt: 1, timezone: 'UTC', isCurrent: true, snapshot: {} },
  }
}

function routine(): Routine {
  return {
    id: routineId, name: 'Rutina de prueba', sortOrder: 0, createdAt: 1, revision: 1, scheduledAt: 123_456,
    trainingRole: 'strength', loadIncrementKg: 2.5, coachReviewed: false,
    exercises: [{ occurrenceId: `${routineId}:0:squat`, exerciseId: 'squat', plannedSets: 3, setTargets: [], restSec: 120, notes: 'Nota existente', repRangeMin: 5, repRangeMax: 8, trainingRole: 'strength', loadIncrementKg: 2.5 }],
  }
}

function run(): CoachRunRecord {
  const operationId = 'operation-coach-apply'
  return {
    id: 'run-coach-apply', ownerId: accountId, eventId: 'event-coach-apply', contextVersion, status: 'completed', request: request(), createdAt: 1, updatedAt: 1,
    decision: {
      kind: 'propose', explanation: 'Aumentar una serie con evidencia.', observations: [], evidence: [],
      changeSet: {
        id: 'changeset-coach-apply', accountId, eventId: 'event-coach-apply', domain: 'training', expectedContextVersion: contextVersion,
        explanation: 'Aumentar una serie con evidencia.', observations: [], evidence: [], createdAt: 1, policyVersion: 'v1',
        operations: [{ kind: 'routine', operationId, expectedRevision: 1, routineId, occurrenceId: `${routineId}:0:squat`, patch: { plannedSets: 4 } }],
      },
    },
  }
}

describe('applyCoachChangeSet', () => {
  beforeEach(async () => {
    setCoachAccountId(accountId)
    await db.routines.clear()
    await db.coachRuns.clear()
    await db.routineRevisionSnapshots.clear()
    await db.routines.put(routine())
    await db.coachRuns.put(run())
  })

  afterEach(async () => {
    await db.routines.clear()
    await db.coachRuns.clear()
    await db.routineRevisionSnapshots.clear()
    setCoachAccountId(null)
  })

  it('aplica una propuesta confirmada atomically y conserva snapshot de la revisión anterior', async () => {
    await applyCoachChangeSet('run-coach-apply')

    const updated = await db.routines.get(routineId)
    const savedRun = await db.coachRuns.get('run-coach-apply')
    const snapshot = await db.routineRevisionSnapshots.get(`${routineId}:revision:1`)
    expect(updated?.revision).toBe(2)
    expect(updated?.exercises[0]?.plannedSets).toBe(4)
    expect(savedRun?.appliedAt).toEqual(expect.any(Number))
    expect(snapshot?.routine.exercises[0]?.plannedSets).toBe(3)
  })

  it('rechaza una propuesta obsoleta sin escribir cambios parciales', async () => {
    await db.routines.put({ ...routine(), revision: 2 })

    await expect(applyCoachChangeSet('run-coach-apply')).rejects.toThrow('La rutina cambió')
    expect((await db.routines.get(routineId))?.exercises[0]?.plannedSets).toBe(3)
    expect(await db.routineRevisionSnapshots.count()).toBe(0)
    expect((await db.coachRuns.get('run-coach-apply'))?.appliedAt).toBeUndefined()
  })

  it('conserva programación y campos no editados al aplicar un futurePlan', async () => {
    const next = run()
    if (next.decision?.kind !== 'propose') throw new Error('fixture inválido')
    next.decision.changeSet.futurePlan = {
      horizon: 'next-session',
      sessions: [{
        sessionId: routineId, name: 'Rutina de prueba', expectedRevision: 1,
        exercises: [{ occurrenceId: `${routineId}:0:squat`, exerciseId: 'squat', order: 0, plannedSets: 4, setTargets: [{ type: 'normal' }, { type: 'normal' }, { type: 'normal' }, { type: 'normal' }], repRangeMin: 5, repRangeMax: 8 }],
      }],
    }
    await db.coachRuns.put(next)
    await applyCoachChangeSet(next.id)
    const updated = await db.routines.get(routineId)
    expect(updated?.scheduledAt).toBe(123_456)
    expect(updated?.exercises[0]?.notes).toBe('Nota existente')
    expect(updated?.exercises[0]?.plannedSets).toBe(4)
  })
})

describe('coach context identity', () => {
  it('invalidates the context when consent or profile revisions change', () => {
    const base = { profileRevision: 1, consentVersion: 'coach-beta-v1', consentRevision: 4, goals: ['fuerza'] }
    expect(contextVersionFromSnapshot(base)).not.toBe(contextVersionFromSnapshot({ ...base, profileRevision: 2 }))
    expect(contextVersionFromSnapshot(base)).not.toBe(contextVersionFromSnapshot({ ...base, consentRevision: 5 }))
  })
})
