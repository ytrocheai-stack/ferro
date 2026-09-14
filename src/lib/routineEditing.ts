import type { RoutineExercise } from '../db/types'

export const WARMUP_REDUCTION_MESSAGE = 'No se pueden eliminar calentamientos al reducir series. Reduce primero los calentamientos de forma explícita.'

export function isRoutineStartable(routine: { retiredAt?: number }): boolean {
  return routine.retiredAt === undefined
}

/**
 * Keeps detailed per-set targets aligned with the visible number of sets.
 * Warmups are preserved in place; only trailing non-warmup targets may be
 * removed. A routine without detailed targets remains without them.
 */
export function withPlannedSetCount(exercise: RoutineExercise, plannedSets: number): RoutineExercise {
  const nextCount = Math.max(1, Math.min(50, Math.floor(plannedSets)))
  if (!exercise.setTargets?.length) return { ...exercise, plannedSets: nextCount }

  const targets = exercise.setTargets.map((target) => ({ ...target }))
  while (targets.length > nextCount) {
    let removeIndex = -1
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      if (targets[index].type !== 'warmup') {
        removeIndex = index
        break
      }
    }
    if (removeIndex < 0) throw new Error(WARMUP_REDUCTION_MESSAGE)
    targets.splice(removeIndex, 1)
  }
  while (targets.length < nextCount) targets.push({ type: 'normal' })
  return { ...exercise, plannedSets: nextCount, setTargets: targets }
}
