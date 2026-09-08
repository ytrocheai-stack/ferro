import { canonicalJson, type AdaptationSet, type ExerciseAnalysisInput, type Exposure } from '../../packages/adaptation-core/src/index'
import { db } from '../db/db'
import type { AdaptationJob, FrozenAdaptationRequest, PostWorkoutFeedback, Routine, Workout, WorkoutExercise } from '../db/types'
import { COACH_CONSENT_VERSION, getCoachDeviceId } from './coachConsent'
import { getCoachAccountId } from './coachAccount'
import { CONTEXT_INVALIDATED_MESSAGE } from './adaptationErrors'

export const ADAPTATION_PROCESSING_LEASE_MS = 15 * 60_000

export interface AdaptationContextSnapshot {
  workoutId: string
  routineId: string
  routineRevision: number
  payload: FrozenAdaptationRequest
  contextKey: string
}

function toFeedback(feedback: PostWorkoutFeedback | undefined, exerciseId: string) {
  if (!feedback) return undefined
  return {
    completed: feedback.completed,
    generalPain: feedback.generalPain,
    exercisePain: feedback.exercisePain?.includes(exerciseId),
    energy: feedback.energy,
    difficulty: feedback.difficulty,
    contradictory: feedback.contradictory,
  }
}

function toExposure(workout: Workout, exercise: WorkoutExercise): Exposure {
  const prescription = exercise.prescription
  const executedSets = exercise.executedSets ?? exercise.sets
  const plannedSets = prescription?.plannedSets ?? exercise.plannedSets ?? executedSets.filter((set) => set.type !== 'warmup').length
  return {
    workoutId: workout.id,
    startedAt: workout.startedAt,
    exerciseId: exercise.exerciseId,
    occurrenceId: exercise.occurrenceId ?? prescription?.occurrenceId,
    role: prescription?.trainingRole ?? exercise.trainingRole ?? exercise.role ?? 'hypertrophy',
    repRangeMin: prescription?.repRangeMin ?? exercise.repRangeMin ?? 8,
    repRangeMax: prescription?.repRangeMax ?? exercise.repRangeMax ?? 12,
    targetRpeMin: prescription?.targetRpeMin ?? exercise.targetRpeMin,
    targetRpeMax: prescription?.targetRpeMax ?? exercise.targetRpeMax,
    loadIncrementKg: prescription?.loadIncrementKg ?? exercise.loadIncrementKg ?? 2.5,
    plannedSets: Math.max(1, plannedSets),
    plannedRepsMin: prescription?.repRangeMin ?? exercise.repRangeMin,
    plannedRepsMax: prescription?.repRangeMax ?? exercise.repRangeMax,
    sets: executedSets.map((set): AdaptationSet => ({
      type: set.type,
      weightKg: set.weightKg,
      reps: set.reps,
      completed: set.completed,
      rpe: set.rpe,
      rir: set.rir,
    })),
    feedback: toFeedback(workout.postWorkoutFeedback, exercise.exerciseId),
  }
}

export async function inputsForWorkout(workout: Workout): Promise<ExerciseAnalysisInput[]> {
  const previous = (await db.workouts.orderBy('startedAt').reverse().toArray()).filter((item) => item.id !== workout.id && item.startedAt < workout.startedAt)
  return workout.exercises.map((exercise) => {
    const current: ExerciseAnalysisInput = { ...toExposure(workout, exercise), previousExposures: [] }
    current.previousExposures = previous
      .filter((item) => item.routineId !== undefined && item.routineRevision !== undefined)
      .flatMap((item) => item.exercises
        .filter((candidate) => (candidate.occurrenceId === exercise.occurrenceId || candidate.prescription?.occurrenceId === exercise.occurrenceId) && (candidate.prescription !== undefined || candidate.plannedSets !== undefined))
        .map((candidate) => toExposure(item, candidate)))
      .slice(0, 6)
    return current
  })
}

export function buildContextKey(
  workout: Pick<Workout, 'id' | 'routineId' | 'routineRevision'>,
  inputs: ExerciseAnalysisInput[],
  routine?: Routine,
): string {
  return canonicalJson({
    workoutId: workout.id,
    routineId: workout.routineId,
    routineRevision: workout.routineRevision,
    routine: routine ?? null,
    inputs,
  })
}

