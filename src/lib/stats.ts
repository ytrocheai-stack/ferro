import type { LoggedSet, PR, Workout, WorkoutExercise } from '../db/types'
import { groupFromTarget, type MuscleGroup } from '../data/muscleGroups'

/** 1RM estimado con fórmula de Epley */
export function epley1RM(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}

/** Sets que cuentan para volumen y récords: completados y no-calentamiento */
export function workingSets(sets: LoggedSet[]): LoggedSet[] {
  return sets.filter((s) => s.completed && s.type !== 'warmup')
}

export function exerciseVolume(ex: WorkoutExercise): number {
  return workingSets(ex.sets).reduce((acc, s) => acc + s.weightKg * s.reps, 0)
}

export function workoutVolume(exercises: WorkoutExercise[]): number {
  return exercises.reduce((acc, ex) => acc + exerciseVolume(ex), 0)
}

export function completedSetCount(exercises: WorkoutExercise[]): number {
  return exercises.reduce((acc, ex) => acc + ex.sets.filter((s) => s.completed).length, 0)
}

export interface ExerciseBests {
  weight: number
  e1rm: number
  setVolume: number
  /** mejor serie: la de mayor e1RM */
  bestSet: { weightKg: number; reps: number } | null
}

export function bestsOfSets(sets: LoggedSet[]): ExerciseBests {
  const bests: ExerciseBests = { weight: 0, e1rm: 0, setVolume: 0, bestSet: null }
  for (const s of workingSets(sets)) {
    if (s.weightKg > bests.weight) bests.weight = s.weightKg
    const e = epley1RM(s.weightKg, s.reps)
    if (e > bests.e1rm) {
      bests.e1rm = e
      bests.bestSet = { weightKg: s.weightKg, reps: s.reps }
    }
    const v = s.weightKg * s.reps
    if (v > bests.setVolume) bests.setVolume = v
  }
  return bests
}

/** Mejores marcas históricas de un ejercicio a partir de una lista de entrenos */
export function bestsFromHistory(history: Workout[], exerciseId: string): ExerciseBests {
  const all: LoggedSet[] = []
  for (const w of history) {
    for (const ex of w.exercises) {
      if (ex.exerciseId === exerciseId) all.push(...ex.sets)
    }
  }
  return bestsOfSets(all)
}

/** Detecta PRs de un entreno comparando contra el historial anterior */
export function detectPRs(exercises: WorkoutExercise[], history: Workout[]): PR[] {
  const prs: PR[] = []
  for (const ex of exercises) {
    const current = bestsOfSets(ex.sets)
    if (current.weight <= 0) continue
    const prev = bestsFromHistory(history, ex.exerciseId)
    if (current.weight > prev.weight) {
      prs.push({ exerciseId: ex.exerciseId, kind: 'weight', value: current.weight, prev: prev.weight || undefined })
    }
    if (current.e1rm > prev.e1rm) {
      prs.push({ exerciseId: ex.exerciseId, kind: 'e1rm', value: current.e1rm, prev: prev.e1rm || undefined })
    }
    if (current.setVolume > prev.setVolume) {
      prs.push({
        exerciseId: ex.exerciseId,
        kind: 'setVolume',
        value: current.setVolume,
        prev: prev.setVolume || undefined,
      })
    }
  }
  return prs
}

/**
 * Rebuilds derived workout fields after a historical edit/import. The input is not
 * mutated; the returned list is chronological so PRs always compare against the
 * workouts that genuinely happened before each session.
 */
export function recalculateWorkoutHistory(workouts: Workout[]): Workout[] {
  const ordered = [...workouts].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  const history: Workout[] = []
  return ordered.map((workout) => {
    const next: Workout = {
      ...workout,
      volumeKg: Math.round(workoutVolume(workout.exercises) * 10) / 10,
      totalSets: completedSetCount(workout.exercises),
      prs: detectPRs(workout.exercises, history),
    }
    history.push(next)
    return next
  })
}

/** Serie temporal por entreno para las gráficas de un ejercicio */
export interface ExercisePoint {
  date: number
  maxWeight: number
  e1rm: number
  volume: number
}

/** Series efectivas (no-warmup, completadas) por grupo muscular en una ventana de días. */
export function weeklySetsByGroup(
  history: Workout[],
  targetById: Map<string, string>,
  days = 7,
): Record<MuscleGroup, number> {
  const since = Date.now() - days * 86400000
  const counts = {} as Record<MuscleGroup, number>
  for (const w of history) {
    if (w.startedAt < since) continue
    for (const ex of w.exercises) {
      const target = targetById.get(ex.exerciseId)
      if (!target) continue
      const group = groupFromTarget(target)
      if (!group) continue
      const n = workingSets(ex.sets).length
      counts[group] = (counts[group] ?? 0) + n
    }
  }
  return counts
}

/** Media móvil exponencial (suaviza el ruido diario del peso corporal). */
export function ema(points: { date: number; value: number }[], alpha = 0.25): number[] {
  const out: number[] = []
  let prev: number | null = null
  for (const p of points) {
    prev = prev === null ? p.value : alpha * p.value + (1 - alpha) * prev
    out.push(Math.round(prev * 100) / 100)
  }
  return out
}

export function exerciseSeries(history: Workout[], exerciseId: string): ExercisePoint[] {
  const points: ExercisePoint[] = []
  for (const w of [...history].sort((a, b) => a.startedAt - b.startedAt)) {
    const sets: LoggedSet[] = []
    for (const ex of w.exercises) if (ex.exerciseId === exerciseId) sets.push(...ex.sets)
    const b = bestsOfSets(sets)
    if (b.weight > 0 || b.setVolume > 0) {
      points.push({
        date: w.startedAt,
        maxWeight: b.weight,
        e1rm: Math.round(b.e1rm * 10) / 10,
        volume: workingSets(sets).reduce((a, s) => a + s.weightKg * s.reps, 0),
      })
    }
  }
  return points
}
