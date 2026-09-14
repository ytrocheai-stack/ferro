import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workout } from '../db/types'
import { db } from '../db/db'
import type { useActive as ActiveStore } from './activeWorkout'

let useActive: typeof ActiveStore

function stubStorage() {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
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
    ;({ useActive } = await import('./activeWorkout'))
  })

  beforeEach(async () => {
    await db.delete()
    await db.open()
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
})
