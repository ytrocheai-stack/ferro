import { describe, expect, it } from 'vitest'
import { withPlannedSetCount, WARMUP_REDUCTION_MESSAGE } from './routineEditing'

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
