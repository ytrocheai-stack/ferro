import { groupFromTarget, MUSCLE_GROUP_ORDER, type MuscleGroup } from '../data/muscleGroups'
import type { Workout } from '../db/types'
import { workingSets } from './stats'

/** Hoy y seis días locales anteriores. Cada músculo principal cuenta una vez por día. */
export function muscleActivity(history: Workout[], targets: Map<string, string>, now = Date.now()) {
  const since = new Date(now)
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - 6)
  const frequency = Object.fromEntries(MUSCLE_GROUP_ORDER.map(g => [g, 0])) as Record<MuscleGroup, number>
  const sets = { ...frequency }
  const dates = new Map<MuscleGroup, Set<string>>()
  for (const workout of history) {
    if (!Number.isFinite(workout.startedAt) || workout.startedAt < since.getTime() || workout.startedAt > now) continue
    const date = new Date(workout.startedAt)
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    for (const exercise of workout.exercises) {
      const group = groupFromTarget(targets.get(exercise.exerciseId) ?? '')
      const count = workingSets(exercise.executedSets ?? exercise.sets).length
      if (!group || !count) continue
      sets[group] += count
      const trained = dates.get(group) ?? new Set<string>()
      trained.add(day)
      dates.set(group, trained)
      frequency[group] = trained.size
    }
  }
  return { frequency, sets }
}

/** Azul absoluto: no depende del máximo de otros músculos ni expresa recuperación. */
export function frequencyOpacity(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0
  return .28 + Math.min(7, days) / 7 * .52
}
