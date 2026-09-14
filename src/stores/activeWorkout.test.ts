import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workout } from '../db/types'
import { db } from '../db/db'
import type { useActive as ActiveStore } from './activeWorkout'

let useActive: typeof ActiveStore
let persistWorkoutHistory: (workout: Workout, invalidateAdaptation?: boolean) => Promise<void>
let deleteWorkoutFromHistory: (workoutId: string) => Promise<void>
let restoreWorkoutToHistory: (snapshot: Workout) => Promise<void>
let failStorageWrites = false

function stubStorage() {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failStorageWrites) throw new Error('localStorage unavailable')
      storage.set(key, value)
    },
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  })
}

function session() {
  return {
    startedAt: 1_000,
    name: 'Sesión de prueba',
    notes: '',
    exercises: [{
      uid: 'active-exercise',
      exerciseId: 'bench',
      restSec: 90,
      notes: '',
      prev: [],
      sets: [{ type: 'normal' as const, weightKg: 60, reps: 5, completed: true }],
    }],
  }
}

describe('guardado de sesión activa', () => {
  beforeAll(async () => {
    stubStorage()
    const store = await import('./activeWorkout')
    useActive = store.useActive
    persistWorkoutHistory = store.persistWorkoutHistory
    deleteWorkoutFromHistory = store.deleteWorkoutFromHistory
    restoreWorkoutToHistory = store.restoreWorkoutToHistory
  })

  beforeEach(async () => {
    await db.delete()
    await db.open()
    failStorageWrites = false
    stubStorage()
    useActive.setState({ session: null, rest: null })
  })

  it('serializa guardados concurrentes y no duplica el registro', async () => {
    useActive.setState({ session: session(), rest: null })

    const [first, second] = await Promise.all([
      useActive.getState().finish(),
      useActive.getState().finish(),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect(await db.workouts.count()).toBe(1)
    expect(useActive.getState().session).toBeNull()
  })

  it('conserva la sesión si la escritura agota la cuota', async () => {
    useActive.setState({ session: session(), rest: null })
    vi.spyOn(db.workouts, 'bulkPut').mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(useActive.getState().finish()).rejects.toThrow('quota exceeded')

    expect(useActive.getState().session).toEqual(session())
    expect(await db.workouts.count()).toBe(0)
  })

  it('no altera registros existentes cuando falla una escritura concurrente', async () => {
    const existing: Workout = {
      id: 'existing',
      name: 'Existente',
      startedAt: 1,
      endedAt: 2,
      exercises: [{ exerciseId: 'bench', restSec: 90, sets: [{ type: 'normal', weightKg: 50, reps: 5, completed: true }] }],
      volumeKg: 250,
      totalSets: 1,
      prs: [],
    }
    await db.workouts.put(existing)
    useActive.setState({ session: session(), rest: null })
    vi.spyOn(db.workouts, 'bulkPut').mockRejectedValueOnce(new Error('storage failed'))

    await expect(useActive.getState().finish()).rejects.toThrow('storage failed')

    expect(await db.workouts.get('existing')).toEqual(existing)
    expect(useActive.getState().session).toEqual(session())
  })

  it('reintenta de forma idempotente si falla localStorage después del commit', async () => {
    useActive.setState({ session: session(), rest: null })
    failStorageWrites = true

    await expect(useActive.getState().finish()).rejects.toMatchObject({
      name: 'WorkoutFinishRecoveryError',
      persisted: true,
      workoutId: 'workout-1000',
    })
    expect(await db.workouts.count()).toBe(1)
    expect(useActive.getState().session).toMatchObject(session())

    failStorageWrites = false
    await expect(useActive.getState().finish()).resolves.toBe('workout-1000')
    expect(await db.workouts.count()).toBe(1)
    expect(useActive.getState().session).toBeNull()
  })

  it('serializa dos guardados reales y el segundo lee el primer commit', async () => {
    const first = workout('first', 1_000, 60)
    const second = workout('second', 2_000, 70)
    const reads: string[][] = []
    const originalToArray = db.workouts.toArray.bind(db.workouts)
    vi.spyOn(db.workouts, 'toArray').mockImplementation(() => originalToArray().then((items) => {
      reads.push(items.map((item) => item.id))
      return items
    }))

    await Promise.all([persistWorkoutHistory(first), persistWorkoutHistory(second)])

    expect(reads).toHaveLength(2)
    expect(reads[0]).toEqual([])
    expect(reads[1]).toEqual(['first'])
    expect(await db.workouts.bulkGet(['first', 'second'])).toHaveLength(2)
  })

  it('usa las transacciones reales de borrar/deshacer y hace rollback ante fallos', async () => {
    const earlier = workout('earlier', 1_000, 60)
    const deleted = workout('deleted', 2_000, 80)
    const later = workout('later', 3_000, 70)
    await db.workouts.bulkPut([earlier, deleted, later])

    await deleteWorkoutFromHistory(deleted.id)
    expect((await db.workouts.orderBy('startedAt').toArray()).map((item) => item.id)).toEqual(['earlier', 'later'])
    await restoreWorkoutToHistory(deleted)
    expect((await db.workouts.orderBy('startedAt').toArray()).map((item) => item.id)).toEqual(['earlier', 'deleted', 'later'])
    const restored = await db.workouts.get(deleted.id)
    expect(restored).toBeDefined()

    vi.spyOn(db.workouts, 'bulkPut').mockRejectedValueOnce(new Error('delete storage failed'))
    await expect(deleteWorkoutFromHistory(deleted.id)).rejects.toThrow('delete storage failed')
    expect(await db.workouts.get(deleted.id)).toEqual(restored)

    await deleteWorkoutFromHistory(deleted.id)
    vi.spyOn(db.workouts, 'bulkPut').mockRejectedValueOnce(new Error('restore storage failed'))
    await expect(restoreWorkoutToHistory(deleted)).rejects.toThrow('restore storage failed')
    expect(await db.workouts.get(deleted.id)).toBeUndefined()
  })
})

function workout(id: string, startedAt: number, weightKg: number): Workout {
  return {
    id,
    name: id,
    startedAt,
    endedAt: startedAt + 1,
    exercises: [{
      exerciseId: 'bench',
      restSec: 90,
      sets: [{ type: 'normal', weightKg, reps: 5, completed: true }],
    }],
    volumeKg: 0,
    totalSets: 0,
    prs: [],
  }
}
