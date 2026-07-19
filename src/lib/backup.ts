import { format } from 'date-fns'
import { db } from '../db/db'
import type {
  CustomExercise,
  Dish,
  Folder,
  Food,
  FoodLogEntry,
  Measurement,
  ProgressPhoto,
  Routine,
  Workout,
} from '../db/types'
import { useSettings, type SettingsValues } from '../stores/settings'
import { useNutrition, type NutritionGoals } from '../stores/nutrition'
import { shareOrDownloadFile, uid } from './format'

interface BackupFile {
  app: 'ferro'
  version: 1 | 2
  exportedAt: string
  settings: SettingsValues
  nutritionGoals?: NutritionGoals
  workouts: Workout[]
  routines: Routine[]
  customExercises: CustomExercise[]
  folders?: Folder[]
  measurements?: Measurement[]
  foods?: Food[]
  dishes?: Dish[]
  foodLog?: FoodLogEntry[]
}

export async function exportBackup(): Promise<void> {
  const [workouts, routines, customExercises, folders, measurements, foods, dishes, foodLog] =
    await Promise.all([
      db.workouts.toArray(),
      db.routines.toArray(),
      db.customExercises.toArray(),
      db.folders.toArray(),
      db.measurements.toArray(),
      db.foods.toArray(),
      db.dishes.toArray(),
      db.foodLog.toArray(),
    ])
  const payload: BackupFile = {
    app: 'ferro',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: { ...useSettings.getState() },
    nutritionGoals: { ...useNutrition.getState().goals },
    workouts,
    routines,
    customExercises,
    folders,
    measurements,
    foods,
    dishes,
    foodLog,
  }
  await downloadJson(payload, `nextrep-backup-${format(new Date(), 'yyyy-MM-dd')}.json`)
}

async function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  await shareOrDownloadFile(blob, filename, 'application/json')
}

export interface ImportResult {
  workouts: number
  routines: number
  customExercises: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Validación mínima por registro: un backup truncado o editado a mano no debe poder
 *  reemplazar los datos buenos con registros que luego rompen las páginas al leerlos. */
function validateBackup(data: Partial<BackupFile>): string | null {
  const badWorkout = (w: unknown) =>
    !isRecord(w) ||
    typeof w.id !== 'string' ||
    typeof w.startedAt !== 'number' ||
    !Array.isArray(w.exercises)
  if (data.workouts!.some(badWorkout)) return 'entrenos incompletos'
  const badRoutine = (r: unknown) =>
    !isRecord(r) || typeof r.id !== 'string' || !Array.isArray(r.exercises)
  if ((data.routines ?? []).some(badRoutine)) return 'rutinas incompletas'
  const badMeasurement = (m: unknown) =>
    !isRecord(m) || typeof m.id !== 'string' || typeof m.date !== 'number'
  if ((data.measurements ?? []).some(badMeasurement)) return 'medidas incompletas'
  const badEntry = (e: unknown) =>
    !isRecord(e) || typeof e.id !== 'string' || typeof e.date !== 'string'
  if ((data.foodLog ?? []).some(badEntry)) return 'registro de comidas incompleto'
  return null
}

/** Reemplaza todos los datos locales (excepto fotos) por los del archivo. */
export async function importBackup(file: File): Promise<ImportResult> {
  const data = JSON.parse(await file.text()) as Partial<BackupFile>
  if (data?.app !== 'ferro' || !Array.isArray(data.workouts)) {
    throw new Error('El archivo no es un backup válido de NextRep')
  }
  const problem = validateBackup(data)
  if (problem) {
    throw new Error(`El backup está dañado (${problem}); no se ha modificado nada`)
  }
  await db.transaction(
    'rw',
    [db.workouts, db.routines, db.customExercises, db.folders, db.measurements, db.foods, db.dishes, db.foodLog],
    async () => {
      await Promise.all([
        db.workouts.clear(),
        db.routines.clear(),
        db.customExercises.clear(),
        db.folders.clear(),
        db.measurements.clear(),
        db.foods.clear(),
        db.dishes.clear(),
        db.foodLog.clear(),
      ])
      await Promise.all([
        db.workouts.bulkPut(data.workouts as Workout[]),
        db.routines.bulkPut((data.routines ?? []) as Routine[]),
        db.customExercises.bulkPut((data.customExercises ?? []) as CustomExercise[]),
        db.folders.bulkPut((data.folders ?? []) as Folder[]),
        db.measurements.bulkPut((data.measurements ?? []) as Measurement[]),
        db.foods.bulkPut((data.foods ?? []) as Food[]),
        db.dishes.bulkPut((data.dishes ?? []) as Dish[]),
        db.foodLog.bulkPut((data.foodLog ?? []) as FoodLogEntry[]),
      ])
    },
  )
  if (data.settings) useSettings.getState().update(data.settings)
  if (data.nutritionGoals) useNutrition.getState().setGoals(data.nutritionGoals)
  return {
    workouts: data.workouts.length,
    routines: (data.routines ?? []).length,
    customExercises: (data.customExercises ?? []).length,
  }
}

// ── Fotos (archivo separado: son binarios pesados) ────────────────────

interface PhotosBackupFile {
  app: 'ferro-photos'
  version: 1
  exportedAt: string
  photos: { id: string; date: number; note?: string; dataUrl: string }[]
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

export async function exportPhotosBackup(): Promise<number> {
  const photos = await db.photos.toArray()
  const payload: PhotosBackupFile = {
    app: 'ferro-photos',
    version: 1,
    exportedAt: new Date().toISOString(),
    photos: await Promise.all(
      photos.map(async (p) => ({ id: p.id, date: p.date, note: p.note, dataUrl: await blobToDataUrl(p.blob) })),
    ),
  }
  await downloadJson(payload, `nextrep-fotos-${format(new Date(), 'yyyy-MM-dd')}.json`)
  return photos.length
}

/** Añade las fotos del archivo a las existentes (no reemplaza). */
export async function importPhotosBackup(file: File): Promise<number> {
  const data = JSON.parse(await file.text()) as Partial<PhotosBackupFile>
  if (data?.app !== 'ferro-photos' || !Array.isArray(data.photos)) {
    throw new Error('El archivo no es un backup de fotos válido de NextRep')
  }
  const items: ProgressPhoto[] = await Promise.all(
    data.photos.map(async (p) => ({
      id: uid(),
      date: p.date,
      note: p.note,
      blob: await dataUrlToBlob(p.dataUrl),
    })),
  )
  await db.photos.bulkPut(items)
  return items.length
}
