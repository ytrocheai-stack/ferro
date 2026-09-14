import type { AgentDecision, CoachRunRequest } from '../../packages/adaptation-core/src/contract'

export type SetType = 'normal' | 'warmup' | 'failure' | 'drop'
export type TrainingRole = 'strength' | 'hypertrophy' | 'accessory'

export interface LoggedSet {
  type: SetType
  weightKg: number
  reps: number
  completed: boolean
  /** RPE 6–10 (medios permitidos); solo si el usuario activa el registro */
  rpe?: number
  /** Repeticiones en reserva registradas explícitamente (0 = fallo). */
  rir?: number
  /** cardio: duración en segundos */
  durationSec?: number
  /** cardio: distancia en metros */
  distanceM?: number
}

export interface WorkoutExercise {
  /** Identidad estable de esta ocurrencia, incluso si el ejercicio se repite. */
  occurrenceId?: string
  exerciseId: string
  notes?: string
  restSec: number
  sets: LoggedSet[]
  /** Snapshot inmutable de lo prescrito al iniciar el entrenamiento. */
  prescription?: WorkoutPrescription
  /** Series ejecutadas; `sets` se conserva como alias de lectura para backups antiguos. */
  executedSets?: LoggedSet[]
  /** ejercicios con el mismo número forman una superserie */
  supersetGroup?: number
  role?: TrainingRole
  trainingRole?: TrainingRole
  repRangeMin?: number
  repRangeMax?: number
  targetRpeMin?: number
  targetRpeMax?: number
  loadIncrementKg?: number
  plannedSets?: number
  plannedSetTypes?: SetType[]
}

export type PRKind = 'weight' | 'e1rm' | 'setVolume'

export interface PR {
  exerciseId: string
  kind: PRKind
  value: number
  prev?: number
}

export interface Workout {
  id: string
  name: string
  startedAt: number
  endedAt: number
  exercises: WorkoutExercise[]
  volumeKg: number
  totalSets: number
  prs: PR[]
  notes?: string
  routineId?: string
  routineRevision?: number
  postWorkoutFeedback?: PostWorkoutFeedback
}

export interface PostWorkoutFeedback {
  completed?: boolean
  generalPain?: boolean
  exercisePain?: string[]
  energy?: number
  difficulty?: number
  contradictory?: boolean
}

export interface RoutineExercise {
  /** Identidad estable por ocurrencia; permite repetir el mismo ejercicio. */
  occurrenceId?: string
  exerciseId: string
  plannedSets: number
  /** Objetivo detallado por serie cuando la fuente lo proporciona (p. ej. Hevy). */
  setTargets?: PlannedSet[]
  restSec: number
  notes?: string
  supersetGroup?: number
  /** rango de reps objetivo para doble progresión (default 8–12) */
  repRangeMin?: number
  repRangeMax?: number
  trainingRole?: TrainingRole
  /** @deprecated solo para leer rutinas v4; se normaliza a trainingRole. */
  role?: TrainingRole
  targetRpeMin?: number
  targetRpeMax?: number
  loadIncrementKg?: number
}

export interface PlannedSet {
  type: SetType
  weightKg?: number
  reps?: number
  durationSec?: number
  distanceM?: number
}

export interface WorkoutPrescription {
  occurrenceId?: string
  plannedSets: number
  setTargets?: PlannedSet[]
  restSec: number
  supersetGroup?: number
  repRangeMin?: number
  repRangeMax?: number
  trainingRole?: TrainingRole
  targetRpeMin?: number
  targetRpeMax?: number
  loadIncrementKg?: number
}

export interface Routine {
  id: string
  name: string
  sortOrder: number
  exercises: RoutineExercise[]
  createdAt: number
  folderId?: string
  revision: number
  trainingRole: TrainingRole
  loadIncrementKg: number
  coachReviewed: boolean
  scheduledAt?: number
  retiredAt?: number
}

export type ProposalStatus = 'pending' | 'accepted' | 'edited' | 'rejected' | 'reverted' | 'stale'

