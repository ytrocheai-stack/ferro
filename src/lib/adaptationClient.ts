import type { ExerciseAnalysisInput, AdaptationSet } from '../../packages/adaptation-core/src/index'
import { db } from '../db/db'
import type { AdaptationProposal, PostWorkoutFeedback, Workout, WorkoutExercise } from '../db/types'
import { z } from 'zod'

const workerUrl = (import.meta.env.VITE_ADAPTATION_WORKER_URL as string | undefined)?.replace(/\/$/, '')

function toFeedback(feedback: PostWorkoutFeedback | undefined, exerciseId: string) {
  if (!feedback) return undefined
  return { completed: feedback.completed, generalPain: feedback.generalPain, exercisePain: feedback.exercisePain?.includes(exerciseId), energy: feedback.energy, difficulty: feedback.difficulty, contradictory: feedback.contradictory }
}
function toExposure(workout: Workout, exercise: WorkoutExercise): ExerciseAnalysisInput {
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
    sets: executedSets.map((set): AdaptationSet => ({ type: set.type, weightKg: set.weightKg, reps: set.reps, completed: set.completed, rpe: set.rpe })),
    feedback: toFeedback(workout.postWorkoutFeedback, exercise.exerciseId),
    previousExposures: [],
  }
}

async function inputsForWorkout(workout: Workout): Promise<ExerciseAnalysisInput[]> {
  const previous = (await db.workouts.orderBy('startedAt').reverse().toArray()).filter((item) => item.id !== workout.id && item.startedAt < workout.startedAt)
  return workout.exercises.map((exercise) => {
    const current = toExposure(workout, exercise)
    current.previousExposures = previous
      .filter((item) => item.routineId !== undefined && item.routineRevision !== undefined)
      .flatMap((item) => item.exercises
        .filter((candidate) => (candidate.occurrenceId === exercise.occurrenceId || candidate.prescription?.occurrenceId === exercise.occurrenceId) && (candidate.prescription !== undefined || candidate.plannedSets !== undefined))
        .map((candidate) => toExposure(item, candidate)))
      .slice(0, 6)
    return current
  })
}

export async function enqueueAdaptationJob(workoutId: string): Promise<void> {
  const workout = await db.workouts.get(workoutId)
  if (!workout?.routineId || workout.routineRevision === undefined) return
  const now = Date.now()
  await db.adaptationJobs.put({ id: `adapt-${workoutId}`, workoutId, status: 'pending', createdAt: now, updatedAt: now, attempts: 0 })
}

export async function retryFailedAdaptationJob(jobId: string): Promise<void> {
  const job = await db.adaptationJobs.get(jobId)
  if (!job || job.status !== 'failed') return
  await db.adaptationJobs.update(jobId, { status: 'pending', nextRetryAt: undefined, lastError: undefined, updatedAt: Date.now() })
}

export async function enqueueAdaptationEvent(event: { analysisId: string; exerciseId: string; candidateId?: string; event: 'accepted' | 'rejected' | 'edited' | 'reverted' }): Promise<void> {
  await db.adaptationEventJobs.put({ id: `event-${event.analysisId}-${event.exerciseId}-${event.event}-${Date.now()}`, ...event, status: 'pending', createdAt: Date.now(), attempts: 0 })
}

