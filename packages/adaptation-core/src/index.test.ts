import { describe, expect, it } from 'vitest'
import { analyzeExercise, canonicalJson, isComparable, selectComparables } from './index'
import type { ExerciseAnalysisInput } from './index'

const base: ExerciseAnalysisInput = {
  workoutId: 'current', startedAt: 4, exerciseId: 'squat', role: 'strength', repRangeMin: 5, repRangeMax: 8,
  targetRpeMin: 7, targetRpeMax: 9, loadIncrementKg: 2.5, plannedSets: 3, plannedRepsMin: 5, plannedRepsMax: 8,
  sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 8, completed: true, rpe: 8 })),
  feedback: { completed: true, energy: 4, difficulty: 3 },
  previousExposures: [],
}

function previous(id: string, startedAt: number, overrides: Partial<ExerciseAnalysisInput> = {}) {
  return { ...base, workoutId: id, startedAt, previousExposures: [], ...overrides }
}

describe('adaptation-core', () => {
  it('compares only matching role/range/rpe/working-set signature and selects latest three', () => {
    const input = { ...base, previousExposures: [
      previous('one', 1), previous('two', 2), previous('three', 3), previous('four', 0),
      previous('wrong-role', 5, { role: 'hypertrophy' }), previous('wrong-type', 6, { sets: [{ type: 'drop', weightKg: 100, reps: 8, completed: true }] }),
    ] }
    expect(selectComparables(input).map((e) => e.workoutId)).toEqual(['three', 'two', 'one', 'four'])
    expect(isComparable(input, input.previousExposures[4])).toBe(false)
  })

  it('always emits maintain and is deterministic', () => {
    const first = analyzeExercise({ ...base, previousExposures: [previous('one', 1), previous('two', 2), previous('three', 3)] })
    const second = analyzeExercise({ ...base, previousExposures: [previous('one', 1), previous('two', 2), previous('three', 3)] })
    expect(first).toEqual(second)
    expect(first.candidates[0].kind).toBe('maintain')
    expect(first.candidates[0].candidateId).toMatch(/^v1-[0-9a-f]{16}$/)
  })

  it('blocks progression for pain, incomplete sessions, and insufficient evidence', () => {
    const decision = analyzeExercise({ ...base, feedback: { completed: true, energy: 4, difficulty: 3, exercisePain: true }, previousExposures: [previous('one', 1), previous('two', 2)] })
    expect(decision.candidates).toHaveLength(1)
    expect(decision.warnings).toContain('dolor del ejercicio')
  })

  it('uses a discrete rep progression before adding volume', () => {
    const input = { ...base, plannedRepsMin: 5, plannedRepsMax: 8, sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 6, completed: true, rpe: 8 })), previousExposures: [previous('one', 1, { sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 5, completed: true, rpe: 8 })) }), previous('two', 2, { sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 5, completed: true, rpe: 8 })) }), previous('three', 3, { sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 5, completed: true, rpe: 8 })) })] }
    const decision = analyzeExercise(input)
    expect(decision.candidates.map((candidate) => candidate.kind)).toContain('increase-reps')
    expect(decision.candidates.map((candidate) => candidate.kind)).not.toContain('add-set')
  })

  it('canonicalizes object keys', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('does not increase load or volume without an explicit RPE target', () => {
    const input = { ...base, role: 'hypertrophy' as const, targetRpeMin: undefined, targetRpeMax: undefined, previousExposures: [previous('one', 1), previous('two', 2), previous('three', 3)] }
    const decision = analyzeExercise(input)
    expect(decision.candidates.map((candidate) => candidate.kind)).toEqual(['maintain'])
  })

  it('uses the median of three previous exposures and catches simultaneous load/repetition drops', () => {
    const make = (id: string, startedAt: number, weightKg: number) => previous(id, startedAt, { role: 'hypertrophy', sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg, reps: 8, completed: true, rpe: 8 })) })
    const decision = analyzeExercise({ ...base, role: 'hypertrophy', sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 90, reps: 7, completed: true, rpe: 8 })), previousExposures: [make('one', 3, 100), make('two', 2, 100), make('three', 1, 140)] })
    expect(decision.candidates.map((candidate) => candidate.kind)).toContain('reduce-load')
  })
})
