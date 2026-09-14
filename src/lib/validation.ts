import { z } from 'zod'
import { agentDecisionSchema, coachRunRequestSchema, exerciseAnalysisInputSchema, sourceSchema } from '../../packages/adaptation-core/src/contract'

const finite = z.number().finite()
const nonEmpty = z.string().trim().min(1)

const loggedSetSchema = z.object({
  type: z.enum(['normal', 'warmup', 'failure', 'drop']),
  weightKg: finite,
  reps: finite,
  completed: z.boolean(),
  rpe: finite.optional(),
  rir: z.number().int().min(0).max(10).optional(),
  durationSec: finite.optional(),
  distanceM: finite.optional(),
})

const prescriptionSchema = z.object({
  occurrenceId: nonEmpty.optional(), plannedSets: finite,
  setTargets: z.array(z.object({ type: z.enum(['normal', 'warmup', 'failure', 'drop']), weightKg: finite.optional(), reps: finite.optional(), durationSec: finite.optional(), distanceM: finite.optional() }).strict()).optional(),
  restSec: finite, supersetGroup: finite.optional(), repRangeMin: finite.optional(), repRangeMax: finite.optional(),
  trainingRole: z.enum(['strength', 'hypertrophy', 'accessory']).optional(), targetRpeMin: finite.optional(), targetRpeMax: finite.optional(), loadIncrementKg: finite.optional(),
}).strict()

const workoutExerciseSchema = z.object({
  occurrenceId: nonEmpty.optional(),
  exerciseId: nonEmpty,
  notes: z.string().optional(),
  restSec: finite,
  sets: z.array(loggedSetSchema),
  executedSets: z.array(loggedSetSchema).optional(),
  prescription: prescriptionSchema.optional(),
  supersetGroup: finite.optional(),
  role: z.enum(['strength', 'hypertrophy', 'accessory']).optional(),
  trainingRole: z.enum(['strength', 'hypertrophy', 'accessory']).optional(),
  repRangeMin: finite.optional(),
  repRangeMax: finite.optional(),
  targetRpeMin: finite.optional(),
  targetRpeMax: finite.optional(),
  loadIncrementKg: finite.optional(),
  plannedSets: finite.optional(),
  plannedSetTypes: z.array(z.enum(['normal', 'warmup', 'failure', 'drop'])).optional(),
})

const prSchema = z.object({
  exerciseId: nonEmpty,
  kind: z.enum(['weight', 'e1rm', 'setVolume']),
  value: finite,
  prev: finite.optional(),
})

const plannedSetSchema = z.object({
  type: z.enum(['normal', 'warmup', 'failure', 'drop']),
  weightKg: finite.optional(),
  reps: finite.optional(),
  durationSec: finite.optional(),
  distanceM: finite.optional(),
})

const routineExerciseSchema = z.object({
  occurrenceId: nonEmpty.optional(),
  exerciseId: nonEmpty,
  plannedSets: finite,
  setTargets: z.array(plannedSetSchema).optional(),
  restSec: finite,
  notes: z.string().optional(),
  routineId: z.string().optional(),
  routineRevision: finite.optional(),
  postWorkoutFeedback: z.object({
    completed: z.boolean().optional(),
    generalPain: z.boolean().optional(),
    exercisePain: z.array(z.string()).optional(),
    energy: finite.optional(),
    difficulty: finite.optional(),
    contradictory: z.boolean().optional(),
  }).optional(),
  supersetGroup: finite.optional(),
  repRangeMin: finite.optional(),
  repRangeMax: finite.optional(),
  role: z.enum(['strength', 'hypertrophy', 'accessory']).optional(),
  trainingRole: z.enum(['strength', 'hypertrophy', 'accessory']).optional(),
  targetRpeMin: finite.optional(),
  targetRpeMax: finite.optional(),
  loadIncrementKg: finite.optional(),
})

export const workoutSchema = z.object({
  id: nonEmpty,
  name: z.string(),
  startedAt: finite,
  endedAt: finite,
  exercises: z.array(workoutExerciseSchema),
  volumeKg: finite,
  totalSets: finite,
  prs: z.array(prSchema),
  notes: z.string().optional(),
})

const routineSchema = z.object({
  id: nonEmpty,
  name: z.string(),
  sortOrder: finite,
  exercises: z.array(routineExerciseSchema),
  createdAt: finite,
  folderId: z.string().optional(),
  revision: finite.optional(),
  trainingRole: z.enum(['strength', 'hypertrophy', 'accessory']).optional(),
  loadIncrementKg: finite.optional(),
  coachReviewed: z.boolean().optional(),
  scheduledAt: finite.optional(),
  retiredAt: finite.optional(),
})

