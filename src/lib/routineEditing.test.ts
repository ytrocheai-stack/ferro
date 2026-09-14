import { describe, expect, it } from 'vitest'
import type { Routine } from '../db/types'
import { putRoutineWithExpectedRevision, RoutineRevisionConflictError, RoutineUnavailableError, withPlannedSetCount, WARMUP_REDUCTION_MESSAGE } from './routineEditing'

const exercise = (setTargets?: { type: 'normal' | 'warmup'; reps?: number }[]) => ({
  exerciseId: 'squat', plannedSets: setTargets?.length ?? 3, restSec: 120, setTargets,
})

describe('routine set target editing', () => {
  it('keeps detailed targets and appends empty normal targets', () => {
    const result = withPlannedSetCount(exercise([{ type: 'warmup', reps: 5 }, { type: 'normal', reps: 8 }]), 4)
    expect(result.plannedSets).toBe(4)
    expect(result.setTargets).toEqual([{ type: 'warmup', reps: 5 }, { type: 'normal', reps: 8 }, { type: 'normal' }, { type: 'normal' }])
  })

  it('removes trailing work targets but never removes a warmup implicitly', () => {
    const result = withPlannedSetCount(exercise([{ type: 'warmup', reps: 5 }, { type: 'normal', reps: 8 }, { type: 'normal', reps: 8 }]), 2)
    expect(result.setTargets).toEqual([{ type: 'warmup', reps: 5 }, { type: 'normal', reps: 8 }])
    expect(() => withPlannedSetCount(exercise([{ type: 'warmup', reps: 5 }, { type: 'warmup', reps: 4 }]), 1)).toThrow(WARMUP_REDUCTION_MESSAGE)
  })

  it('preserves the absence of detailed targets', () => {
    expect(withPlannedSetCount(exercise(), 5)).toEqual({ exerciseId: 'squat', plannedSets: 5, restSec: 120, setTargets: undefined })
  })
})

const routine = (overrides: Partial<Pick<Routine, 'revision' | 'retiredAt'>>): Routine => ({
  id: 'routine-1', name: 'Push', sortOrder: 1, exercises: [], createdAt: 1,
  revision: 1, trainingRole: 'hypertrophy' as const, loadIncrementKg: 2.5, coachReviewed: true, ...overrides,
})

describe('control optimista del editor de rutinas', () => {
  it('rechaza el borrador de una segunda pestaña sin sobrescribir la revisión nueva', async () => {
    let current = routine({})
    const routines = { get: async () => current, put: async (next: typeof current) => { current = next } }
    await putRoutineWithExpectedRevision(routines, { ...current, name: 'Coach' }, 1)
    await expect(putRoutineWithExpectedRevision(routines, { ...current, name: 'Borrador local' }, 1)).rejects.toBeInstanceOf(RoutineRevisionConflictError)
    expect(current.name).toBe('Coach')
    expect(current.revision).toBe(2)
  })

  it('rechaza una rutina retirada y conserva el motivo recuperable', async () => {
    const current = routine({ retiredAt: Date.now() })
    const routines = { get: async () => current, put: async () => undefined }
    await expect(putRoutineWithExpectedRevision(routines, { ...current, name: 'Borrador' }, 1)).rejects.toBeInstanceOf(RoutineUnavailableError)
  })

  it('rechaza una rutina eliminada mientras el editor estaba abierto', async () => {
    const routines = { get: async () => undefined, put: async () => undefined }
    await expect(putRoutineWithExpectedRevision(routines, routine({}), 1)).rejects.toBeInstanceOf(RoutineUnavailableError)
  })
})
