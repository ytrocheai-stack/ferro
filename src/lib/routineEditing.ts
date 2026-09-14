import type { RoutineExercise } from '../db/types'
import type { Routine } from '../db/types'

export class RoutineRevisionConflictError extends Error {
  constructor(public readonly current?: Routine) {
    super('La rutina cambió en otra pestaña o por el Coach. Conservamos tu borrador local.')
    this.name = 'RoutineRevisionConflictError'
  }
}

export class RoutineUnavailableError extends Error {
  constructor(message = 'La rutina ya no está disponible porque fue retirada o eliminada.') {
    super(message)
    this.name = 'RoutineUnavailableError'
  }
}

export async function putRoutineWithExpectedRevision(
  routines: { get: (id: string) => Promise<Routine | undefined>; put: (routine: Routine) => Promise<unknown> },
  routine: Routine,
  expectedRevision: number | undefined,
): Promise<Routine> {
  const current = await routines.get(routine.id)
  if (expectedRevision !== undefined && (!current || current.retiredAt !== undefined)) throw new RoutineUnavailableError()
  if (expectedRevision !== undefined && current && (current.revision ?? 1) !== expectedRevision) throw new RoutineRevisionConflictError(current)
  const next = { ...routine, revision: expectedRevision === undefined ? 1 : expectedRevision + 1 }
  await routines.put(next)
  return next
}

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