const folderSchema = z.object({ id: nonEmpty, name: z.string(), sortOrder: finite })
const customExerciseSchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  bodyPart: z.string(),
  equipment: z.string(),
  target: z.string(),
  secondaryMuscles: z.array(z.string()),
  createdAt: finite,
})
const measurementSchema = z.object({
  id: nonEmpty,
  date: finite,
  kind: z.enum([
    'weight',
    'bodyfat',
    'neck',
    'shoulders',
    'chest',
    'arm_l',
    'arm_r',
    'forearm_l',
    'forearm_r',
    'waist',
    'hips',
    'thigh_l',
    'thigh_r',
    'calf_l',
    'calf_r',
  ]),
  value: finite,
})
const foodSchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  brand: z.string().optional(),
  source: z.enum(['custom', 'off', 'seed', 'usda']),
  offCode: z.string().optional(),
  usdaFdcId: z.number().int().positive().optional(),
  aliases: z.array(z.string()).optional(),
  kcal100: finite,
  p100: finite,
  c100: finite,
  f100: finite,
  servingG: finite.optional(),
  favorite: z.boolean().optional(),
  usedAt: finite.optional(),
})
const dishItemSchema = z.object({
  foodId: z.string().optional(),
  name: nonEmpty,
  grams: finite,
  kcal: finite,
  p: finite,
  c: finite,
  f: finite,
})
const dishSchema = z.object({ id: nonEmpty, name: nonEmpty, items: z.array(dishItemSchema), createdAt: finite })
const foodLogSchema = z.object({
  id: nonEmpty,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  foodId: z.string().optional(),
  name: nonEmpty,
  grams: finite,
  kcal: finite,
  p: finite,
  c: finite,
  f: finite,
})

const importBatchSchema = z.object({
  id: nonEmpty,
  source: z.enum(['hevy-csv', 'hevy-api']),
  createdAt: finite,
  status: z.enum(['completed', 'undone']),
  counts: z.record(z.string(), finite).optional(),
})
const externalRefSchema = z.object({
  key: nonEmpty,
  source: z.enum(['hevy-csv', 'hevy-api']),
  entity: z.enum(['workout', 'routine', 'folder', 'measurement', 'exercise']),
  externalId: nonEmpty,
  localId: nonEmpty,
  batchId: nonEmpty,
})

const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  units: z.enum(['kg', 'lb']).optional(),
  defaultRestSec: finite.optional(),
  sound: z.boolean().optional(),
  vibration: z.boolean().optional(),
  restNotification: z.boolean().optional(),
  keepAwake: z.boolean().optional(),
  trackRpe: z.boolean().optional(),
  trackRir: z.boolean().optional(),
  weeklyGoal: finite.optional(),
  barWeightKg: finite.optional(),
  platesKg: z.array(finite).optional(),
})
const nutritionGoalsSchema = z.object({
  configured: z.boolean().optional(),
  sex: z.enum(['male', 'female']).optional(),
  age: finite.optional(),
  heightCm: finite.optional(),
  activity: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']).optional(),
  goal: z.enum(['bulk', 'maintain', 'cut']).optional(),
  kcal: finite.optional(),
  proteinG: finite.optional(),
  carbsG: finite.optional(),
  fatG: finite.optional(),
})

const coachRunSchema = z.object({
  id: nonEmpty,
  remoteRunId: nonEmpty.optional(),
  dispatchToken: nonEmpty.optional(),
  dispatchLeaseExpiresAt: finite.optional(),
  ownerId: nonEmpty,
  eventId: nonEmpty,
  conversationId: nonEmpty.optional(),
  messageId: nonEmpty.optional(),
  reconciliationState: z.enum(['pending', 'reconciled', 'uncertain']).optional(),
  contextVersion: nonEmpty,
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  request: coachRunRequestSchema,
  decision: agentDecisionSchema.optional(),
  error: z.string().optional(),
  cancelRequestedAt: finite.optional(),
  lastError: z.string().optional(),
  usage: z.object({ inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional() }).strict().optional(),
  createdAt: finite,
  updatedAt: finite,
  startedAt: finite.optional(),
  endedAt: finite.optional(),
  appliedAt: finite.optional(),
}).strict()

