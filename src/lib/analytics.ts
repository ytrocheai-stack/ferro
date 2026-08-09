import type { Workout } from '../db/types'
import { bestsOfSets, workingSets } from './stats'

const DAY = 86_400_000

export interface TrainingPeriodComparison {
  sessions: number
  previousSessions: number
  volumeKg: number
  previousVolumeKg: number
  workingSets: number
  prCount: number
  volumeChangePct: number | null
  sessionChange: number
}

function summarize(workouts: Workout[]) {
  return {
    sessions: workouts.length,
    volumeKg: workouts.reduce((sum, workout) => sum + workout.volumeKg, 0),
    workingSets: workouts.reduce(
      (sum, workout) =>
        sum + workout.exercises.reduce((exerciseSum, exercise) => exerciseSum + workingSets(exercise.sets).length, 0),
      0,
    ),
    prCount: workouts.reduce((sum, workout) => sum + workout.prs.length, 0),
  }
}

export function compareTrainingPeriods(
  workouts: Workout[],
  now: number = Date.now(),
  days = 28,
): TrainingPeriodComparison {
  const currentStart = now - days * DAY
  const previousStart = currentStart - days * DAY
  const current = summarize(
    workouts.filter((workout) => workout.startedAt >= currentStart && workout.startedAt <= now),
  )
  const previous = summarize(
    workouts.filter((workout) => workout.startedAt >= previousStart && workout.startedAt < currentStart),
  )

  return {
    sessions: current.sessions,
    previousSessions: previous.sessions,
    volumeKg: current.volumeKg,
    previousVolumeKg: previous.volumeKg,
    workingSets: current.workingSets,
    prCount: current.prCount,
    volumeChangePct:
      previous.volumeKg > 0
        ? Math.round(((current.volumeKg - previous.volumeKg) / previous.volumeKg) * 100)
        : null,
    sessionChange: current.sessions - previous.sessions,
  }
}

export interface ExerciseProgress {
  exerciseId: string
  startE1rm: number
  endE1rm: number
  changePct: number
  sessions: number
}

export function topExerciseProgress(
  workouts: Workout[],
  since: number,
  limit = 5,
): ExerciseProgress[] {
  const byExercise = new Map<string, { date: number; e1rm: number }[]>()
  const ordered = workouts
    .filter((workout) => workout.startedAt >= since)
    .sort((a, b) => a.startedAt - b.startedAt)

  for (const workout of ordered) {
    const setsByExercise = new Map<string, typeof workout.exercises[number]['sets']>()
    for (const exercise of workout.exercises) {
      const sets = setsByExercise.get(exercise.exerciseId) ?? []
      sets.push(...exercise.sets)
      setsByExercise.set(exercise.exerciseId, sets)
    }
    for (const [exerciseId, sets] of setsByExercise) {
      const e1rm = bestsOfSets(sets).e1rm
      if (e1rm <= 0) continue
      const points = byExercise.get(exerciseId) ?? []
      points.push({ date: workout.startedAt, e1rm })
      byExercise.set(exerciseId, points)
    }
  }

  return [...byExercise.entries()]
    .filter(([, points]) => points.length >= 2 && points[0].e1rm > 0)
    .map(([exerciseId, points]) => {
      const startE1rm = Math.round(points[0].e1rm * 10) / 10
      const endE1rm = Math.round(points[points.length - 1].e1rm * 10) / 10
      return {
        exerciseId,
        startE1rm,
        endE1rm,
        changePct: Math.round(((endE1rm - startE1rm) / startE1rm) * 1000) / 10,
        sessions: points.length,
      }
    })
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, limit)
}
