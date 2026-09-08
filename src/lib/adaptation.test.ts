import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { AdaptationProposal, Routine, Workout } from '../db/types'
import { applyAdaptationDecisions, createEditedProposal, revertAdaptationAnalysis } from './adaptation'
import { buildAdaptationContext } from './adaptationContext'
import { setCoachAccountId } from './coachAccount'

const routine = (overrides: Partial<Routine> = {}): Routine => ({
  id: 'routine-1',
  name: 'Fuerza',
  sortOrder: 1,
  createdAt: 1,
  revision: 1,
  trainingRole: 'strength',
  loadIncrementKg: 2.5,
  coachReviewed: true,
  exercises: [{
    exerciseId: 'squat',
    occurrenceId: 'routine-1:0:squat',
    plannedSets: 3,
    repRangeMin: 5,
    repRangeMax: 8,
    loadIncrementKg: 2.5,
    restSec: 120,
    setTargets: [
      { type: 'normal', weightKg: 100, reps: 5 },
      { type: 'normal', weightKg: 100, reps: 5 },
      { type: 'normal', weightKg: 100, reps: 5 },
    ],
  }],
  ...overrides,
})

const workout = (overrides: Partial<Workout> = {}): Workout => ({
  id: 'workout-1',
  name: 'Fuerza',
  startedAt: 2,
  endedAt: 3,
  routineId: 'routine-1',
  routineRevision: 1,
  volumeKg: 1500,
  totalSets: 3,
  prs: [],
  exercises: [{
    exerciseId: 'squat',
    occurrenceId: 'routine-1:0:squat',
    restSec: 120,
    plannedSets: 3,
    repRangeMin: 5,
    repRangeMax: 8,
    trainingRole: 'strength',
    sets: [
      { type: 'normal', weightKg: 100, reps: 5, completed: true },
      { type: 'normal', weightKg: 100, reps: 5, completed: true },
      { type: 'normal', weightKg: 100, reps: 5, completed: true },
    ],
    prescription: {
      occurrenceId: 'routine-1:0:squat',
      plannedSets: 3,
      restSec: 120,
      repRangeMin: 5,
      repRangeMax: 8,
      trainingRole: 'strength',
      loadIncrementKg: 2.5,
    },
  }],
  ...overrides,
})

const candidate = (kind: AdaptationProposal['candidate']['kind'] = 'increase-reps'): AdaptationProposal['candidate'] => ({
  candidateId: `c-${kind}`,
  kind,
  rule: 'v1:test',
  exerciseId: 'squat',
  occurrenceId: 'routine-1:0:squat',
  previous: { plannedSets: 3, repsMin: 5, repsMax: 8, loadKg: 100 },
  next: { plannedSets: kind === 'add-set' ? 4 : 3, repsMin: kind === 'increase-reps' ? 6 : 5, repsMax: 8, loadKg: 100 },
  evidence: { comparableWorkoutIds: ['a', 'b', 'c'], comparableCount: 3, completedUpperBoundCount: 0, discreteIncreaseCount: 0 },
  confidence: 'medium',
  warnings: [],
  explanation: 'test',
})

async function seedPendingProposal(
  analysisId: string,
  proposalId: string,
  item: AdaptationProposal['candidate'],
  options: {
    routineOverrides?: Partial<Routine>
    workoutOverrides?: Partial<Workout>
    candidates?: AdaptationProposal['candidate'][]
  } = {},
) {
  const baseRoutine = routine(options.routineOverrides)
  const baseWorkout = workout(options.workoutOverrides)
  await db.routines.put(baseRoutine)
  await db.workouts.put(baseWorkout)
  const context = await buildAdaptationContext(baseWorkout)
  await db.adaptationProposals.put({
    id: proposalId,
    ownerId: 'user-1',
    workoutId: baseWorkout.id,
    requestId: `req-${analysisId}`,
    contextKey: context.contextKey,
    analysisId,
    baseRoutineId: baseRoutine.id,
    baseRoutineRevision: baseWorkout.routineRevision!,
    exerciseId: 'squat',
    status: 'pending',
    createdAt: 1,
    candidateId: item.candidateId,
    candidate: item,
    candidateOptions: options.candidates ?? [item],
    proposalRevision: 1,
    occurrenceId: 'routine-1:0:squat',
  })
}

