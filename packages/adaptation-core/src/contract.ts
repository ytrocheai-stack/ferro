import { z } from 'zod'

const finite = z.number().finite()
const nonEmpty = z.string().trim().min(1)

export const sourceSchema = z.object({
  id: nonEmpty,
  author: nonEmpty,
  title: nonEmpty,
  url: z.string().url(),
  license: nonEmpty,
  evidenceLevel: finite,
  language: nonEmpty.optional(),
  publishedAt: nonEmpty.optional(),
  location: nonEmpty.optional(),
}).strict()

export const evidenceSchema = z.object({
  comparableWorkoutIds: z.array(nonEmpty),
  comparableCount: finite,
  medianWeightKg: finite.optional(),
  medianReps: finite.optional(),
  completedUpperBoundCount: finite,
  discreteIncreaseCount: finite,
  currentE1rmKg: finite.optional(),
  medianPreviousE1rmKg: finite.optional(),
}).strict()

export const candidateChangeSchema = z.object({
  candidateId: nonEmpty,
  kind: z.enum(['maintain', 'increase-reps', 'increase-load', 'add-set', 'reduce-load', 'reduce-set']),
  rule: nonEmpty,
  exerciseId: nonEmpty,
  occurrenceId: nonEmpty.optional(),
  previous: z.object({ plannedSets: finite, repsMin: finite, repsMax: finite, loadKg: finite.optional() }).strict(),
  next: z.object({ plannedSets: finite, repsMin: finite, repsMax: finite, loadKg: finite.optional() }).strict(),
  evidence: evidenceSchema,
  confidence: z.enum(['low', 'medium', 'high']),
  warnings: z.array(z.string()),
  citations: z.array(nonEmpty).optional(),
  explanation: z.string(),
}).strict()

export const analysisSetSchema = z.object({
  type: z.enum(['normal', 'warmup', 'failure', 'drop']),
  weightKg: finite,
  reps: finite,
  completed: z.boolean(),
  rpe: finite.optional(),
  /** RIR registrado por el usuario; no se infiere desde RPE. */
  rir: z.number().int().min(0).max(10).optional(),
}).strict()

export const analysisFeedbackSchema = z.object({
  completed: z.boolean().optional(),
  generalPain: z.boolean().optional(),
  exercisePain: z.boolean().optional(),
  energy: z.number().int().min(1).max(5).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  contradictory: z.boolean().optional(),
}).strict()

const exposureShape = {
  workoutId: nonEmpty.max(120),
  startedAt: finite,
  exerciseId: nonEmpty.max(120),
  occurrenceId: nonEmpty.max(180).optional(),
  role: z.enum(['strength', 'hypertrophy', 'accessory']),
  repRangeMin: z.number().int().min(1).max(100),
  repRangeMax: z.number().int().min(1).max(100),
  targetRpeMin: finite.optional(),
  targetRpeMax: finite.optional(),
  loadIncrementKg: finite.positive().max(100),
  plannedSets: z.number().int().min(1).max(10),
  plannedRepsMin: z.number().int().min(1).max(100).optional(),
  plannedRepsMax: z.number().int().min(1).max(100).optional(),
  sets: z.array(analysisSetSchema).max(50),
  feedback: analysisFeedbackSchema.optional(),
}

function validateExposure(value: { repRangeMin: number; repRangeMax: number; plannedRepsMin?: number; plannedRepsMax?: number; targetRpeMin?: number; targetRpeMax?: number }, ctx: z.RefinementCtx): void {
  if (value.repRangeMax < value.repRangeMin) ctx.addIssue({ code: 'custom', path: ['repRangeMax'], message: 'El rango máximo debe ser mayor o igual al mínimo' })
  if (value.plannedRepsMin !== undefined && value.plannedRepsMax !== undefined && value.plannedRepsMax < value.plannedRepsMin) ctx.addIssue({ code: 'custom', path: ['plannedRepsMax'], message: 'La prescripción de repeticiones es inválida' })
  if (value.targetRpeMin !== undefined && value.targetRpeMax !== undefined && value.targetRpeMax < value.targetRpeMin) ctx.addIssue({ code: 'custom', path: ['targetRpeMax'], message: 'El rango RPE es inválido' })
}

/** Exposición compartida por el motor, la PWA y el Worker. No incluye historial. */
export const exposureSchema = z.object(exposureShape).strict().superRefine(validateExposure)

