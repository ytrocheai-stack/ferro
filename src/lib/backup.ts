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
import { backupSchema, photosBackupSchema } from './validation'
import { normalizeRoutine } from './adaptation'
import { CONTEXT_INVALIDATED_MESSAGE } from './adaptationErrors'

interface BackupFile {
  app: 'ferro'
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
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
    ])
  const payload: BackupFile = {
    app: 'ferro',
    version: 10,
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
  const data = parsed as unknown as BackupFile

  await db.transaction(
    'rw',
    [db.workouts, db.routines, db.customExercises, db.folders, db.measurements, db.foods, db.dishes, db.foodLog, db.importBatches, db.externalRefs, db.adaptationProposals, db.adaptationJobs, db.routineRevisionSnapshots, db.adaptationEventJobs, db.coachRuns, db.coachMessages, db.coachProfiles, db.coachConsents, db.coachConversations, db.coachDrafts],
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
        db.coachRuns.bulkPut((data.coachRuns ?? []).filter((run) => !!run.ownerId)),
        db.coachMessages.bulkPut((data.coachMessages ?? []).filter((message) => !!message.ownerId)),
        db.coachProfiles.bulkPut((data.coachProfiles ?? []).filter((profile) => !!profile.ownerId)),
        db.coachConsents.bulkPut((data.coachConsents ?? []).filter((consent) => !!consent.ownerId)),
        db.coachConversations.bulkPut((data.coachConversations ?? []).filter((conversation) => !!conversation.ownerId)),
        db.coachDrafts.bulkPut((data.coachDrafts ?? []).filter((draft) => !!draft.ownerId)),
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
