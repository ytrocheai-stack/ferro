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
  ImportBatch,
  ExternalRef,
} from './types'
import { datasetExerciseIdForHevyName } from '../lib/hevyAliases'

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
  importBatches!: Table<ImportBatch, string>
  externalRefs!: Table<ExternalRef, string>

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
    // v3: trazabilidad y deshacer de importaciones. Aditiva: no cambia IDs ni datos existentes.
    this.version(3).stores({
      workouts: 'id, startedAt',
      routines: 'id, sortOrder, folderId',
      customExercises: 'id',
      folders: 'id, sortOrder',
      measurements: 'id, date, kind, [kind+date]',
      photos: 'id, date',
      foods: 'id, name, source, usedAt, offCode, usdaFdcId',
      dishes: 'id, name',
      foodLog: 'id, date, [date+meal]',
      importBatches: 'id, source, createdAt, status',
      externalRefs: '&key, source, entity, localId, batchId',
    })
    // v4: replace Hevy-created custom exercises with canonical GIF-backed
    // dataset IDs while preserving deliberately created custom-* exercises.
    this.version(4).stores({
      workouts: 'id, startedAt',
      routines: 'id, sortOrder, folderId',
      customExercises: 'id',
      folders: 'id, sortOrder',
      measurements: 'id, date, kind, [kind+date]',
      photos: 'id, date',
      foods: 'id, name, source, usedAt, offCode, usdaFdcId',
      dishes: 'id, name',
      foodLog: 'id, date, [date+meal]',
      importBatches: 'id, source, createdAt, status',
      externalRefs: '&key, source, entity, localId, batchId',
    }).upgrade(async (tx) => {
      const customTable = tx.table<CustomExercise>('customExercises')
      const customs = await customTable.toArray()
      const replacements = new Map<string, string>()
      const removable: string[] = []
      for (const exercise of customs) {
        const replacement = exercise.id.startsWith('hevy-exercise-')
          ? datasetExerciseIdForHevyName(exercise.name)
          : undefined
        if (replacement) {
          replacements.set(exercise.id, replacement)
          removable.push(exercise.id)
        }
      }
      if (!replacements.size) return

      const workoutTable = tx.table<Workout>('workouts')
      const workouts = await workoutTable.toArray()
      for (const workout of workouts) {
        const next = workout.exercises.map((exercise) => {
          const replacement = replacements.get(exercise.exerciseId)
          return replacement ? { ...exercise, exerciseId: replacement } : exercise
        })
        if (next.some((exercise, index) => exercise !== workout.exercises[index])) {
          await workoutTable.put({ ...workout, exercises: next })
        }
      }

      const routineTable = tx.table<Routine>('routines')
      const routines = await routineTable.toArray()
      for (const routine of routines) {
        const next = routine.exercises.map((exercise) => {
          const replacement = replacements.get(exercise.exerciseId)
          return replacement ? { ...exercise, exerciseId: replacement } : exercise
        })
        if (next.some((exercise, index) => exercise !== routine.exercises[index])) {
          await routineTable.put({ ...routine, exercises: next })
        }
      }
      await customTable.bulkDelete(removable)
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