/** Entrada canónica: solo la exposición actual contiene `previousExposures`. */
export const exerciseAnalysisInputSchema = z.object({
  ...exposureShape,
  previousExposures: z.array(exposureSchema).max(6),
}).strict().superRefine(validateExposure)

export const analyzeRequestSchema = z.object({
  inputs: z.array(exerciseAnalysisInputSchema).min(1).max(50),
  requestedAt: finite.optional(),
  consentVersion: z.string().min(1).max(64).optional(),
  deviceId: nonEmpty.max(120).optional(),
}).strict()

export const exerciseDecisionSchema = z.object({
  exerciseId: nonEmpty,
  occurrenceId: nonEmpty.optional(),
  fallbackCandidateId: nonEmpty,
  selectedCandidateId: nonEmpty.optional(),
  candidates: z.array(candidateChangeSchema).min(1),
  comparableWorkoutIds: z.array(nonEmpty),
  warnings: z.array(z.string()),
}).strict()

export const analysisResponseSchema = z.object({
  analysisId: nonEmpty,
  policyVersion: nonEmpty,
  corpusVersion: nonEmpty.optional(),
  provider: z.enum(['deterministic', 'flash', 'pro']).optional(),
  pendingExplanation: z.boolean().optional(),
  idempotent: z.boolean().optional(),
  sources: z.array(sourceSchema).default([]),
  decisions: z.array(exerciseDecisionSchema).min(1),
}).strict()

const accountId = nonEmpty.max(160)
const eventId = nonEmpty.max(160)
const revision = z.number().int().nonnegative()
const tokenCount = z.number().int().nonnegative()

export const COACH_MAX_CONVERSATION_MESSAGES = 100
export const COACH_MAX_MESSAGE_CHARS = 4_000
export const COACH_MAX_CONVERSATION_CHARS = 36_000

/** Hecho de dominio que inicia una ejecución del coach. El payload no contiene instrucciones ejecutables. */
export const coachEventSchema = z.object({
  id: eventId,
  accountId,
  deviceId: nonEmpty.max(120),
  conversationId: nonEmpty.max(160).optional(),
  type: z.enum(['set-completed', 'session-prepared', 'session-finished', 'weight-logged', 'nutrition-logged', 'equipment-unavailable', 'message-sent']),
  occurredAt: finite,
  contextVersion: nonEmpty.max(160),
  causedByEventId: eventId.optional(),
  payload: z.record(z.string().max(120), z.unknown()).default({}),
}).strict().superRefine((value, ctx) => {
  const message = value.payload.message
  if (message === undefined) return
  if (typeof message !== 'string' || !message.trim()) {
    ctx.addIssue({ code: 'custom', path: ['payload', 'message'], message: 'El mensaje del coach no puede estar vacío' })
  } else if (message.length > COACH_MAX_MESSAGE_CHARS) {
    ctx.addIssue({ code: 'custom', path: ['payload', 'message'], message: `El mensaje del coach no puede superar ${COACH_MAX_MESSAGE_CHARS} caracteres` })
  }
})

export const agentRunSchema = z.object({
  id: eventId,
  eventId,
  accountId,
  contextVersion: nonEmpty.max(160),
  specialists: z.array(z.enum(['training', 'nutrition', 'technique', 'research', 'orchestrator'])).min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  startedAt: finite.optional(),
  endedAt: finite.optional(),
  usage: z.object({ inputTokens: tokenCount.optional(), outputTokens: tokenCount.optional() }).strict().optional(),
}).strict()

export const evidenceReferenceSchema = z.object({
  claim: nonEmpty.max(800),
  sourceId: nonEmpty.max(200),
  location: nonEmpty.max(500),
  excerpt: z.string().max(1600).optional(),
}).strict()

const operationBase = {
  operationId: nonEmpty.max(160),
  expectedRevision: revision,
}
const routinePatchSchema = z.object({
  plannedSets: z.number().int().min(1).max(50).optional(),
  repRangeMin: z.number().int().min(1).max(100).optional(),
  repRangeMax: z.number().int().min(1).max(100).optional(),
  loadKg: finite.nonnegative().optional(),
  exerciseId: nonEmpty.max(160).optional(),
}).strict()

