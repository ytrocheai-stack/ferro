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
  CoachRunRecord,
  CoachMessage,
  CoachProfile,
  CoachConsentRecord,
  CoachConversation,
  CoachDraft,
} from './types'
import { CONTEXT_INVALIDATED_MESSAGE } from '../lib/adaptationErrors'

export class FerroDB extends Dexie {
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
  coachRuns!: Table<CoachRunRecord, string>
  coachMessages!: Table<CoachMessage, string>
  coachProfiles!: Table<CoachProfile, string>
  coachConsents!: Table<CoachConsentRecord, string>
  coachConversations!: Table<CoachConversation, string>
  coachDrafts!: Table<CoachDraft, string>

  constructor(name = 'ferro') {
    super(name)
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
    // v6: propietario persistente del coach. Los registros heredados quedan sin
    // propietario y se ignoran hasta que se creen de nuevo bajo una sesión válida.
    this.version(6).stores({
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
      adaptationProposals: 'id, analysisId, baseRoutineId, baseRoutineRevision, status, createdAt, candidateId, occurrenceId, supersedesProposalId, ownerId',
      adaptationJobs: 'id, workoutId, status, createdAt, nextRetryAt, updatedAt, ownerId',
      routineRevisionSnapshots: 'id, routineId, revision, createdAt, analysisId',
      adaptationEventJobs: 'id, analysisId, status, createdAt, nextRetryAt, ownerId',
    })
    // v7: identidad acreditable del contexto y leasing de ejecuciones locales.
    this.version(7).stores({
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
      adaptationProposals: 'id, analysisId, baseRoutineId, baseRoutineRevision, status, createdAt, candidateId, occurrenceId, supersedesProposalId, ownerId, workoutId, requestId',
      adaptationJobs: 'id, workoutId, status, createdAt, nextRetryAt, updatedAt, ownerId, requestId, leaseExpiresAt',
      routineRevisionSnapshots: 'id, routineId, revision, createdAt, analysisId',
      adaptationEventJobs: 'id, analysisId, status, createdAt, nextRetryAt, ownerId',
    }).upgrade((tx) => {
      tx.table<AdaptationProposal>('adaptationProposals').toCollection().modify((proposal) => {
        if (proposal.ownerId && proposal.status === 'pending' && (!proposal.workoutId || !proposal.requestId || !proposal.contextKey)) {
          proposal.status = 'stale'
        }
      })
      tx.table<AdaptationJob>('adaptationJobs').toCollection().modify((job) => {
        job.runId = undefined
        job.leaseExpiresAt = undefined
        if (!job.ownerId || (job.requestId && job.contextKey && job.payload)) return
        job.status = 'failed'
        job.errorCode = 'context-invalidated'
        job.lastError = CONTEXT_INVALIDATED_MESSAGE
        job.nextRetryAt = undefined
        job.updatedAt ??= job.createdAt
      })
    })
    // v8: ejecuciones durables y conversación del agente privado. Aditiva.
    this.version(8).stores({
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
      adaptationProposals: 'id, analysisId, baseRoutineId, baseRoutineRevision, status, createdAt, candidateId, occurrenceId, supersedesProposalId, ownerId, workoutId, requestId',
      adaptationJobs: 'id, workoutId, status, createdAt, nextRetryAt, updatedAt, ownerId, requestId, leaseExpiresAt',
      routineRevisionSnapshots: 'id, routineId, revision, createdAt, analysisId',
      adaptationEventJobs: 'id, analysisId, status, createdAt, nextRetryAt, ownerId',
      coachRuns: 'id, ownerId, eventId, status, createdAt, updatedAt, contextVersion',
      coachMessages: 'id, ownerId, runId, createdAt, [runId+createdAt]',
    })
    // v9: perfil mínimo, consentimiento versionado y programación/retirada de sesiones.
    this.version(9).stores({
      workouts: 'id, startedAt, routineId, routineRevision',
      routines: 'id, sortOrder, folderId, revision, coachReviewed, scheduledAt, retiredAt',
      customExercises: 'id',
      folders: 'id, sortOrder',
      measurements: 'id, date, kind, [kind+date]',
      photos: 'id, date',
      foods: 'id, name, source, usedAt, offCode, usdaFdcId',
      dishes: 'id, name',
      foodLog: 'id, date, [date+meal]',
      importBatches: 'id, source, createdAt, status',
      externalRefs: '&key, source, entity, localId, batchId',
      adaptationProposals: 'id, analysisId, baseRoutineId, baseRoutineRevision, status, createdAt, candidateId, occurrenceId, supersedesProposalId, ownerId, workoutId, requestId',
      adaptationJobs: 'id, workoutId, status, createdAt, nextRetryAt, updatedAt, ownerId, requestId, leaseExpiresAt',
      adaptationEventJobs: 'id, analysisId, status, createdAt, nextRetryAt, ownerId',
      routineRevisionSnapshots: 'id, routineId, revision, createdAt, analysisId',
      coachRuns: 'id, ownerId, eventId, status, createdAt, updatedAt, contextVersion',
      coachMessages: 'id, ownerId, runId, createdAt, [runId+createdAt]',
      coachProfiles: 'id, ownerId, revision, updatedAt',
      coachConsents: 'id, ownerId, deviceId, version, enabled, revision, updatedAt',
    })
    // v10 (compartida con T4): aditiva. Conserva todos los stores, índices e IDs
    // anteriores; los IDs remotos heredados siguen siendo identidades locales válidas.
    this.version(10).stores({
      workouts: 'id, startedAt, routineId, routineRevision',
      routines: 'id, sortOrder, folderId, revision, coachReviewed, scheduledAt, retiredAt',
      customExercises: 'id',
      folders: 'id, sortOrder',
      measurements: 'id, date, kind, [kind+date]',
      photos: 'id, date',
      foods: 'id, name, source, usedAt, offCode, usdaFdcId',
      dishes: 'id, name',
      foodLog: 'id, date, [date+meal]',
      importBatches: 'id, source, createdAt, status',
      externalRefs: '&key, source, entity, localId, batchId',
      adaptationProposals: 'id, analysisId, baseRoutineId, baseRoutineRevision, status, createdAt, candidateId, occurrenceId, supersedesProposalId, ownerId, workoutId, requestId',
      adaptationJobs: 'id, workoutId, status, createdAt, nextRetryAt, updatedAt, ownerId, requestId, leaseExpiresAt',
      adaptationEventJobs: 'id, analysisId, status, createdAt, nextRetryAt, ownerId',
      routineRevisionSnapshots: 'id, routineId, revision, createdAt, analysisId',
      coachRuns: 'id, ownerId, eventId, conversationId, status, createdAt, updatedAt, contextVersion, remoteRunId, [ownerId+eventId]',
      coachMessages: 'id, ownerId, runId, conversationId, createdAt, [runId+createdAt], [conversationId+sequence]',
      coachProfiles: 'id, ownerId, revision, updatedAt',
      coachConsents: 'id, ownerId, deviceId, version, enabled, revision, updatedAt',
      coachConversations: 'id, ownerId, updatedAt, [ownerId+updatedAt]',
      coachDrafts: 'id, ownerId, conversationId, updatedAt, [ownerId+conversationId]',
    }).upgrade(async (tx) => {
      const runs = await tx.table<CoachRunRecord>('coachRuns').toArray()
      const conversations = tx.table<CoachConversation>('coachConversations')
      const messages = tx.table<CoachMessage>('coachMessages')
      const created = new Map<string, CoachConversation>()
      const runMap = new Map<string, CoachRunRecord>()
      const ensureConversation = async (ownerId: string, id: string, title = 'Nueva conversación') => {
        const key = `${ownerId}:${id}`
        const cached = created.get(key)
        if (cached) return cached
        const existing = await conversations.get(id)
        if (existing?.ownerId === ownerId) { created.set(key, existing); return existing }
        const now = Date.now()
        const next = { id, ownerId, title, createdAt: now, updatedAt: now, nextSequence: 1 } satisfies CoachConversation
        await conversations.put(next); created.set(key, next); return next
      }
      const localIds = new Set(runs.map((run) => run.id))
      for (const run of runs) {
        if (!run.remoteRunId && !run.id.startsWith('coach-local-')) {
          await tx.table<CoachRunRecord>('coachRuns').put({ ...run, remoteRunId: run.id })
          // v8/v9 dejaban el mensaje del usuario apuntando al ID local eliminado.
          // Repara solo la referencia, sin borrar burbujas ni modificar timestamps.
          const oldId = `coach-local-${run.eventId}`
          if (!localIds.has(oldId)) {
            await tx.table<CoachMessage>('coachMessages').where('runId').equals(oldId)
              .filter((message) => message.ownerId === run.ownerId)
              .modify({ runId: run.id })
          }
        }
        const explicitConversationId = run.request?.event?.conversationId
        const conversationId = explicitConversationId || `coach-local-${run.eventId}`
        const repairedRun = { ...run, remoteRunId: run.remoteRunId ?? (!run.id.startsWith('coach-local-') ? run.id : undefined), ...(explicitConversationId ? { conversationId, reconciliationState: run.reconciliationState ?? 'reconciled' } : {}) }
        if (repairedRun.remoteRunId !== run.remoteRunId || (explicitConversationId && run.conversationId !== conversationId)) await tx.table<CoachRunRecord>('coachRuns').put(repairedRun)
        runMap.set(run.id, repairedRun)
        await ensureConversation(run.ownerId, conversationId)
      }
      const legacy = new Map<string, CoachConversation>()
      const ordered = (await messages.toArray()).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      for (const message of ordered) {
        const run = runMap.get(message.runId)
        let conversationId = message.conversationId ?? run?.conversationId ?? (run ? `coach-local-${run.eventId}` : undefined)
        if (!conversationId) {
          let fallback = legacy.get(message.ownerId)
          if (!fallback) { fallback = await ensureConversation(message.ownerId, `coach-history-${message.ownerId}`, 'Historial anterior'); legacy.set(message.ownerId, fallback) }
          conversationId = fallback.id
        }
        const conversation = await ensureConversation(message.ownerId, conversationId)
        const sequence = message.sequence ?? conversation.nextSequence
        await messages.put({ ...message, conversationId, sequence, deliveryState: message.deliveryState ?? 'delivered' })
        await conversations.put({ ...conversation, nextSequence: Math.max(conversation.nextSequence, sequence + 1), updatedAt: Math.max(conversation.updatedAt, message.createdAt) })
      }
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
