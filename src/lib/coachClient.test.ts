import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { setCoachAccountId } from './coachAccount'
import { applyCoachChangeSet, contextVersionFromSnapshot } from './coachClient'
import type { CoachRunRecord, Routine } from '../db/types'

const accountId = 'user_coach_apply_test'
const routineId = 'routine-coach-test'
const contextVersion = `coach-context-${routineId}:1`

function request() {
  return {
    event: { id: 'event-coach-apply', accountId, deviceId: 'device-test', type: 'message-sent' as const, occurredAt: 1, contextVersion, payload: { message: 'Ajusta la rutina' } },
    context: { version: contextVersion, capturedAt: 1, timezone: 'UTC', isCurrent: true, snapshot: {} },
  }
}

function routine(): Routine {
  return {
    id: routineId, name: 'Rutina de prueba', sortOrder: 0, createdAt: 1, revision: 1,
    trainingRole: 'strength', loadIncrementKg: 2.5, coachReviewed: false,
    exercises: [{ occurrenceId: `${routineId}:0:squat`, exerciseId: 'squat', plannedSets: 3, setTargets: [], restSec: 120, repRangeMin: 5, repRangeMax: 8, trainingRole: 'strength', loadIncrementKg: 2.5 }],
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
})

describe('coach context identity', () => {
  it('invalidates the context when consent or profile revisions change', () => {
    const base = { profileRevision: 1, consentVersion: 'coach-beta-v1', consentRevision: 4, goals: ['fuerza'] }
    expect(contextVersionFromSnapshot(base)).not.toBe(contextVersionFromSnapshot({ ...base, profileRevision: 2 }))
    expect(contextVersionFromSnapshot(base)).not.toBe(contextVersionFromSnapshot({ ...base, consentRevision: 5 }))
  })
})
