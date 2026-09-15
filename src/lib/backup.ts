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
} from '../db/types'
import { useSettings, type SettingsValues } from '../stores/settings'
import { useNutrition, type NutritionGoals } from '../stores/nutrition'
import { shareOrDownloadFile, uid } from './format'
import { backupSchema, normalizeBackup, photosBackupSchema, type ValidBackup } from './validation'
import { normalizeRoutine } from './adaptation'
import { CONTEXT_INVALIDATED_MESSAGE } from './adaptationErrors'
import { getCoachAccountId } from './coachAccount'
import { getCoachConsent, getCoachDeviceId } from './coachConsent'

interface BackupFile {
  app: 'ferro'
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
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
  adaptationProposals?: AdaptationProposal[]
  adaptationJobs?: AdaptationJob[]
  routineRevisionSnapshots?: RoutineRevisionSnapshot[]
  adaptationEventJobs?: AdaptationEventJob[]
  coachRuns?: CoachRunRecord[]
  coachMessages?: CoachMessage[]
  coachProfiles?: CoachProfile[]
  coachConsents?: CoachConsentRecord[]
  coachConversations?: CoachConversation[]
  coachDrafts?: CoachDraft[]
}

export async function exportBackup(): Promise<void> {
  const [workouts, routines, customExercises, folders, measurements, foods, dishes, foodLog, importBatches, externalRefs, adaptationProposals, adaptationJobs, routineRevisionSnapshots, adaptationEventJobs, coachRuns, coachMessages, coachProfiles, coachConsents, coachConversations, coachDrafts] =
    await db.transaction('r', [db.workouts, db.routines, db.customExercises, db.folders, db.measurements, db.foods, db.dishes, db.foodLog, db.importBatches, db.externalRefs, db.adaptationProposals, db.adaptationJobs, db.routineRevisionSnapshots, db.adaptationEventJobs, db.coachRuns, db.coachMessages, db.coachProfiles, db.coachConsents, db.coachConversations, db.coachDrafts], () => Promise.all([
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
      db.adaptationProposals.toArray(),
      db.adaptationJobs.toArray(),
      db.routineRevisionSnapshots.toArray(),
      db.adaptationEventJobs.toArray(),
      db.coachRuns.toArray(),
      db.coachMessages.toArray(),
      db.coachProfiles.toArray(),
      db.coachConsents.toArray(),
      db.coachConversations.toArray(),
      db.coachDrafts.toArray(),
    ]))
  const payload: BackupFile = {
    app: 'ferro',
    version: 11,
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
    adaptationProposals,
    adaptationJobs,
    routineRevisionSnapshots,
    adaptationEventJobs,
    coachRuns,
    coachMessages,
    coachProfiles,
    coachConsents,
    coachConversations,
    coachDrafts,
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

const importTables = [
  db.workouts,
  db.routines,
  db.customExercises,
  db.folders,
  db.measurements,
  db.foods,
  db.dishes,
  db.foodLog,
  db.importBatches,
  db.externalRefs,
  db.adaptationProposals,
  db.adaptationJobs,
  db.routineRevisionSnapshots,
  db.adaptationEventJobs,
  db.coachRuns,
  db.coachMessages,
  db.coachProfiles,
  db.coachConsents,
  db.coachConversations,
  db.coachDrafts,
] as const

interface ImportDatabaseSnapshot {
  workouts: Workout[]
  routines: Routine[]
  customExercises: CustomExercise[]
  folders: Folder[]
  measurements: Measurement[]
  foods: Food[]
  dishes: Dish[]
  foodLog: FoodLogEntry[]
  importBatches: ImportBatch[]
  externalRefs: ExternalRef[]
  adaptationProposals: AdaptationProposal[]
  adaptationJobs: AdaptationJob[]
  routineRevisionSnapshots: RoutineRevisionSnapshot[]
  adaptationEventJobs: AdaptationEventJob[]
  coachRuns: CoachRunRecord[]
  coachMessages: CoachMessage[]
  coachProfiles: CoachProfile[]
  coachConsents: CoachConsentRecord[]
  coachConversations: CoachConversation[]
  coachDrafts: CoachDraft[]
}

async function snapshotImportDatabase(): Promise<ImportDatabaseSnapshot> {
  return db.transaction('r', importTables, () => Promise.all([
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
    db.adaptationProposals.toArray(),
    db.adaptationJobs.toArray(),
    db.routineRevisionSnapshots.toArray(),
    db.adaptationEventJobs.toArray(),
    db.coachRuns.toArray(),
    db.coachMessages.toArray(),
    db.coachProfiles.toArray(),
    db.coachConsents.toArray(),
    db.coachConversations.toArray(),
    db.coachDrafts.toArray(),
  ]).then(([workouts, routines, customExercises, folders, measurements, foods, dishes, foodLog, importBatches, externalRefs, adaptationProposals, adaptationJobs, routineRevisionSnapshots, adaptationEventJobs, coachRuns, coachMessages, coachProfiles, coachConsents, coachConversations, coachDrafts]) => ({
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
    adaptationProposals,
    adaptationJobs,
    routineRevisionSnapshots,
    adaptationEventJobs,
    coachRuns,
    coachMessages,
    coachProfiles,
    coachConsents,
    coachConversations,
    coachDrafts,
  })))
}

async function restoreImportDatabase(snapshot: ImportDatabaseSnapshot): Promise<void> {
  await db.transaction('rw', importTables, async () => {
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
      db.adaptationProposals.clear(),
      db.adaptationJobs.clear(),
      db.routineRevisionSnapshots.clear(),
      db.adaptationEventJobs.clear(),
      db.coachRuns.clear(),
      db.coachMessages.clear(),
      db.coachProfiles.clear(),
      db.coachConsents.clear(),
      db.coachConversations.clear(),
      db.coachDrafts.clear(),
    ])
    await Promise.all([
      db.workouts.bulkPut(snapshot.workouts),
      db.routines.bulkPut(snapshot.routines),
      db.customExercises.bulkPut(snapshot.customExercises),
      db.folders.bulkPut(snapshot.folders),
      db.measurements.bulkPut(snapshot.measurements),
      db.foods.bulkPut(snapshot.foods),
      db.dishes.bulkPut(snapshot.dishes),
      db.foodLog.bulkPut(snapshot.foodLog),
      db.importBatches.bulkPut(snapshot.importBatches),
      db.externalRefs.bulkPut(snapshot.externalRefs),
      db.adaptationProposals.bulkPut(snapshot.adaptationProposals),
      db.adaptationJobs.bulkPut(snapshot.adaptationJobs),
      db.routineRevisionSnapshots.bulkPut(snapshot.routineRevisionSnapshots),
      db.adaptationEventJobs.bulkPut(snapshot.adaptationEventJobs),
      db.coachRuns.bulkPut(snapshot.coachRuns),
      db.coachMessages.bulkPut(snapshot.coachMessages),
      db.coachProfiles.bulkPut(snapshot.coachProfiles),
      db.coachConsents.bulkPut(snapshot.coachConsents),
      db.coachConversations.bulkPut(snapshot.coachConversations),
      db.coachDrafts.bulkPut(snapshot.coachDrafts),
    ])
  })
}

const noOpPersistStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }

function restoreLocalState(snapshot: { settings: ReturnType<typeof useSettings.getState>; nutrition: ReturnType<typeof useNutrition.getState> }): void {
  const settingsStorage = useSettings.persist.getOptions().storage
  useSettings.persist.setOptions({ storage: noOpPersistStorage })
  try {
    useSettings.setState(snapshot.settings, true)
  } finally {
    useSettings.persist.setOptions({ storage: settingsStorage })
  }

  const nutritionStorage = useNutrition.persist.getOptions().storage
  useNutrition.persist.setOptions({ storage: noOpPersistStorage })
  try {
    useNutrition.setState(snapshot.nutrition, true)
  } finally {
    useNutrition.persist.setOptions({ storage: nutritionStorage })
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function sanitizeImportedProposal(proposal: AdaptationProposal): AdaptationProposal | null {
  if (!proposal.ownerId) return null
  const normalized = {
    ...proposal,
    status: (proposal.status as string) === 'applied' ? 'accepted' : proposal.status,
    policyVersion: proposal.policyVersion ?? 'v1',
    corpusVersion: proposal.corpusVersion ?? 'none',
    previousValues: proposal.previousValues ?? proposal.candidate.previous,
    proposedValues: proposal.proposedValues ?? proposal.candidate.next,
    rule: proposal.rule ?? proposal.candidate.rule,
    confidence: proposal.confidence ?? proposal.candidate.confidence,
    citations: proposal.citations ?? [],
    warnings: proposal.warnings ?? proposal.candidate.warnings,
    selectedModel: proposal.selectedModel ?? 'deterministic' as const,
  }
  return normalized.status === 'pending' && (!normalized.workoutId || !normalized.requestId || !normalized.contextKey)
    ? { ...normalized, status: 'stale' }
    : normalized
}

function sanitizeImportedJob(job: AdaptationJob): AdaptationJob | null {
  if (!job.ownerId) return null
  if (job.requestId && job.contextKey && job.payload) return job
  return {
    ...job,
    status: 'failed',
    errorCode: 'context-invalidated',
    lastError: CONTEXT_INVALIDATED_MESSAGE,
    nextRetryAt: undefined,
    runId: undefined,
    leaseExpiresAt: undefined,
    updatedAt: job.updatedAt ?? job.createdAt,
  }
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
  // La validación puede transformar strings (trim); restaurar el contenido original.
  const data = normalizeBackup(parsed as ValidBackup) as BackupFile
  const normalizedProblem = validateBackup(data)
  if (normalizedProblem) throw new Error(`El backup está dañado tras normalizar (${normalizedProblem}); no se ha modificado nada`)
  const activeOwner = getCoachAccountId()
  const coachOwners = new Set([
    ...(data.coachRuns ?? []).map((record) => record.ownerId),
    ...(data.coachMessages ?? []).map((record) => record.ownerId),
    ...(data.coachProfiles ?? []).map((record) => record.ownerId),
    ...(data.coachConsents ?? []).map((record) => record.ownerId),
    ...(data.coachConversations ?? []).map((record) => record.ownerId),
    ...(data.coachDrafts ?? []).map((record) => record.ownerId),
  ])
  if (coachOwners.size > 0 && !activeOwner) throw new Error('Se requiere una cuenta activa para importar datos del Coach; no se ha modificado nada')
  if (activeOwner && [...coachOwners].some((ownerId) => ownerId !== activeOwner)) throw new Error('El backup pertenece a otra cuenta; no se ha modificado nada')
  const databaseSnapshot = await snapshotImportDatabase()
  const localStateSnapshot = { settings: useSettings.getState(), nutrition: useNutrition.getState() }
  await db.transaction(
    'rw',
    importTables,
    async () => {
      // Leer dentro de la misma transacción evita restaurar un consentimiento
      // obsoleto si otra pestaña lo revoca mientras se valida el archivo.
      const currentDeviceId = activeOwner ? getCoachDeviceId() : undefined
      const existingConsents = await db.coachConsents.toArray()
      const existingCurrentConsent = activeOwner && currentDeviceId
        ? existingConsents.find((consent) => consent.ownerId === activeOwner && consent.deviceId === currentDeviceId)
        : undefined
      const preservedConsents = existingConsents.filter((consent) => !(activeOwner && consent.ownerId === activeOwner && consent.deviceId === currentDeviceId))
      if (activeOwner && currentDeviceId) {
        const localConsent = getCoachConsent(activeOwner)
        if (localConsent) {
          preservedConsents.push({
            ...(existingCurrentConsent ?? { id: `${activeOwner}:${currentDeviceId}`, ownerId: activeOwner, deviceId: currentDeviceId, revision: localConsent.acceptedAt, acceptedAt: localConsent.acceptedAt, updatedAt: localConsent.acceptedAt }),
            ownerId: activeOwner,
            deviceId: currentDeviceId,
            version: localConsent.version,
            enabled: true,
          })
        } else if (existingCurrentConsent) {
          preservedConsents.push(existingCurrentConsent)
        }
      }
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
        db.adaptationProposals.clear(),
        db.adaptationJobs.clear(),
        db.routineRevisionSnapshots.clear(),
        db.adaptationEventJobs.clear(),
        db.coachRuns.clear(),
        db.coachMessages.clear(),
        db.coachProfiles.clear(),
        db.coachConsents.clear(),
        db.coachConversations.clear(),
        db.coachDrafts.clear(),
      ])
      await Promise.all([
        db.workouts.bulkPut(data.workouts),
        db.routines.bulkPut((data.routines ?? []).map(normalizeRoutine)),
        db.customExercises.bulkPut(data.customExercises ?? []),
        db.folders.bulkPut(data.folders ?? []),
        db.measurements.bulkPut(data.measurements ?? []),
        db.foods.bulkPut(data.foods ?? []),
        db.dishes.bulkPut(data.dishes ?? []),
        db.foodLog.bulkPut(data.foodLog ?? []),
        db.importBatches.bulkPut(data.importBatches ?? []),
        db.externalRefs.bulkPut(data.externalRefs ?? []),
        db.adaptationProposals.bulkPut((data.adaptationProposals ?? []).map(sanitizeImportedProposal).filter((proposal) => proposal !== null)),
        db.adaptationJobs.bulkPut((data.adaptationJobs ?? []).map(sanitizeImportedJob).filter((job) => job !== null)),
        db.routineRevisionSnapshots.bulkPut(data.routineRevisionSnapshots ?? []),
        db.adaptationEventJobs.bulkPut((data.adaptationEventJobs ?? []).filter((job) => !!job.ownerId)),
        db.coachRuns.bulkPut(data.coachRuns ?? []),
        db.coachMessages.bulkPut(data.coachMessages ?? []),
        db.coachProfiles.bulkPut(data.coachProfiles ?? []),
        db.coachConsents.bulkPut([...new Map([
          ...(data.coachConsents ?? []).map((consent) => [consent.id, { ...consent, enabled: false }] as const),
          ...preservedConsents.map((consent) => [consent.id, consent] as const),
        ]).values()]),
        db.coachConversations.bulkPut(data.coachConversations ?? []),
        db.coachDrafts.bulkPut(data.coachDrafts ?? []),
      ])
    },
  )
  try {
    if (data.settings) useSettings.getState().update(data.settings)
    if (data.nutritionGoals) useNutrition.getState().setGoals(data.nutritionGoals)
  } catch (error) {
    try {
      await restoreImportDatabase(databaseSnapshot)
    } finally {
      restoreLocalState(localStateSnapshot)
    }
    throw error
  }
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