export async function buildAdaptationContext(
  workout: Workout,
  requestMeta: Partial<Pick<FrozenAdaptationRequest, 'consentVersion' | 'deviceId'>> = {},
): Promise<AdaptationContextSnapshot> {
  const routine = workout.routineId ? await db.routines.get(workout.routineId) : undefined
  const payload: FrozenAdaptationRequest = {
    inputs: await inputsForWorkout(workout),
    consentVersion: requestMeta.consentVersion ?? COACH_CONSENT_VERSION,
    deviceId: requestMeta.deviceId ?? getCoachDeviceId(),
  }
  return {
    workoutId: workout.id,
    routineId: workout.routineId!,
    routineRevision: workout.routineRevision!,
    payload,
    contextKey: buildContextKey(workout, payload.inputs, routine),
  }
}

export async function readCurrentAdaptationContext(
  workoutId: string,
  requestMeta: Partial<Pick<FrozenAdaptationRequest, 'consentVersion' | 'deviceId'>> = {},
): Promise<{ workout: Workout; routine: Routine | undefined; context: AdaptationContextSnapshot } | null> {
  const workout = await db.workouts.get(workoutId)
  if (!workout?.routineId || workout.routineRevision === undefined) return null
  const routine = await db.routines.get(workout.routineId)
  const context = await buildAdaptationContext(workout, requestMeta)
  return { workout, routine, context }
}

export function isRoutineContextCurrent(workout: Pick<Workout, 'routineId' | 'routineRevision'>, routine: Routine | undefined): boolean {
  return Boolean(workout.routineId && workout.routineRevision !== undefined && routine?.coachReviewed && (routine.revision ?? 1) === workout.routineRevision)
}

async function stalePendingProposalsInTransaction(ownerId: string, matcher: (analysis: { analysisId: string; requestId?: string; workoutId?: string; contextKey?: string; status: string; ownerId?: string }) => boolean): Promise<void> {
  const proposals = await db.adaptationProposals.toArray()
  const stale = proposals.filter((proposal) => proposal.ownerId === ownerId && proposal.status === 'pending' && matcher(proposal)).map((proposal) => ({ ...proposal, status: 'stale' as const }))
  if (stale.length) await db.adaptationProposals.bulkPut(stale)
}

export async function invalidateAdaptationJobInTransaction(job: AdaptationJob, reason = CONTEXT_INVALIDATED_MESSAGE): Promise<void> {
  if (!job.ownerId) return
  await stalePendingProposalsInTransaction(job.ownerId, (proposal) =>
    (job.requestId !== undefined && proposal.requestId === job.requestId) ||
    (job.workoutId !== undefined && proposal.workoutId === job.workoutId) ||
    (job.analysisId !== undefined && proposal.analysisId === job.analysisId),
  )
  await db.adaptationJobs.put({
    ...job,
    status: 'failed',
    nextRetryAt: undefined,
    updatedAt: Date.now(),
    lastError: reason,
    errorCode: 'context-invalidated',
    runId: undefined,
    leaseExpiresAt: undefined,
  })
}

export async function invalidateStaleAdaptationJobsInTransaction(ownerId = getCoachAccountId(), reason = CONTEXT_INVALIDATED_MESSAGE): Promise<number> {
  if (!ownerId) return 0
  let invalidated = 0
  const jobs = await db.adaptationJobs.where('ownerId').equals(ownerId).toArray()
  for (const job of jobs) {
    const needsReview = job.status !== 'completed' || await db.adaptationProposals.toArray().then((proposals) => proposals.some((proposal) => proposal.ownerId === ownerId && proposal.status === 'pending' && (
      (job.requestId !== undefined && proposal.requestId === job.requestId) ||
      (proposal.workoutId !== undefined && proposal.workoutId === job.workoutId) ||
      (job.analysisId !== undefined && proposal.analysisId === job.analysisId)
    )))
    if (!needsReview) continue
    if (!job.requestId || !job.contextKey || !job.payload) {
      await invalidateAdaptationJobInTransaction(job, reason)
      invalidated += 1
      continue
    }
    const current = await readCurrentAdaptationContext(job.workoutId, job.payload)
    if (!current || !isRoutineContextCurrent(current.workout, current.routine) || current.context.contextKey !== job.contextKey) {
      await invalidateAdaptationJobInTransaction(job, reason)
      invalidated += 1
    }
  }
  return invalidated
}