export interface RoutineRevisionSnapshot {
  id: string
  routineId: string
  revision: number
  createdAt: number
  analysisId?: string
  routine: Routine
}

export interface AdaptationCandidateRecord {
  candidateId: string
  kind: 'maintain' | 'increase-reps' | 'increase-load' | 'add-set' | 'reduce-load' | 'reduce-set'
  rule: string
  exerciseId: string
  occurrenceId?: string
  previous: { plannedSets: number; repsMin: number; repsMax: number; loadKg?: number }
  next: { plannedSets: number; repsMin: number; repsMax: number; loadKg?: number }
  evidence: {
    comparableWorkoutIds: string[]
    comparableCount: number
    medianWeightKg?: number
    medianReps?: number
    completedUpperBoundCount: number
    discreteIncreaseCount: number
    currentE1rmKg?: number
    medianPreviousE1rmKg?: number
  }
  confidence: 'low' | 'medium' | 'high'
  warnings: string[]
  citations?: string[]
  explanation: string
}

export interface AdaptationProposal {
  id: string
  /** Propietario Clerk; evita mostrar o aplicar propuestas de otra cuenta local. */
  ownerId?: string
  workoutId?: string
  requestId?: string
  contextKey?: string
  analysisId: string
  baseRoutineId: string
  baseRoutineRevision: number
  exerciseId: string
  status: ProposalStatus
  createdAt: number
  candidateId: string
  candidate: AdaptationCandidateRecord
  candidateOptions: AdaptationCandidateRecord[]
  proposalRevision: number
  policyVersion?: string
  corpusVersion?: string
  previousValues?: AdaptationCandidateRecord['previous']
  proposedValues?: AdaptationCandidateRecord['next']
  rule?: string
  confidence?: AdaptationCandidateRecord['confidence']
  citations?: string[]
  warnings?: string[]
  selectedModel?: 'deterministic' | 'flash' | 'pro'
  occurrenceId?: string
  supersedesProposalId?: string
  appliedRoutineRevision?: number
  routineSnapshotId?: string
  sources?: import('../../packages/adaptation-core/src/contract').AnalysisSource[]
}

export type AdaptationJobErrorCode = 'session-expired' | 'unauthorized' | 'quota-exhausted' | 'temporary' | 'invalid-response' | 'conflict' | 'context-invalidated'

export interface FrozenAdaptationRequest {
  inputs: import('../../packages/adaptation-core/src/index').ExerciseAnalysisInput[]
  consentVersion: string
  deviceId: string
}

export interface AdaptationJob {
  id: string
  /** Propietario Clerk. Los jobs heredados sin propietario no se procesan. */
  ownerId?: string
  workoutId: string
  requestId?: string
  contextKey?: string
  runId?: string
  leaseExpiresAt?: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  createdAt: number
  nextRetryAt?: number
  attempts?: number
  analysisId?: string
  lastError?: string
  updatedAt?: number
  payload?: FrozenAdaptationRequest
  errorCode?: AdaptationJobErrorCode
  pendingExplanation?: boolean
}

export interface AdaptationEventJob {
  id: string
  ownerId?: string
  analysisId: string
  exerciseId: string
  candidateId?: string
  event: 'accepted' | 'rejected' | 'edited' | 'reverted'
  status: 'pending' | 'sent' | 'failed'
  createdAt: number
  attempts: number
  nextRetryAt?: number
}

export interface CoachRunRecord {
  /** Identidad local estable; nunca se sustituye al adoptar una respuesta. */
  id: string
  remoteRunId?: string
  /** Lease local de transporte compartido entre pestañas; no se envía al Worker. */
  dispatchToken?: string
  dispatchLeaseExpiresAt?: number
  ownerId: string
  eventId: string
  contextVersion: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  request: CoachRunRequest
  decision?: AgentDecision
  error?: string
  /** Solicitud de cancelación durable; se conserva hasta conocer el estado remoto. */
  cancelRequestedAt?: number
  /** Diagnóstico de transporte conservado junto a una cancelación pendiente. */
  lastError?: string
  usage?: { inputTokens?: number; outputTokens?: number }
  createdAt: number
  updatedAt: number
  startedAt?: number
  endedAt?: number
  appliedAt?: number
}