const coachMessageSchema = z.object({
  id: nonEmpty,
  ownerId: nonEmpty,
  runId: nonEmpty,
  conversationId: nonEmpty.optional(),
  sequence: z.number().int().positive().optional(),
  role: z.enum(['user', 'assistant']),
  content: nonEmpty.max(4000),
  createdAt: finite,
  contextVersion: nonEmpty,
  deliveryState: z.enum(['pending', 'sent', 'delivered', 'failed']).optional(),
}).strict()

const coachConversationSchema = z.object({
  id: nonEmpty,
  ownerId: nonEmpty,
  title: z.string().max(200),
  createdAt: finite,
  updatedAt: finite,
  nextSequence: z.number().int().positive(),
  pendingDeletion: z.boolean().optional(),
}).strict()

const coachDraftSchema = z.object({
  id: nonEmpty,
  ownerId: nonEmpty,
  conversationId: nonEmpty,
  content: z.string().max(4000),
  updatedAt: finite,
}).strict()

const coachProfileSchema = z.object({
  id: nonEmpty,
  ownerId: nonEmpty,
  population: z.array(nonEmpty.max(120)).max(20),
  populationConfirmed: z.boolean(),
  experience: z.enum(['novice', 'intermediate', 'advanced']).optional(),
  goals: z.array(nonEmpty.max(400)).max(20),
  injuriesOrPain: z.array(nonEmpty.max(400)).max(40),
  unavailableEquipment: z.array(nonEmpty.max(200)).max(80),
  excludedExercises: z.array(nonEmpty.max(160)).max(80),
  nutritionConstraints: z.array(nonEmpty.max(400)).max(40),
  revision: z.number().int().positive(),
  updatedAt: finite,
}).strict()

const coachConsentSchema = z.object({
  id: nonEmpty,
  ownerId: nonEmpty,
  deviceId: nonEmpty,
  version: nonEmpty,
  enabled: z.boolean(),
  revision: z.number().int().positive(),
  acceptedAt: finite,
  updatedAt: finite,
}).strict()

const candidateRecordSchema = z.object({
  candidateId: nonEmpty,
  kind: z.enum(['maintain', 'increase-reps', 'increase-load', 'add-set', 'reduce-load', 'reduce-set']),
  rule: nonEmpty,
  exerciseId: nonEmpty,
  occurrenceId: nonEmpty.optional(),
  previous: z.object({ plannedSets: finite, repsMin: finite, repsMax: finite, loadKg: finite.optional() }).strict(),
  next: z.object({ plannedSets: finite, repsMin: finite, repsMax: finite, loadKg: finite.optional() }).strict(),
  evidence: z.object({ comparableWorkoutIds: z.array(nonEmpty), comparableCount: finite, medianWeightKg: finite.optional(), medianReps: finite.optional(), completedUpperBoundCount: finite, discreteIncreaseCount: finite, currentE1rmKg: finite.optional(), medianPreviousE1rmKg: finite.optional() }).strict(),
  confidence: z.enum(['low', 'medium', 'high']), warnings: z.array(z.string()), citations: z.array(z.string()).optional(), explanation: z.string(),
}).strict()

