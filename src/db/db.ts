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
  AdaptationProposal,
  AdaptationJob,
  RoutineRevisionSnapshot,
  AdaptationEventJob,
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
  importBatches!: Table<ImportBatch, string>
  externalRefs!: Table<ExternalRef, string>
  adaptationProposals!: Table<AdaptationProposal, string>
  adaptationJobs!: Table<AdaptationJob, string>
  routineRevisionSnapshots!: Table<RoutineRevisionSnapshot, string>
  adaptationEventJobs!: Table<AdaptationEventJob, string>

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
    // v4: coach/adaptation data. All v3 stores are redeclared to keep upgrades additive.
    this.version(4).stores({
      workouts: 'id, startedAt, routineId, routineRevision',
      routines: 'id, sortOrder, folderId, revision, coachReviewed',
      customExercises: 'id',
      folders: 'id, sortOrder',
      measurements: 'id, date, kind, [kind+date]',
      photos: 'id, date',
      foods: 'id, name, source, usedAt, offCode, usdaFdcId',
      dishes: 'id, name',
      foodLog: 'id, date, [date+meal]',
      importBatches: 'id, source, createdAt, status',
      externalRefs: '&key, source, entity, localId, batchId',
      adaptationProposals: 'id, analysisId, baseRoutineId, status, createdAt, candidateId, supersedesProposalId',
      adaptationJobs: 'id, workoutId, status, createdAt, nextRetryAt',
    }).upgrade((tx) =>
      tx.table<Routine>('routines').toCollection().modify((routine) => {
        routine.revision ??= 1
        routine.trainingRole ??= 'hypertrophy'
        routine.loadIncrementKg ??= 2.5
        routine.coachReviewed ??= false
        routine.exercises = routine.exercises.map((exercise) => ({
          ...exercise,
          role: exercise.role ?? routine.trainingRole,
          loadIncrementKg: exercise.loadIncrementKg ?? routine.loadIncrementKg,
        }))
      }),
    )
    // v5: contratos canónicos, ocurrencias y snapshots completos de rutina.
    // Aditiva: también abre bases locales que ya ejecutaron la v4 preliminar.
    this.version(5).stores({
      workouts: 'id, startedAt, routineId, routineRevision',
      routines: 'id, sortOrder, folderId, revision, coachReviewed',
      customExercises: 'id',
      folders: 'id, sortOrder',
      measurements: 'id, date, kind, [kind+date]',
      photos: 'id, date',
      foods: 'id, name, source, usedAt, offCode, usdaFdcId',
      dishes: 'id, name',
      foodLog: 'id, date, [date+meal]',
      importBatches: 'id, source, createdAt, status',
      externalRefs: '&key, source, entity, localId, batchId',
      adaptationProposals: 'id, analysisId, baseRoutineId, baseRoutineRevision, status, createdAt, candidateId, occurrenceId, supersedesProposalId',
      adaptationJobs: 'id, workoutId, status, createdAt, nextRetryAt, updatedAt',
      routineRevisionSnapshots: 'id, routineId, revision, createdAt, analysisId',
      adaptationEventJobs: 'id, analysisId, status, createdAt, nextRetryAt',
    }).upgrade((tx) => {
      tx.table<Routine>('routines').toCollection().modify((routine) => {
        routine.revision ??= 1
        routine.trainingRole ??= routine.exercises.find((exercise) => exercise.trainingRole ?? exercise.role)?.trainingRole ?? routine.exercises.find((exercise) => exercise.role)?.role ?? 'hypertrophy'
        routine.loadIncrementKg ??= 2.5
        routine.coachReviewed ??= false
        routine.exercises = routine.exercises.map((exercise, index) => ({
          ...exercise,
          occurrenceId: exercise.occurrenceId ?? `${routine.id}:${index}:${exercise.exerciseId}`,
          trainingRole: exercise.trainingRole ?? exercise.role ?? routine.trainingRole,
          loadIncrementKg: exercise.loadIncrementKg ?? routine.loadIncrementKg,
        }))
      })
      tx.table<Workout>('workouts').toCollection().modify((workout) => {
        workout.exercises = workout.exercises.map((exercise, index) => {
          const occurrenceId = exercise.occurrenceId ?? `${workout.routineId ?? workout.id}:${index}:${exercise.exerciseId}`
          const executedSets = exercise.executedSets ?? exercise.sets
          return { ...exercise, occurrenceId, executedSets, ...(exercise.prescription ? { prescription: { ...exercise.prescription, occurrenceId: exercise.prescription.occurrenceId ?? occurrenceId } } : {}) }
        })
      })
      tx.table<AdaptationProposal>('adaptationProposals').toCollection().modify((proposal) => {
        if ((proposal.status as string) === 'applied') proposal.status = 'accepted'
        proposal.policyVersion ??= 'v1'
        proposal.corpusVersion ??= 'none'
        proposal.previousValues ??= proposal.candidate.previous
        proposal.proposedValues ??= proposal.candidate.next
        proposal.rule ??= proposal.candidate.rule
        proposal.confidence ??= proposal.candidate.confidence
        proposal.citations ??= []
        proposal.warnings ??= proposal.candidate.warnings
        proposal.selectedModel ??= 'deterministic'
        proposal.occurrenceId ??= proposal.candidate.exerciseId
      })
      tx.table<AdaptationJob>('adaptationJobs').toCollection().modify((job) => {
        job.attempts ??= 0
        job.updatedAt ??= job.createdAt
      })
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
