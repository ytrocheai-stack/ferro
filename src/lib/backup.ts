import { format } from 'date-fns'
import { db } from '../db/db'
import type { CustomExercise, Routine, Workout } from '../db/types'
import { useSettings, type SettingsValues } from '../stores/settings'

interface BackupFile {
  app: 'ferro'
  version: 1
  exportedAt: string
  settings: SettingsValues
  workouts: Workout[]
  routines: Routine[]
  customExercises: CustomExercise[]
}

export async function exportBackup(): Promise<void> {
  const [workouts, routines, customExercises] = await Promise.all([
    db.workouts.toArray(),
    db.routines.toArray(),
    db.customExercises.toArray(),
  ])
  const { units, defaultRestSec, sound, vibration, restNotification, keepAwake } =
    useSettings.getState()
  const payload: BackupFile = {
    app: 'ferro',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { units, defaultRestSec, sound, vibration, restNotification, keepAwake },
    workouts,
    routines,
    customExercises,
  }
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ferro-backup-${format(new Date(), 'yyyy-MM-dd')}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export interface ImportResult {
  workouts: number
  routines: number
  customExercises: number
}

/** Reemplaza todos los datos locales por los del archivo. */
export async function importBackup(file: File): Promise<ImportResult> {
  const data = JSON.parse(await file.text()) as Partial<BackupFile>
  if (data?.app !== 'ferro' || !Array.isArray(data.workouts)) {
    throw new Error('El archivo no es un backup válido de Ferro')
  }
  await db.transaction('rw', db.workouts, db.routines, db.customExercises, async () => {
    await db.workouts.clear()
    await db.routines.clear()
    await db.customExercises.clear()
    await db.workouts.bulkPut(data.workouts as Workout[])
    await db.routines.bulkPut((data.routines ?? []) as Routine[])
    await db.customExercises.bulkPut((data.customExercises ?? []) as CustomExercise[])
  })
  if (data.settings) useSettings.getState().update(data.settings)
  return {
    workouts: data.workouts.length,
    routines: (data.routines ?? []).length,
    customExercises: (data.customExercises ?? []).length,
  }
}
