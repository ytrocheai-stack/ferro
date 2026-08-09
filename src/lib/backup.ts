import { format } from 'date-fns'
import { db } from '../db/db'
import type {
  CustomExercise,
  Dish,
  ExternalRef,
  Folder,
  Food,
  FoodLogEntry,
  ImportBatch,
  Measurement,
  ProgressPhoto,
  Routine,
  Workout,
} from '../db/types'
import { useSettings, type SettingsValues } from '../stores/settings'
import { useNutrition, type NutritionGoals } from '../stores/nutrition'
import { shareOrDownloadFile, uid } from './format'
import { backupSchema, photosBackupSchema } from './validation'

interface BackupFile {
  app: 'ferro'
  version: 1 | 2 | 3
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
  importBatches?: ImportBatch[]
  externalRefs?: ExternalRef[]
}

export async function exportBackup(): Promise<void> {
  const [workouts, routines, customExercises, folders, measurements, foods, dishes, foodLog, importBatches, externalRefs] =
    await Promise.all([
      db.workouts.toArray(),
      db.routines.toArray(),
      db.customExercises.toArray(),
      db.folders.toArray(),
      db.measurements.toArray(),
      db.foods.toArray(),
      db.dishes.toArray(),
      db.foodLog.toArray(),
      db.importBatches.toArray(),
      db.externalRefs.toArray(),
    ])
  const payload: BackupFile = {
    app: 'ferro',
    version: 3,
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
    importBatches,
    externalRefs,
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
  measurements: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024
export const MAX_PHOTOS_BACKUP_BYTES = 160 * 1024 * 1024

/** Valida todo el árbol antes de tocar las tablas locales. */
export function validateBackup(data: unknown): string | null {
  const result = backupSchema.safeParse(data)
  if (result.success) return null
  const first = result.error.issues[0]
  return first ? `${first.path.join('.') || 'archivo'}: ${first.message}` : 'estructura inválida'
}

/** Reemplaza todos los datos locales (excepto fotos) por los del archivo. */
export async function importBackup(file: File): Promise<ImportResult> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('El backup supera el límite de 25 MB')
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('El archivo no contiene JSON válido; no se ha modificado nada')
  }
  if (!isRecord(parsed) || parsed.app !== 'ferro') {
    throw new Error('El archivo no es un backup válido de NextRep')
  }
  const problem = validateBackup(parsed)
  if (problem) throw new Error(`El backup está dañado (${problem}); no se ha modificado nada`)
  const data = parsed as unknown as BackupFile

  await db.transaction(
    'rw',
    [db.workouts, db.routines, db.customExercises, db.folders, db.measurements, db.foods, db.dishes, db.foodLog, db.importBatches, db.externalRefs],
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
        db.importBatches.clear(),
        db.externalRefs.clear(),
      ])
      await Promise.all([
        db.workouts.bulkPut(data.workouts),
        db.routines.bulkPut(data.routines ?? []),
        db.customExercises.bulkPut(data.customExercises ?? []),
        db.folders.bulkPut(data.folders ?? []),
        db.measurements.bulkPut(data.measurements ?? []),
        db.foods.bulkPut(data.foods ?? []),
        db.dishes.bulkPut(data.dishes ?? []),
        db.foodLog.bulkPut(data.foodLog ?? []),
        db.importBatches.bulkPut(data.importBatches ?? []),
        db.externalRefs.bulkPut(data.externalRefs ?? []),
      ])
    },
  )
  if (data.settings) useSettings.getState().update(data.settings)
  if (data.nutritionGoals) useNutrition.getState().setGoals(data.nutritionGoals)
  return {
    workouts: data.workouts.length,
    routines: data.routines?.length ?? 0,
    customExercises: data.customExercises?.length ?? 0,
    measurements: data.measurements?.length ?? 0,
  }
}

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
  if (!res.ok) throw new Error('No se pudo reconstruir una foto del backup')
  const blob = await res.blob()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    throw new Error('El backup contiene una imagen no permitida')
  }
  return blob
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
  if (file.size > MAX_PHOTOS_BACKUP_BYTES) throw new Error('El backup de fotos supera el límite de 160 MB')
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('El archivo de fotos no contiene JSON válido; no se ha modificado nada')
  }
  const parsedResult = photosBackupSchema.safeParse(parsed)
  if (!parsedResult.success) throw new Error('El archivo no es un backup de fotos válido de NextRep')

  const items: ProgressPhoto[] = await Promise.all(
    parsedResult.data.photos.map(async (p) => ({
      id: uid(),
      date: p.date,
      note: p.note,
      blob: await dataUrlToBlob(p.dataUrl),
    })),
  )
  await db.photos.bulkPut(items)
  return items.length
}
