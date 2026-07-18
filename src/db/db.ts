import Dexie, { type Table } from 'dexie'
import type {
  Workout,
  Routine,
  CustomExercise,
  Folder,
  Measurement,
  ProgressPhoto,
  Food,
  Dish,
  FoodLogEntry,
} from './types'

class FerroDB extends Dexie {
  workouts!: Table<Workout, string>
  routines!: Table<Routine, string>
  customExercises!: Table<CustomExercise, string>
  folders!: Table<Folder, string>
  measurements!: Table<Measurement, string>
  photos!: Table<ProgressPhoto, string>
  foods!: Table<Food, string>
  dishes!: Table<Dish, string>
  foodLog!: Table<FoodLogEntry, string>

  constructor() {
    super('ferro')
    this.version(1).stores({
      workouts: 'id, startedAt',
      routines: 'id, sortOrder',
      customExercises: 'id',
    })
    // v2: carpetas, medidas, fotos y nutrición. Aditiva: no migra datos.
    this.version(2).stores({
      workouts: 'id, startedAt',
      routines: 'id, sortOrder, folderId',
      customExercises: 'id',
      folders: 'id, sortOrder',
      measurements: 'id, date, kind, [kind+date]',
      photos: 'id, date',
      foods: 'id, name, source, usedAt, offCode',
      dishes: 'id, name',
      foodLog: 'id, date, [date+meal]',
    })
  }
}

export const db = new FerroDB()

/** Pide almacenamiento persistente para que el navegador no borre los datos. */
export async function ensurePersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
