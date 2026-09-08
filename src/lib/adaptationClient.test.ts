import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeAdaptation, type ExerciseAnalysisInput } from '../../packages/adaptation-core/src/index'
import { analyzeRequestSchema } from '../../packages/adaptation-core/src/contract'
import { db } from '../db/db'
import { buildAdaptationContext, invalidateStaleAdaptationJobsInTransaction } from './adaptationContext'
import { CONTEXT_INVALIDATED_MESSAGE } from './adaptationErrors'
import { grantCoachConsent, revokeCoachConsent } from './coachConsent'
import { cancelPendingAdaptationProcessing, enqueueAdaptationJob, nextAdaptationWakeAt, parseWorkerAnalysisResponse, processPendingAdaptationJobs, reconcileWorkerAnalysis, setCoachAccountId } from './adaptationClient'

const input: ExerciseAnalysisInput = {
  workoutId: 'workout-current',
  startedAt: 4,
  exerciseId: 'squat',
  occurrenceId: 'routine:0:squat',
  role: 'strength',
  repRangeMin: 5,
  repRangeMax: 8,
  loadIncrementKg: 2.5,
  plannedSets: 3,
  sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 5, completed: true })),
  previousExposures: [],
}

const routine = () => ({
  id: 'routine',
  name: 'Rutina',
  sortOrder: 1,
  createdAt: 1,
  revision: 1,
  trainingRole: 'strength' as const,
  loadIncrementKg: 2.5,
  coachReviewed: true,
  exercises: [{ exerciseId: 'squat', occurrenceId: input.occurrenceId, restSec: 120, plannedSets: 3, repRangeMin: 5, repRangeMax: 8, trainingRole: 'strength' as const, setTargets: [{ type: 'normal' as const, weightKg: 100, reps: 5 }] }],
})

const workout = (id: string, startedAt: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: 'Ficticio',
  startedAt,
  endedAt: startedAt + 1,
  routineId: 'routine',
  routineRevision: 1,
  volumeKg: 1500,
  totalSets: 3,
  prs: [],
  exercises: [{
    exerciseId: 'squat',
    occurrenceId: input.occurrenceId,
    restSec: 120,
    plannedSets: 3,
    repRangeMin: 5,
    repRangeMax: 8,
    trainingRole: 'strength' as const,
    sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 5, completed: true })),
    prescription: {
      occurrenceId: input.occurrenceId,
      plannedSets: 3,
      restSec: 120,
      repRangeMin: 5,
      repRangeMax: 8,
      trainingRole: 'strength' as const,
      loadIncrementKg: 2.5,
    },
  }],
  ...overrides,
})

async function setupCurrentWorkout() {
  await db.routines.put(routine())
  await db.workouts.put(workout('current', 2))
}

async function setupCurrentAndPreviousWorkouts() {
  await db.routines.put(routine())
  await db.workouts.bulkPut([workout('previous', 1), workout('current', 2)])
}

async function mutateContext(change: () => Promise<void>) {
  await db.transaction('rw', [db.workouts, db.routines, db.adaptationJobs, db.adaptationProposals], async () => {
    await change()
    await invalidateStaleAdaptationJobsInTransaction('user-1')
  })
}