export const backupSchema = z.object({
  app: z.literal('ferro'),
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10)]),
  exportedAt: z.string(),
  settings: settingsSchema.optional(),
  nutritionGoals: nutritionGoalsSchema.optional(),
  workouts: z.array(workoutSchema),
  routines: z.array(routineSchema),
  customExercises: z.array(customExerciseSchema),
  folders: z.array(folderSchema).optional(),
  measurements: z.array(measurementSchema).optional(),
  foods: z.array(foodSchema).optional(),
  dishes: z.array(dishSchema).optional(),
  foodLog: z.array(foodLogSchema).optional(),
  importBatches: z.array(importBatchSchema).optional(),
  externalRefs: z.array(externalRefSchema).optional(),
  adaptationProposals: z.array(z.object({
    id: nonEmpty,
    ownerId: nonEmpty.optional(),
    workoutId: nonEmpty.optional(),
    requestId: nonEmpty.optional(),
    contextKey: nonEmpty.optional(),
    analysisId: nonEmpty,
    baseRoutineId: nonEmpty,
    baseRoutineRevision: finite,
    exerciseId: nonEmpty,
    status: z.enum(['pending', 'accepted', 'edited', 'rejected', 'applied', 'stale', 'reverted']),
    createdAt: finite,
    candidateId: nonEmpty,
    candidate: candidateRecordSchema,
    candidateOptions: z.array(candidateRecordSchema),
    proposalRevision: finite,
    policyVersion: nonEmpty.optional(),
    corpusVersion: z.string().optional(),
    previousValues: z.object({ plannedSets: finite, repsMin: finite, repsMax: finite, loadKg: finite.optional() }).strict().optional(),
    proposedValues: z.object({ plannedSets: finite, repsMin: finite, repsMax: finite, loadKg: finite.optional() }).strict().optional(),
    rule: z.string().optional(), confidence: z.enum(['low', 'medium', 'high']).optional(), citations: z.array(z.string()).optional(), warnings: z.array(z.string()).optional(),
    selectedModel: z.enum(['deterministic', 'flash', 'pro']).optional(), occurrenceId: nonEmpty.optional(), routineSnapshotId: nonEmpty.optional(),
    sources: z.array(sourceSchema).optional(),
    supersedesProposalId: z.string().optional(),
    appliedRoutineRevision: finite.optional(),
  }).strict()).optional(),
  adaptationJobs: z.array(z.object({
    id: nonEmpty,
    ownerId: nonEmpty.optional(),
    workoutId: nonEmpty,
    requestId: nonEmpty.optional(),
    contextKey: nonEmpty.optional(),
    runId: nonEmpty.optional(),
    leaseExpiresAt: finite.optional(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']),
    createdAt: finite,
    nextRetryAt: finite.optional(),
    attempts: finite.optional(),
    analysisId: z.string().optional(),
    lastError: z.string().optional(),
    updatedAt: finite.optional(),
    errorCode: z.enum(['session-expired', 'unauthorized', 'quota-exhausted', 'temporary', 'invalid-response', 'conflict', 'context-invalidated']).optional(),
    pendingExplanation: z.boolean().optional(),
    payload: z.object({
      inputs: z.array(exerciseAnalysisInputSchema),
      consentVersion: nonEmpty,
      deviceId: nonEmpty,
    }).strict().optional(),
  })).optional(),
  routineRevisionSnapshots: z.array(z.object({ id: nonEmpty, routineId: nonEmpty, revision: finite, createdAt: finite, analysisId: nonEmpty.optional(), routine: routineSchema })).optional(),
  adaptationEventJobs: z.array(z.object({ id: nonEmpty, ownerId: nonEmpty.optional(), analysisId: nonEmpty, exerciseId: nonEmpty, candidateId: nonEmpty.optional(), event: z.enum(['accepted', 'rejected', 'edited', 'reverted']), status: z.enum(['pending', 'sent', 'failed']), createdAt: finite, attempts: finite, nextRetryAt: finite.optional() })).optional(),
  coachRuns: z.array(coachRunSchema).optional(),
  coachMessages: z.array(coachMessageSchema).optional(),
  coachProfiles: z.array(coachProfileSchema).optional(),
  coachConsents: z.array(coachConsentSchema).optional(),
  coachConversations: z.array(coachConversationSchema).optional(),
  coachDrafts: z.array(coachDraftSchema).optional(),
}).superRefine((backup, ctx) => {
  const duplicateIds = (items: Array<{ id: string }> | undefined, path: string) => {
    const seen = new Set<string>()
    for (const [index, item] of (items ?? []).entries()) {
      if (seen.has(item.id)) ctx.addIssue({ code: 'custom', path: [path, index, 'id'], message: 'ID duplicado' })
      seen.add(item.id)
    }
  }
  duplicateIds(backup.workouts, 'workouts')
  duplicateIds(backup.routines, 'routines')
  duplicateIds(backup.customExercises, 'customExercises')
  duplicateIds(backup.coachRuns, 'coachRuns')
  duplicateIds(backup.coachMessages, 'coachMessages')
  duplicateIds(backup.coachProfiles, 'coachProfiles')
  duplicateIds(backup.coachConsents, 'coachConsents')
  duplicateIds(backup.coachConversations, 'coachConversations')
  duplicateIds(backup.coachDrafts, 'coachDrafts')

  const runs = new Map((backup.coachRuns ?? []).map((run) => [run.id, run]))
  const conversations = new Map((backup.coachConversations ?? []).map((conversation) => [conversation.id, conversation]))
  const messages = new Map((backup.coachMessages ?? []).map((message) => [message.id, message]))
  const owners = new Set<string>()
  for (const record of [...(backup.coachRuns ?? []), ...(backup.coachMessages ?? []), ...(backup.coachProfiles ?? []), ...(backup.coachConsents ?? []), ...(backup.coachConversations ?? []), ...(backup.coachDrafts ?? [])]) owners.add(record.ownerId)
  if (owners.size > 1) ctx.addIssue({ code: 'custom', path: ['coach'], message: 'Todos los registros Coach deben pertenecer al mismo propietario' })
  for (const [index, message] of (backup.coachMessages ?? []).entries()) {
    const run = runs.get(message.runId)
    if (!run || run.ownerId !== message.ownerId) ctx.addIssue({ code: 'custom', path: ['coachMessages', index, 'runId'], message: 'Referencia a run inválida' })
    if (message.conversationId) {
      const conversation = conversations.get(message.conversationId)
      if (!conversation || conversation.ownerId !== message.ownerId) ctx.addIssue({ code: 'custom', path: ['coachMessages', index, 'conversationId'], message: 'Referencia a conversación inválida' })
    }
  }
  for (const [index, run] of (backup.coachRuns ?? []).entries()) {
    if (run.request.event.accountId !== run.ownerId || run.request.event.id !== run.eventId) ctx.addIssue({ code: 'custom', path: ['coachRuns', index], message: 'Owner o evento inconsistente' })
    if (run.conversationId) {
      const conversation = conversations.get(run.conversationId)
      if (!conversation || conversation.ownerId !== run.ownerId) ctx.addIssue({ code: 'custom', path: ['coachRuns', index, 'conversationId'], message: 'Referencia a conversación inválida' })
    }
    if (run.messageId && (!messages.get(run.messageId) || messages.get(run.messageId)?.ownerId !== run.ownerId)) ctx.addIssue({ code: 'custom', path: ['coachRuns', index, 'messageId'], message: 'Referencia a mensaje inválida' })
  }
  for (const [index, draft] of (backup.coachDrafts ?? []).entries()) {
    const conversation = conversations.get(draft.conversationId)
    if (!conversation || conversation.ownerId !== draft.ownerId) ctx.addIssue({ code: 'custom', path: ['coachDrafts', index, 'conversationId'], message: 'Referencia a conversación inválida' })
  }
  for (const conversation of backup.coachConversations ?? []) {
    const sequences = (backup.coachMessages ?? []).filter((message) => message.conversationId === conversation.id && message.ownerId === conversation.ownerId).map((message) => message.sequence).filter((sequence): sequence is number => sequence !== undefined)
    if (sequences.some((sequence) => sequence >= conversation.nextSequence) || new Set(sequences).size !== sequences.length) ctx.addIssue({ code: 'custom', path: ['coachConversations'], message: 'Secuencia de conversación imposible' })
    if (sequences.length > 0 && Math.max(...sequences) + 1 !== conversation.nextSequence) ctx.addIssue({ code: 'custom', path: ['coachConversations'], message: 'nextSequence no corresponde a los mensajes' })
  }
})