/** Objetivo de una serie futura. Se conserva por serie para no perder orden ni calentamientos. */
export const plannedSetTargetSchema = z.object({
  type: z.enum(['normal', 'warmup', 'failure', 'drop']),
  weightKg: finite.nonnegative().optional(),
  reps: z.number().int().min(1).max(100).optional(),
  durationSec: z.number().int().positive().optional(),
  distanceM: z.number().nonnegative().optional(),
}).strict()

/** Ejercicio futuro completo, incluido su posición y sus objetivos por serie. */
export const plannedExerciseSchema = z.object({
  occurrenceId: nonEmpty.max(200),
  exerciseId: nonEmpty.max(160),
  order: z.number().int().nonnegative(),
  plannedSets: z.number().int().min(1).max(50),
  setTargets: z.array(plannedSetTargetSchema).max(50),
  repRangeMin: z.number().int().min(1).max(100).optional(),
  repRangeMax: z.number().int().min(1).max(100).optional(),
  targetRpeMin: finite.optional(),
  targetRpeMax: finite.optional(),
  notes: z.string().max(2000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.repRangeMin !== undefined && value.repRangeMax !== undefined && value.repRangeMax < value.repRangeMin) {
    ctx.addIssue({ code: 'custom', path: ['repRangeMax'], message: 'El rango futuro de repeticiones es inválido' })
  }
  if (value.setTargets.length > 0 && value.setTargets.length !== value.plannedSets) {
    ctx.addIssue({ code: 'custom', path: ['setTargets'], message: 'Los objetivos futuros deben cubrir todas las series' })
  }
})

/** Sesión futura completa; el orden es parte del contrato, no una sugerencia de UI. */
export const futureSessionSchema = z.object({
  sessionId: nonEmpty.max(160),
  name: nonEmpty.max(200),
  /** 0 means that the session is new; otherwise it is the revision read by the agent. */
  expectedRevision: revision.optional(),
  scheduledAt: finite.optional(),
  exercises: z.array(plannedExerciseSchema).max(100),
}).strict().superRefine((value, ctx) => {
  const orders = value.exercises.map((exercise) => exercise.order)
  if (new Set(orders).size !== orders.length) ctx.addIssue({ code: 'custom', path: ['exercises'], message: 'El orden de ejercicios futuro debe ser único' })
})

export const futurePlanningSchema = z.object({
  sessions: z.array(futureSessionSchema).min(1).max(30),
  horizon: z.enum(['next-session', 'microcycle', 'mesocycle']),
}).strict()

/** Operaciones autorizables; no hay una operación para editar un entrenamiento ya realizado. */
export const changeOperationSchema = z.discriminatedUnion('kind', [
  z.object({ ...operationBase, kind: z.literal('routine'), routineId: nonEmpty.max(160), occurrenceId: nonEmpty.max(200).optional(), patch: routinePatchSchema }),
  z.object({ ...operationBase, kind: z.literal('routine-create'), routineId: nonEmpty.max(160), name: nonEmpty.max(200), scheduledAt: finite.optional(), exercises: z.array(plannedExerciseSchema).min(1).max(100) }),
  z.object({ ...operationBase, kind: z.literal('routine-retire'), routineId: nonEmpty.max(160) }),
  z.object({ ...operationBase, kind: z.literal('nutrition-goals'), patch: z.object({ kcal: finite.nonnegative().optional(), proteinG: finite.nonnegative().optional(), carbsG: finite.nonnegative().optional(), fatG: finite.nonnegative().optional() }).strict() }),
  z.object({ ...operationBase, kind: z.literal('exercise-substitution'), routineId: nonEmpty.max(160), occurrenceId: nonEmpty.max(200), exerciseId: nonEmpty.max(160), reason: nonEmpty.max(800) }),
])

export const changeSetSchema = z.object({
  id: eventId,
  accountId,
  eventId,
  domain: z.enum(['training', 'nutrition']),
  expectedContextVersion: nonEmpty.max(160),
  explanation: nonEmpty.max(4000),
  observations: z.array(nonEmpty.max(1000)).max(40),
  evidence: z.array(evidenceReferenceSchema).max(40),
  operations: z.array(changeOperationSchema).min(1).max(40),
  futurePlan: futurePlanningSchema.optional(),
  createdAt: finite,
  policyVersion: nonEmpty.max(120),
}).strict()

const agentObservationSchema = z.object({
  text: nonEmpty.max(1000),
  kind: z.enum(['observation', 'estimate', 'limitation']),
  source: nonEmpty.max(120),
}).strict()