export interface CoachMessage {
  id: string
  ownerId: string
  runId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  contextVersion: string
}

export interface CoachProfile {
  id: string
  ownerId: string
  population: string[]
  populationConfirmed: boolean
  experience?: 'novice' | 'intermediate' | 'advanced'
  goals: string[]
  injuriesOrPain: string[]
  unavailableEquipment: string[]
  excludedExercises: string[]
  nutritionConstraints: string[]
  revision: number
  updatedAt: number
}

export interface CoachConsentRecord {
  id: string
  ownerId: string
  deviceId: string
  version: string
  enabled: boolean
  revision: number
  acceptedAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  name: string
  sortOrder: number
}

export interface CustomExercise {
  id: string // 'custom-…'
  name: string
  bodyPart: string
  equipment: string
  target: string
  secondaryMuscles: string[]
  createdAt: number
}

// ── Medidas corporales ────────────────────────────────────────────────

export type MeasurementKind =
  | 'weight'
  | 'bodyfat'
  | 'neck'
  | 'shoulders'
  | 'chest'
  | 'arm_l'
  | 'arm_r'
  | 'forearm_l'
  | 'forearm_r'
  | 'waist'
  | 'hips'
  | 'thigh_l'
  | 'thigh_r'
  | 'calf_l'
  | 'calf_r'

/** value: kg para weight, % para bodyfat, cm para el resto */
export interface Measurement {
  id: string
  date: number
  kind: MeasurementKind
  value: number
}

export interface ProgressPhoto {
  id: string
  date: number
  blob: Blob
  note?: string
}

// ── Nutrición ─────────────────────────────────────────────────────────

/** Alimento guardado en Dexie: propio del usuario, cacheado de Open Food Facts, o un
 *  alimento base "materializado" al marcarlo como favorito. (Los ~250 alimentos base
 *  viven en un JSON estático; solo entran en Dexie si el usuario los marca favoritos.) */
export interface Food {
  id: string
  name: string
  brand?: string
  source: 'custom' | 'off' | 'seed' | 'usda'
  /** código de barras (productos OFF) */
  offCode?: string
  /** identificador FoodData Central para alimentos USDA */
  usdaFdcId?: number
  /** alias de búsqueda verificados, sin sustituir el nombre oficial */
  aliases?: string[]
  kcal100: number
  p100: number
  c100: number
  f100: number
  /** gramos de la porción típica */
  servingG?: number
  favorite?: boolean
  /** última vez usado, para "recientes" */
  usedAt?: number
}

export type ImportSource = 'hevy-csv' | 'hevy-api'
export type ImportEntity = 'workout' | 'routine' | 'folder' | 'measurement' | 'exercise'

export interface ImportBatch {
  id: string
  source: ImportSource
  createdAt: number
  status: 'completed' | 'undone'
  counts: Partial<Record<ImportEntity, number>>
}

export interface ExternalRef {
  key: string
  source: ImportSource
  entity: ImportEntity
  externalId: string
  localId: string
  batchId: string
}

export interface DishItem {
  foodId: string
  name: string
  grams: number
  kcal: number
  p: number
  c: number
  f: number
}

/** Plato: combinación de alimentos con nombre (macros denormalizados) */
export interface Dish {
  id: string
  name: string
  items: DishItem[]
  createdAt: number
}

export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/** Entrada del diario. Macros ya calculados (robusto a borrar el alimento origen). */
export interface FoodLogEntry {
  id: string
  /** 'YYYY-MM-DD' local */
  date: string
  meal: MealKey
  foodId?: string
  name: string
  grams: number
  kcal: number
  p: number
  c: number
  f: number
}
