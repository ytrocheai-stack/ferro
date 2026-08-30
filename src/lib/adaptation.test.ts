import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { AdaptationProposal, Routine } from '../db/types'
import { applyAdaptationDecisions, revertAdaptationAnalysis } from './adaptation'

const routine = (overrides: Partial<Routine> = {}): Routine => ({
  id: 'routine-1', name: 'Fuerza', sortOrder: 1, createdAt: 1, revision: 1, trainingRole: 'strength', loadIncrementKg: 2.5, coachReviewed: true,
  exercises: [{ exerciseId: 'squat', plannedSets: 3, repRangeMin: 5, repRangeMax: 8, loadIncrementKg: 2.5, restSec: 120, setTargets: [{ type: 'normal', weightKg: 100, reps: 5 }, { type: 'normal', weightKg: 100, reps: 5 }, { type: 'normal', weightKg: 100, reps: 5 }] }], ...overrides,
})
const candidate = (kind: AdaptationProposal['candidate']['kind'] = 'increase-reps'): AdaptationProposal['candidate'] => ({
  candidateId: `c-${kind}`, kind, rule: 'v1:test', exerciseId: 'squat', previous: { plannedSets: 3, repsMin: 5, repsMax: 8, loadKg: 100 }, next: { plannedSets: kind === 'add-set' ? 4 : 3, repsMin: kind === 'increase-reps' ? 6 : 5, repsMax: 8, loadKg: 100 }, evidence: { comparableWorkoutIds: ['a', 'b', 'c'], comparableCount: 3, completedUpperBoundCount: 0, discreteIncreaseCount: 0 }, confidence: 'medium', warnings: [], explanation: 'test',
})

describe('adaptation persistence', () => {
  beforeEach(async () => { await db.delete(); await db.open() })

  it('upgrades a real v3 database and normalizes routines', async () => {
    await db.close(); await db.delete()
    const old = new Dexie('ferro')
    old.version(3).stores({ workouts: 'id, startedAt', routines: 'id, sortOrder, folderId', customExercises: 'id', folders: 'id, sortOrder', measurements: 'id, date, kind, [kind+date]', photos: 'id, date', foods: 'id, name, source, usedAt, offCode, usdaFdcId', dishes: 'id, name', foodLog: 'id, date, [date+meal]', importBatches: 'id, source, createdAt, status', externalRefs: '&key, source, entity, localId, batchId' })
    await old.open(); await old.table('routines').put({ id: 'legacy', name: 'Legacy', sortOrder: 1, createdAt: 1, exercises: [] }); await old.close()
    await db.open()
    await expect(db.routines.get('legacy')).resolves.toMatchObject({ revision: 1, trainingRole: 'hypertrophy', loadIncrementKg: 2.5, coachReviewed: false })
  })

  it('applies every decision atomically and reverts the complete batch', async () => {
    await db.routines.put(routine())
    const item = candidate()
    await db.adaptationProposals.bulkPut([
      { id: 'p1', analysisId: 'a1', baseRoutineId: 'routine-1', baseRoutineRevision: 1, exerciseId: 'squat', status: 'pending', createdAt: 1, candidateId: item.candidateId, candidate: item, candidateOptions: [item], proposalRevision: 1 },
    ])
    const applied = await applyAdaptationDecisions('a1', [{ proposalId: 'p1', decision: 'accept', candidateId: item.candidateId }])
    expect(applied).toMatchObject({ status: 'applied', routineRevision: 2 })
    expect((await db.routines.get('routine-1'))?.exercises[0].repRangeMin).toBe(6)
    expect((await db.routineRevisionSnapshots.get('routine-1:revision:1'))?.routine.exercises[0].setTargets).toHaveLength(3)
    expect(await revertAdaptationAnalysis('a1')).toBe(3)
    expect((await db.routines.get('routine-1'))?.exercises[0].repRangeMin).toBe(5)
  })

  it('marks the full analysis stale without mutating the routine when revision changed', async () => {
    await db.routines.put(routine({ revision: 2 }))
    const item = candidate()
    await db.adaptationProposals.put({ id: 'p1', analysisId: 'a2', baseRoutineId: 'routine-1', baseRoutineRevision: 1, exerciseId: 'squat', status: 'pending', createdAt: 1, candidateId: item.candidateId, candidate: item, candidateOptions: [item], proposalRevision: 1 })
    const result = await applyAdaptationDecisions('a2', [{ proposalId: 'p1', decision: 'accept', candidateId: item.candidateId }])
    expect(result.status).toBe('stale')
    expect(await db.adaptationProposals.get('p1')).toMatchObject({ status: 'stale' })
    expect((await db.routines.get('routine-1'))?.revision).toBe(2)
  })
})