/** Decisión que la app presenta directamente; no se traduce a candidatos cerrados. */
export const agentDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('propose'),
    explanation: nonEmpty.max(4000),
    observations: z.array(agentObservationSchema).max(40),
    evidence: z.array(evidenceReferenceSchema).max(40),
    changeSet: changeSetSchema,
  }).strict(),
  z.object({
    kind: z.literal('maintain'),
    explanation: nonEmpty.max(4000),
    observations: z.array(agentObservationSchema).max(40),
    evidence: z.array(evidenceReferenceSchema).max(40),
  }).strict(),
  z.object({
    kind: z.literal('ask'),
    explanation: nonEmpty.max(4000),
    observations: z.array(agentObservationSchema).max(40),
    evidence: z.array(evidenceReferenceSchema).max(40),
    questions: z.array(nonEmpty.max(800)).min(1).max(5),
  }).strict(),
  z.object({
    kind: z.literal('abstain'),
    explanation: nonEmpty.max(4000),
    observations: z.array(agentObservationSchema).max(40),
    evidence: z.array(evidenceReferenceSchema).max(40),
    reason: nonEmpty.max(1000),
  }).strict(),
  z.object({
    kind: z.literal('unavailable'),
    explanation: nonEmpty.max(4000),
    observations: z.array(agentObservationSchema).max(40),
    evidence: z.array(evidenceReferenceSchema).max(40),
    reason: nonEmpty.max(1000),
  }).strict(),
])

const coachProfileSchema = z.object({
  population: z.array(nonEmpty.max(120)).max(20).default([]),
  populationConfirmed: z.boolean().default(false),
  experience: z.enum(['novice', 'intermediate', 'advanced']).optional(),
  goals: z.array(nonEmpty.max(400)).max(20).default([]),
}).strict()

const coachRestrictionsSchema = z.object({
  injuriesOrPain: z.array(nonEmpty.max(400)).max(40).default([]),
  unavailableEquipment: z.array(nonEmpty.max(200)).max(80).default([]),
  excludedExercises: z.array(nonEmpty.max(160)).max(80).default([]),
  nutritionConstraints: z.array(nonEmpty.max(400)).max(40).default([]),
}).strict()

const coachCatalogExerciseSchema = z.object({
  id: nonEmpty.max(160),
  name: nonEmpty.max(240),
  equipment: z.array(nonEmpty.max(120)).max(30).default([]),
  muscles: z.array(nonEmpty.max(120)).max(30).default([]),
}).strict()

const coachConversationMessageSchema = z.object({
  id: nonEmpty.max(160),
  role: z.enum(['user', 'assistant']),
  content: nonEmpty.max(4000),
  runId: nonEmpty.max(160).optional(),
  createdAt: finite,
  contextVersion: nonEmpty.max(160),
}).strict()

const coachHistoryWorkoutSchema = z.object({
  id: nonEmpty.max(160),
  startedAt: finite,
  endedAt: finite,
  name: z.string().max(240),
  exercises: z.array(z.unknown()).max(200),
}).strict()

const coachMetricsSchema = z.object({
  captured: z.boolean().default(false),
  workoutCount: z.number().int().nonnegative().optional(),
  totalVolumeKg: finite.optional(),
  bestE1rmByExercise: z.record(z.string(), finite).default({}),
}).strict()

/** Datos reales o ausencia explícita; nunca se interpreta texto del modelo como contexto. */
export const coachContextSnapshotSchema = z.object({
  message: z.string().max(4000).optional(),
  profileRevision: revision.default(0),
  consentVersion: nonEmpty.max(80).default('coach-context-v3-gemini-nvidia'),
  consentRevision: revision.default(0),
  profile: coachProfileSchema.default({ population: [], populationConfirmed: false, goals: [] }),
  goals: z.array(nonEmpty.max(400)).max(20).default([]),
  restrictions: z.union([coachRestrictionsSchema, z.array(z.string())]).default({ injuriesOrPain: [], unavailableEquipment: [], excludedExercises: [], nutritionConstraints: [] }),
  catalog: z.array(coachCatalogExerciseSchema).max(5000).default([]),
  metrics: coachMetricsSchema.default({ captured: false, bestE1rmByExercise: {} }),
  plan: z.array(futureSessionSchema).max(30).default([]),
  history: z.array(coachHistoryWorkoutSchema).max(6).default([]),
  conversation: z.array(coachConversationMessageSchema).max(COACH_MAX_CONVERSATION_MESSAGES).default([]),
  conversationVersion: nonEmpty.max(160).default('coach-conversation-empty'),
}).strict()