export async function processPendingAdaptationEvents(getToken: () => Promise<string | null>): Promise<void> {
  if (!workerUrl || !navigator.onLine) return
  const token = await getToken()
  if (!token) return
  const jobs = await db.adaptationEventJobs.where('status').equals('pending').toArray()
  for (const job of jobs) {
    if (job.nextRetryAt && job.nextRetryAt > Date.now()) continue
    try {
      const response = await fetch(`${workerUrl}/v1/adaptations/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ analysisId: job.analysisId, exerciseId: job.exerciseId, candidateId: job.candidateId ?? null, event: job.event }) })
      if (!response.ok) throw new Error(`Worker ${response.status}`)
      await db.adaptationEventJobs.update(job.id, { status: 'sent' })
    } catch {
      const attempts = job.attempts + 1
      await db.adaptationEventJobs.update(job.id, { status: attempts >= 3 ? 'failed' : 'pending', attempts, nextRetryAt: Date.now() + Math.min(60_000, attempts * 10_000) })
    }
  }
}

const workerResponseSchema = z.object({
  analysisId: z.string().min(1),
  policyVersion: z.string().min(1),
  corpusVersion: z.string().optional(),
  provider: z.enum(['deterministic', 'flash', 'pro']).optional(),
  pendingExplanation: z.boolean().optional(),
  idempotent: z.boolean().optional(),
  decisions: z.array(z.object({ exerciseId: z.string().min(1), occurrenceId: z.string().optional(), fallbackCandidateId: z.string().min(1), selectedCandidateId: z.string().optional(), candidates: z.array(z.unknown()).min(1) }).strict()).min(1),
}).strict()

function parseCandidate(value: unknown): AdaptationProposal['candidate'] {
  const result = z.object({
    candidateId: z.string().min(1), kind: z.enum(['maintain', 'increase-reps', 'increase-load', 'add-set', 'reduce-load', 'reduce-set']), rule: z.string().min(1), exerciseId: z.string().min(1),
    previous: z.object({ plannedSets: z.number().finite(), repsMin: z.number().finite(), repsMax: z.number().finite(), loadKg: z.number().finite().optional() }).strict(),
    next: z.object({ plannedSets: z.number().finite(), repsMin: z.number().finite(), repsMax: z.number().finite(), loadKg: z.number().finite().optional() }).strict(),
    evidence: z.object({ comparableWorkoutIds: z.array(z.string()), comparableCount: z.number().finite(), medianWeightKg: z.number().finite().optional(), medianReps: z.number().finite().optional(), completedUpperBoundCount: z.number().finite(), discreteIncreaseCount: z.number().finite(), currentE1rmKg: z.number().finite().optional(), medianPreviousE1rmKg: z.number().finite().optional() }).strict(),
    confidence: z.enum(['low', 'medium', 'high']), warnings: z.array(z.string()), citations: z.array(z.string()).optional(), explanation: z.string(),
  }).strict().safeParse(value)
  if (!result.success) throw new Error('El Worker devolvió un candidato inválido')
  return result.data
}

export async function processPendingAdaptationJobs(getToken: () => Promise<string | null>): Promise<void> {
  if (!workerUrl || !navigator.onLine) return
  const now = Date.now()
  const jobs = (await db.adaptationJobs.toArray()).filter((job) => job.status === 'pending' || (job.status === 'processing' && now - (job.updatedAt ?? job.createdAt) > 15 * 60_000))
  for (const job of jobs) {
    if (job.nextRetryAt && job.nextRetryAt > now) continue
    const workout = await db.workouts.get(job.workoutId)
    if (!workout?.routineId || workout.routineRevision === undefined) { await db.adaptationJobs.update(job.id, { status: 'completed' }); continue }
    const routine = await db.routines.get(workout.routineId)
    if (!routine?.coachReviewed) continue
    const token = await getToken()
    if (!token) return
    await db.adaptationJobs.update(job.id, { status: 'processing', attempts: (job.attempts ?? 0) + 1, updatedAt: Date.now() })
    try {
      const response = await fetch(`${workerUrl}/v1/adaptations/analyze`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': job.id }, body: JSON.stringify({ inputs: await inputsForWorkout(workout) }) })
      if (!response.ok) throw new Error(`Worker ${response.status}`)
      const parsed = workerResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('Respuesta del Worker inválida')
      const body = parsed.data
      const decisions = body.decisions.map((decision) => ({ ...decision, candidates: decision.candidates.map(parseCandidate) }))
      const options = decisions.flatMap((decision) => decision.candidates)
      const now = Date.now()
      await db.transaction('rw', [db.adaptationJobs, db.adaptationProposals], async () => {
        for (const decision of decisions) {
          const candidates = decision.candidates
          const selected = candidates.find((candidate) => candidate.candidateId === decision.selectedCandidateId) ?? candidates.find((candidate) => candidate.candidateId === decision.fallbackCandidateId) ?? candidates.find((candidate) => candidate.kind === 'maintain') ?? candidates[0]
          if (!selected) continue
          const proposal: AdaptationProposal = {
            id: `${body.analysisId}-${decision.exerciseId}-${decision.occurrenceId ?? 'default'}`,
            analysisId: body.analysisId,
            baseRoutineId: workout.routineId!,
            baseRoutineRevision: workout.routineRevision!,
            exerciseId: decision.exerciseId,
            status: 'pending',
            createdAt: now,
            candidateId: selected.candidateId,
            candidate: selected,
            candidateOptions: options.filter((candidate) => candidate.exerciseId === decision.exerciseId),
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
          }
          await db.adaptationProposals.put(proposal)
        }
        await db.adaptationJobs.update(job.id, { status: 'completed', analysisId: body.analysisId, nextRetryAt: undefined, lastError: undefined, updatedAt: Date.now() })
      })
    } catch (cause) {
      const attempts = (job.attempts ?? 0) + 1
      await db.adaptationJobs.update(job.id, { status: attempts >= 3 ? 'failed' : 'pending', nextRetryAt: Date.now() + Math.min(60_000, attempts * 10_000), lastError: cause instanceof Error ? cause.message : 'Error desconocido', updatedAt: Date.now() })
    }
  }
}
