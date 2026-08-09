import { describe, expect, it } from 'vitest'
import type { Workout } from '../db/types'
import { recalculateWorkoutHistory } from './stats'

function workout(id: string, startedAt: number, weightKg: number): Workout {
  return {
    id,
    name: id,
    startedAt,
    endedAt: startedAt + 3_600_000,
    exercises: [
      {
        exerciseId: 'bench',
        restSec: 90,
        sets: [{ type: 'normal', weightKg, reps: 5, completed: true }],
      },
    ],
    volumeKg: 0,
    totalSets: 0,
    prs: [],
  }
}

describe('recalculateWorkoutHistory', () => {
  it('recalcula volumen, series y PRs en orden cronológico', () => {
    const result = recalculateWorkoutHistory([
      workout('later', 2_000, 80),
      workout('earlier', 1_000, 60),
    ])

    expect(result.map((item) => item.id)).toEqual(['earlier', 'later'])
    expect(result[0].volumeKg).toBe(300)
    expect(result[0].totalSets).toBe(1)
    expect(result[0].prs).toHaveLength(3)
    expect(result[1].volumeKg).toBe(400)
    expect(result[1].prs).toHaveLength(3)
    expect(result[1].prs[0]).toEqual({ exerciseId: 'bench', kind: 'weight', value: 80, prev: 60 })
    expect(result[1].prs[1]).toMatchObject({ exerciseId: 'bench', kind: 'e1rm', prev: 70 })
    expect(result[1].prs[1].value).toBeCloseTo(93.33333333333333)
    expect(result[1].prs[2]).toEqual({ exerciseId: 'bench', kind: 'setVolume', value: 400, prev: 300 })
  })

  it('no marca calentamientos como récords ni volumen', () => {
    const item = workout('warmup', 1_000, 30)
    item.exercises[0].sets[0].type = 'warmup'
    const [result] = recalculateWorkoutHistory([item])
    expect(result.volumeKg).toBe(0)
    expect(result.totalSets).toBe(1)
    expect(result.prs).toEqual([])
  })
})
