import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { importBackup, validateBackup } from './backup'

const base = {
  app: 'ferro' as const,
  version: 2 as const,
  exportedAt: '2026-08-08T00:00:00.000Z',
  workouts: [
    {
      id: 'w1',
      name: 'Push',
      startedAt: 1_000,
      endedAt: 2_000,
      exercises: [
        {
          exerciseId: 'bench',
          restSec: 90,
          sets: [{ type: 'normal' as const, weightKg: 60, reps: 5, completed: true }],
        },
      ],
      volumeKg: 300,
      totalSets: 1,
      prs: [],
    },
  ],
  routines: [],
  customExercises: [],
}

describe('validación de respaldos', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('rechaza un ejercicio con una serie incompleta', () => {
    const broken = structuredClone(base)
    delete (broken.workouts[0].exercises[0].sets[0] as { completed?: boolean }).completed
    expect(validateBackup(broken)).toMatch(/completed|complet/i)
  })

  it('rechaza fechas o derivados ausentes antes de modificar la base', async () => {
    await db.workouts.put({ ...base.workouts[0], name: 'Local' })
    const broken = structuredClone(base) as Record<string, unknown>
    const workout = (broken.workouts as Array<Record<string, unknown>>)[0]
    delete workout.endedAt
    expect(validateBackup(broken)).toMatch(/endedAt|entreno/i)

    await expect(importBackup(new File([JSON.stringify(broken)], 'broken.json', { type: 'application/json' }))).rejects.toThrow(
      /no se ha modificado/i,
    )
    await expect(db.workouts.get('w1')).resolves.toMatchObject({ name: 'Local' })
  })

  it('acepta un backup v2 válido sin tablas introducidas en v3', () => {
    expect(validateBackup(base)).toBeNull()
  })
})