describe('adaptation persistence', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    setCoachAccountId('user-1')
  })

  it('upgrades a real v3 database and normalizes routines', async () => {
    await db.close()
    await db.delete()
    const old = new Dexie('ferro')
    old.version(3).stores({ workouts: 'id, startedAt', routines: 'id, sortOrder, folderId', customExercises: 'id', folders: 'id, sortOrder', measurements: 'id, date, kind, [kind+date]', photos: 'id, date', foods: 'id, name, source, usedAt, offCode, usdaFdcId', dishes: 'id, name', foodLog: 'id, date, [date+meal]', importBatches: 'id, source, createdAt, status', externalRefs: '&key, source, entity, localId, batchId' })
    await old.open()
    await old.table('routines').put({ id: 'legacy', name: 'Legacy', sortOrder: 1, createdAt: 1, exercises: [] })
    await old.close()
    await db.open()
    await expect(db.routines.get('legacy')).resolves.toMatchObject({ revision: 1, trainingRole: 'hypertrophy', loadIncrementKg: 2.5, coachReviewed: false })
  })

  it('applies every decision atomically and reverts the complete batch', async () => {
    const item = candidate()
    await seedPendingProposal('a1', 'p1', item)
    const applied = await applyAdaptationDecisions('a1', [{ proposalId: 'p1', decision: 'accept', candidateId: item.candidateId }])
    expect(applied).toMatchObject({ status: 'applied', routineRevision: 2 })
    expect((await db.routines.get('routine-1'))?.exercises[0].repRangeMin).toBe(6)
    expect((await db.routineRevisionSnapshots.get('routine-1:revision:1'))?.routine.exercises[0].setTargets).toHaveLength(3)
    expect(await revertAdaptationAnalysis('a1')).toBe(3)
    expect((await db.routines.get('routine-1'))?.exercises[0].repRangeMin).toBe(5)
  })

  it('updates per-set targets when increase-reps keeps the existing load', async () => {
    const item = { ...candidate(), next: { ...candidate().next, loadKg: undefined } }
    await seedPendingProposal('reps-analysis', 'reps', item)
    await expect(applyAdaptationDecisions('reps-analysis', [{ proposalId: 'reps', decision: 'accept', candidateId: item.candidateId }])).resolves.toMatchObject({ status: 'applied' })
    expect((await db.routines.get('routine-1'))?.exercises[0].setTargets?.map((set) => set.reps)).toEqual([6, 6, 6])
    expect((await db.routines.get('routine-1'))?.exercises[0].setTargets?.map((set) => set.weightKg)).toEqual([100, 100, 100])
  })

  it('preserves warmup targets while changing only the requested work sets', async () => {
    const warmRoutine = routine({
      exercises: [{
        ...routine().exercises[0],
        setTargets: [
          { type: 'warmup', weightKg: 40, reps: 10 },
          { type: 'normal', weightKg: 100, reps: 5 },
          { type: 'normal', weightKg: 100, reps: 5 },
          { type: 'normal', weightKg: 100, reps: 5 },
        ],
      }],
    })
    const item = candidate()
    await seedPendingProposal('warmup-analysis', 'warmup', item, { routineOverrides: warmRoutine, workoutOverrides: { exercises: [{ ...workout().exercises[0], prescription: { ...workout().exercises[0].prescription!, occurrenceId: 'routine-1:0:squat' } }] } })

    await expect(applyAdaptationDecisions('warmup-analysis', [{ proposalId: 'warmup', decision: 'accept', candidateId: item.candidateId }])).resolves.toMatchObject({ status: 'applied' })
    expect((await db.routines.get('routine-1'))?.exercises[0].setTargets).toEqual([
      { type: 'warmup', weightKg: 40, reps: 10 },
      { type: 'normal', weightKg: 100, reps: 6 },
      { type: 'normal', weightKg: 100, reps: 6 },
      { type: 'normal', weightKg: 100, reps: 6 },
    ])
  })

  it('marks the full analysis stale without mutating the routine when revision changed', async () => {
    const item = candidate()
    await seedPendingProposal('a2', 'p1', item, { routineOverrides: { revision: 2 } })
    const result = await applyAdaptationDecisions('a2', [{ proposalId: 'p1', decision: 'accept', candidateId: item.candidateId }])
    expect(result.status).toBe('stale')
    expect(await db.adaptationProposals.get('p1')).toMatchObject({ status: 'stale' })
    expect((await db.routines.get('routine-1'))?.revision).toBe(2)
  })

  it('marks proposals stale when the workout context changed before applying them', async () => {
    const item = candidate()
    await db.workouts.put(workout({ id: 'previous', startedAt: 1, endedAt: 2 }))
    await seedPendingProposal('ctx-analysis', 'ctx', item)
    await db.workouts.update('previous', {
      exercises: [{
        ...workout().exercises[0],
        sets: [
          { type: 'normal', weightKg: 95, reps: 5, completed: true },
          { type: 'normal', weightKg: 95, reps: 5, completed: true },
          { type: 'normal', weightKg: 95, reps: 5, completed: true },
        ],
      }],
    })
    const result = await applyAdaptationDecisions('ctx-analysis', [{ proposalId: 'ctx', decision: 'accept', candidateId: item.candidateId }])
    expect(result.status).toBe('stale')
    expect(await db.adaptationProposals.get('ctx')).toMatchObject({ status: 'stale' })
  })

  it('recalculates the displayed fields when a pending candidate is edited', async () => {
    const original = candidate()
    const alternative = { ...original, candidateId: 'c-alternative', kind: 'increase-load' as const, next: { ...original.next, loadKg: 102.5 } }
    await db.adaptationProposals.put({ id: 'edit', ownerId: 'user-1', analysisId: 'edit-analysis', baseRoutineId: 'routine-1', baseRoutineRevision: 1, exerciseId: 'squat', status: 'pending', createdAt: 1, candidateId: original.candidateId, candidate: original, candidateOptions: [original, alternative], proposalRevision: 1 })
    const edited = await createEditedProposal('edit', alternative.candidateId)
    expect(edited.proposedValues).toEqual(alternative.next)
    expect(edited.candidateId).toBe(alternative.candidateId)
    expect((await db.adaptationProposals.get('edit'))?.status).toBe('edited')
  })
})