/** Snapshot consentido que viaja al Worker. El Worker nunca interpreta texto como instrucciones. */
export const coachRunRequestSchema = z.object({
  event: coachEventSchema,
  context: z.object({
    version: nonEmpty.max(160),
    capturedAt: finite,
    timezone: nonEmpty.max(80),
    isCurrent: z.boolean(),
    conversationVersion: nonEmpty.max(160).default('coach-conversation-empty'),
    snapshot: coachContextSnapshotSchema.default({ profileRevision: 0, consentVersion: 'coach-context-v3-gemini-nvidia', consentRevision: 0, profile: { population: [], populationConfirmed: false, goals: [] }, goals: [], restrictions: { injuriesOrPain: [], unavailableEquipment: [], excludedExercises: [], nutritionConstraints: [] }, catalog: [], metrics: { captured: false, bestE1rmByExercise: {} }, plan: [], history: [], conversation: [], conversationVersion: 'coach-conversation-empty' }),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const conversation = value.context.snapshot.conversation
  const totalChars = conversation.reduce((total, message) => total + message.content.length, 0)
  if (totalChars > COACH_MAX_CONVERSATION_CHARS) {
    ctx.addIssue({ code: 'custom', path: ['context', 'snapshot', 'conversation'], message: `El historial del coach no puede superar ${COACH_MAX_CONVERSATION_CHARS} caracteres` })
  }
})

export const coachRunResponseSchema = z.object({
  run: agentRunSchema,
  decision: agentDecisionSchema.optional(),
  error: nonEmpty.max(1000).optional(),
  workflowStatus: z.string().max(80).optional(),
  appliedAt: finite.optional(),
}).strict()

/** Snapshot durable del texto parcial; nunca es una propuesta aplicable por sí mismo. */
export const coachRunSnapshotSchema = z.object({
  runId: eventId,
  sequence: z.number().int().positive(),
  text: z.string().max(32_000),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  decision: agentDecisionSchema.optional(),
  error: nonEmpty.max(1000).optional(),
  createdAt: finite,
}).strict()
export const coachRunSnapshotEventSchema = z.object({ type: z.literal('snapshot'), snapshot: coachRunSnapshotSchema }).strict()

export const autonomyPolicySchema = z.object({
  accountId,
  version: nonEmpty.max(120),
  training: z.enum(['propose', 'auto']),
  nutrition: z.enum(['propose', 'auto']),
  updatedAt: finite,
}).strict()

export const memoryFactSchema = z.object({
  id: eventId,
  accountId,
  fact: nonEmpty.max(2000),
  provenanceEventIds: z.array(eventId).min(1).max(40),
  state: z.enum(['confirmed', 'inferred']),
  editable: z.boolean(),
  updatedAt: finite,
}).strict()

export type AnalysisSource = z.infer<typeof sourceSchema>
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>
export type CoachEvent = z.infer<typeof coachEventSchema>
export type AgentRun = z.infer<typeof agentRunSchema>
export type AgentDecision = z.infer<typeof agentDecisionSchema>
/** Input type keeps backwards-compatible callers that omit fields filled by Zod defaults. */
export type CoachRunRequest = z.input<typeof coachRunRequestSchema>
export type ParsedCoachRunRequest = z.output<typeof coachRunRequestSchema>
export type CoachRunResponse = z.infer<typeof coachRunResponseSchema>
export type CoachRunSnapshot = z.infer<typeof coachRunSnapshotSchema>
export type CoachRunSnapshotEvent = z.infer<typeof coachRunSnapshotEventSchema>
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>
export type ChangeOperation = z.infer<typeof changeOperationSchema>
export type ChangeSet = z.infer<typeof changeSetSchema>
export type PlannedSetTarget = z.infer<typeof plannedSetTargetSchema>
export type PlannedExercise = z.infer<typeof plannedExerciseSchema>
export type FutureSession = z.infer<typeof futureSessionSchema>
export type FuturePlanning = z.infer<typeof futurePlanningSchema>
export type AutonomyPolicy = z.infer<typeof autonomyPolicySchema>
export type MemoryFact = z.infer<typeof memoryFactSchema>

export function parseAnalysisResponse(value: unknown): AnalysisResponse {
  return analysisResponseSchema.parse(value)
}
