import { describe, expect, it } from 'vitest'
import type { Workout } from '../db/types'
import { compareTrainingPeriods, topExerciseProgress } from './analytics'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 9, 12)

function workout(id: string, daysAgo: number, exerciseId: string, weightKg: number, volumeKg: number): Workout {
  const startedAt = NOW - daysAgo * DAY
  return {
    id,
    name: id,
    startedAt,
    endedAt: startedAt + 3_600_000,
    exercises: [
      {
        exerciseId,
        restSec: 90,
        sets: [{ type: 'normal', weightKg, reps: 5, completed: true }],
      },
    ],
    volumeKg,
    totalSets: 1,
    prs: daysAgo < 28 ? [{ exerciseId, kind: 'weight', value: weightKg }] : [],
  }
}

describe('compareTrainingPeriods', () => {
  it('compara la ventana elegida con la inmediatamente anterior', () => {
    const history = [
      workout('prev-a', 40, 'bench', 50, 1_000),
      workout('prev-b', 32, 'bench', 55, 1_000),
      workout('now-a', 20, 'bench', 60, 1_200),
      workout('now-b', 10, 'bench', 65, 1_200),
      workout('now-c', 2, 'bench', 70, 1_200),
    ]

    expect(compareTrainingPeriods(history, NOW, 28)).toMatchObject({
      sessions: 3,
      previousSessions: 2,
      volumeKg: 3_600,
      previousVolumeKg: 2_000,
      workingSets: 3,
      prCount: 3,
      volumeChangePct: 80,
      sessionChange: 1,
    })
  })
})

describe('topExerciseProgress', () => {
  it('ordena por progreso de e1RM y excluye ejercicios con una sola sesión', () => {
    const history = [
      workout('bench-start', 24, 'bench', 60, 300),
      workout('squat-only', 12, 'squat', 100, 500),
      workout('bench-end', 2, 'bench', 75, 375),
    ]

    expect(topExerciseProgress(history, NOW - 28 * DAY, 3)).toEqual([
      {
        exerciseId: 'bench',
        startE1rm: 70,
        endE1rm: 87.5,
        changePct: 25,
        sessions: 2,
      },
    ])
  })
})