export const photosBackupSchema = z.object({
  app: z.literal('ferro-photos'),
  version: z.literal(1),
  exportedAt: z.string(),
  photos: z.array(
    z.object({
      id: nonEmpty,
      date: finite,
      note: z.string().optional(),
      dataUrl: z.string().regex(/^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i),
    }),
  ),
})

export type ValidBackup = z.infer<typeof backupSchema>

/** Normaliza formatos antiguos sin inventar registros ni eliminar historiales. */
export function normalizeBackup(value: ValidBackup): ValidBackup {
  return {
    ...value,
    folders: value.folders ?? [],
    measurements: value.measurements ?? [],
    foods: value.foods ?? [],
    dishes: value.dishes ?? [],
    foodLog: value.foodLog ?? [],
    importBatches: value.importBatches ?? [],
    externalRefs: value.externalRefs ?? [],
    adaptationProposals: value.adaptationProposals ?? [],
    adaptationJobs: value.adaptationJobs ?? [],
    routineRevisionSnapshots: value.routineRevisionSnapshots ?? [],
    adaptationEventJobs: value.adaptationEventJobs ?? [],
    coachRuns: value.coachRuns ?? [],
    coachMessages: value.coachMessages ?? [],
    coachProfiles: value.coachProfiles ?? [],
    coachConsents: value.coachConsents ?? [],
    coachConversations: value.coachConversations ?? [],
    coachDrafts: value.coachDrafts ?? [],
  }
}