describe('contrato PWA → Worker', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    vi.stubEnv('VITE_ADAPTATION_WORKER_URL', 'https://worker.test')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    setCoachAccountId('user-1')
  })

  it('procesa la forma real de una respuesta del Worker con evidencia y ocurrencia', () => {
    const analysis = analyzeAdaptation([input])
    const response = parseWorkerAnalysisResponse({ analysisId: 'analysis-1', policyVersion: 'v1', corpusVersion: 'none', provider: 'deterministic', pendingExplanation: true, sources: [], decisions: analysis.decisions })
    const decisions = reconcileWorkerAnalysis(response, [input])
    expect(decisions[0]).toMatchObject({ occurrenceId: input.occurrenceId, comparableWorkoutIds: [], warnings: [] })
    expect(decisions[0].candidates[0].evidence).toBeDefined()
  })

  it('rechaza candidatos alterados por el Worker', () => {
    const analysis = analyzeAdaptation([input])
    const response = parseWorkerAnalysisResponse({ analysisId: 'analysis-1', policyVersion: 'v1', decisions: analysis.decisions.map((decision) => ({ ...decision, candidates: decision.candidates.map((candidate) => ({ ...candidate, next: { ...candidate.next, plannedSets: candidate.next.plannedSets + 1 } })) })) })
    expect(() => reconcileWorkerAnalysis(response, [input])).toThrow(/modificó/)
  })

  it('serializa el historial como exposiciones sin el campo recursivo', async () => {
    await setupCurrentAndPreviousWorkouts()
    await enqueueAdaptationJob('current')
    const job = await db.adaptationJobs.get('adapt-current')
    expect(job?.payload).toBeDefined()
    expect(job!.payload!.inputs[0].previousExposures[0]).not.toHaveProperty('previousExposures')
    expect(job!.payload!.inputs[0].previousExposures[0].sets[0]).toMatchObject({ weightKg: 100, reps: 5 })
    expect(analyzeRequestSchema.safeParse(job!.payload).success).toBe(true)
  })

  it('detiene el lote después de revocar consentimiento durante el primer envío', async () => {
    await db.routines.put(routine())
    await db.workouts.bulkPut([workout('one', Date.now()), workout('two', Date.now() + 1)])
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('one')
    await enqueueAdaptationJob('two')
    const send = vi.fn(async (_url: string, init: RequestInit) => {
      revokeCoachConsent('user-1')
      const body = JSON.parse(init.body as string) as { inputs: ExerciseAnalysisInput[] }
      return Response.json({ analysisId: 'analysis-1', policyVersion: 'v1', decisions: analyzeAdaptation(body.inputs).decisions })
    })
    vi.stubGlobal('fetch', send)
    await processPendingAdaptationJobs(async () => 'token', 'user-1')
    expect(send).toHaveBeenCalledTimes(1)
    cancelPendingAdaptationProcessing()
  })

  it('genera un nuevo requestId y payload al reencolar manualmente tras cambiar el feedback', async () => {
    await setupCurrentWorkout()
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('current')
    const first = await db.adaptationJobs.get('adapt-current')
    await db.workouts.update('current', { postWorkoutFeedback: { generalPain: true } })
    await enqueueAdaptationJob('current')
    const second = await db.adaptationJobs.get('adapt-current')
    expect(second?.requestId).not.toBe(first?.requestId)
    expect(second?.payload).not.toEqual(first?.payload)
    expect(second?.payload?.inputs[0].feedback?.generalPain).toBe(true)
  })

  it('procesa únicamente jobs del propietario autenticado', async () => {
    await setupCurrentWorkout()
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('current')
    const current = await db.workouts.get('current')
    const foreignContext = await buildAdaptationContext(current!)
    await db.adaptationJobs.put({
      id: 'foreign',
      workoutId: 'current',
      ownerId: 'user-2',
      requestId: 'req-foreign',
      contextKey: foreignContext.contextKey,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
      payload: foreignContext.payload,
    })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => Response.json({ analysisId: 'analysis-owned', policyVersion: 'v1', decisions: analyzeAdaptation(JSON.parse(init.body as string).inputs).decisions })))

    await processPendingAdaptationJobs(async () => 'token', 'user-1')

    expect((await db.adaptationJobs.get('adapt-current'))?.status).toBe('completed')
    expect((await db.adaptationJobs.get('foreign'))?.status).toBe('pending')
  })

  it('invalidates the job when pain and sets change during a late success', async () => {
    await setupCurrentWorkout()
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('current')
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      await mutateContext(async () => {
        await db.workouts.update('current', {
          postWorkoutFeedback: { generalPain: true },
          exercises: [{
            ...workout('current', 2).exercises[0],
            sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 4, completed: true })),
          }],
        })
      })
      const body = JSON.parse(init.body as string) as { inputs: ExerciseAnalysisInput[] }
      return Response.json({ analysisId: 'analysis-late-success', policyVersion: 'v1', decisions: analyzeAdaptation(body.inputs).decisions })
    }))

    await processPendingAdaptationJobs(async () => 'token', 'user-1')

    expect((await db.adaptationJobs.get('adapt-current'))).toMatchObject({ status: 'failed', errorCode: 'context-invalidated', lastError: CONTEXT_INVALIDATED_MESSAGE })
    expect(await db.adaptationProposals.toArray()).toHaveLength(0)
  })

  it('invalidates the job when the selected history changes during a late success', async () => {
    await setupCurrentAndPreviousWorkouts()
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('current')
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      await mutateContext(async () => {
        await db.workouts.update('previous', {
          exercises: [{
            ...workout('previous', 1).exercises[0],
            sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 92.5, reps: 5, completed: true })),
          }],
        })
      })
      const body = JSON.parse(init.body as string) as { inputs: ExerciseAnalysisInput[] }
      return Response.json({ analysisId: 'analysis-history', policyVersion: 'v1', decisions: analyzeAdaptation(body.inputs).decisions })
    }))

    await processPendingAdaptationJobs(async () => 'token', 'user-1')

    expect((await db.adaptationJobs.get('adapt-current'))?.errorCode).toBe('context-invalidated')
    expect(await db.adaptationProposals.toArray()).toHaveLength(0)
  })

  it('invalidates the job when the workout is deleted during a late success', async () => {
    await setupCurrentWorkout()
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('current')
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      await mutateContext(async () => {
        await db.workouts.delete('current')
      })
      const body = JSON.parse(init.body as string) as { inputs: ExerciseAnalysisInput[] }
      return Response.json({ analysisId: 'analysis-delete', policyVersion: 'v1', decisions: analyzeAdaptation(body.inputs).decisions })
    }))

    await processPendingAdaptationJobs(async () => 'token', 'user-1')

    expect((await db.adaptationJobs.get('adapt-current'))?.errorCode).toBe('context-invalidated')
    expect(await db.adaptationProposals.toArray()).toHaveLength(0)
  })

  it('invalidates the job when the routine changes during a late success', async () => {
    await setupCurrentWorkout()
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('current')
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      await mutateContext(async () => {
        await db.routines.put({ ...routine(), exercises: [{ ...routine().exercises[0], setTargets: [{ type: 'normal' as const, weightKg: 105, reps: 5 }] }] })
      })
      const body = JSON.parse(init.body as string) as { inputs: ExerciseAnalysisInput[] }
      return Response.json({ analysisId: 'analysis-routine', policyVersion: 'v1', decisions: analyzeAdaptation(body.inputs).decisions })
    }))

    await processPendingAdaptationJobs(async () => 'token', 'user-1')

    expect((await db.adaptationJobs.get('adapt-current'))?.errorCode).toBe('context-invalidated')
    expect(await db.adaptationProposals.toArray()).toHaveLength(0)
  })

  it('preserves the invalidated reason when a late network error arrives afterwards', async () => {
    await setupCurrentWorkout()
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('current')
    vi.stubGlobal('fetch', vi.fn(async () => {
      await mutateContext(async () => {
        await db.workouts.update('current', { postWorkoutFeedback: { generalPain: true } })
      })
      throw new Error('socket closed')
    }))

    await processPendingAdaptationJobs(async () => 'token', 'user-1')

    expect((await db.adaptationJobs.get('adapt-current'))).toMatchObject({ status: 'failed', errorCode: 'context-invalidated', lastError: CONTEXT_INVALIDATED_MESSAGE })
  })

  it('calcula el siguiente despertar solo con reintentos del propietario', () => {
    const now = 10_000
    expect(nextAdaptationWakeAt([
      { ownerId: 'user-2', status: 'pending', nextRetryAt: now + 100 },
      { ownerId: 'user-1', status: 'completed', nextRetryAt: now + 200 },
      { ownerId: 'user-1', status: 'pending', nextRetryAt: now + 300 },
    ] as never, 'user-1', now)).toBe(now + 300)
    expect(nextAdaptationWakeAt([
      { ownerId: 'user-1', status: 'processing', leaseExpiresAt: now + 150 },
    ] as never, 'user-1', now)).toBe(now + 150)
  })

  it('reconsulta una nueva pasada cuando se encola durante el último envío', async () => {
    await db.routines.put(routine())
    await db.workouts.put(workout('one', 1))
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('one')
    const send = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { inputs: ExerciseAnalysisInput[] }
      if (send.mock.calls.length === 1) {
        await db.workouts.put(workout('two', 2))
        await enqueueAdaptationJob('two')
      }
      return Response.json({ analysisId: `analysis-${send.mock.calls.length}`, policyVersion: 'v1', decisions: analyzeAdaptation(body.inputs).decisions })
    })
    vi.stubGlobal('fetch', send)
    await processPendingAdaptationJobs(async () => 'token', 'user-1')
    expect(send).toHaveBeenCalledTimes(2)
    expect((await db.adaptationJobs.get('adapt-two'))?.status).toBe('completed')
  })

  it('cancela el run reclamado sin consumir un intento técnico y permite retomarlo', async () => {
    await setupCurrentWorkout()
    grantCoachConsent('user-1')
    await enqueueAdaptationJob('current')
    const before = await db.adaptationJobs.get('adapt-current')
    let release!: (response: Response) => void
    const responsePending = new Promise<Response>((resolve) => { release = resolve })
    const send = vi.fn(() => responsePending)
    vi.stubGlobal('fetch', send)
    const running = processPendingAdaptationJobs(async () => 'token', 'user-1')
    await vi.waitFor(() => expect(send).toHaveBeenCalled(), { timeout: 1_000, interval: 10 })
    cancelPendingAdaptationProcessing('user-1')
    release(Response.json({ analysisId: 'late', policyVersion: 'v1', decisions: [] }))
    await running
    const cancelled = await db.adaptationJobs.get('adapt-current')
    expect(cancelled?.status).toBe('pending')
    expect(cancelled?.attempts).toBe(before?.attempts ?? 0)
    expect(cancelled?.requestId).toBe(before?.requestId)
    expect(cancelled?.runId).toBeUndefined()
    expect(cancelled?.leaseExpiresAt).toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { inputs: ExerciseAnalysisInput[] }
      return Response.json({ analysisId: 'resumed', policyVersion: 'v1', decisions: analyzeAdaptation(body.inputs).decisions })
    }))
    await processPendingAdaptationJobs(async () => 'token', 'user-1')
    expect((await db.adaptationJobs.get('adapt-current'))?.status).toBe('completed')
  })
})
