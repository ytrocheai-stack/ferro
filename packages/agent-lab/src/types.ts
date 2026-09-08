import type {
  ChangeSet,
  CoachEvent,
  EvidenceReference,
  PlannedExercise,
} from '../../adaptation-core/src/contract.ts'

export const LAB_VERSION = 'agent-lab-v3' as const
export const INSTRUCTION_VERSION = 'instructions-v2' as const
export const TOOL_VERSION = 'tools-v2' as const
export const MODEL_CONFIG_VERSION = 'model-config-v2' as const

export type LabDecisionKind = 'propose' | 'maintain' | 'ask' | 'abstain' | 'unavailable'
export type AgentName = 'training' | 'nutrition' | 'technique' | 'research' | 'orchestrator'
export type ExecutionMode = 'simulated' | 'provider'

export interface FictionalProfile {
  id: string
  age: number
  experience: 'novice' | 'intermediate' | 'advanced'
  goals: string[]
  preferences: string[]
}

export interface FictionalWorkoutSet {
  type: 'normal' | 'warmup' | 'failure' | 'drop'
  weightKg: number
  reps: number
  completed: boolean
  rir?: number
  rpe?: number
}

export interface FictionalWorkoutExercise {
  occurrenceId: string
  exerciseId: string
  order: number
  role: 'strength' | 'hypertrophy' | 'accessory'
  plannedSets: number
  repRangeMin: number
  repRangeMax: number
  targetRpeMin?: number
  targetRpeMax?: number
  loadIncrementKg: number
  sets: FictionalWorkoutSet[]
}

export interface FictionalWorkout {
  id: string
  startedAt: number
  endedAt?: number
  name: string
  exercises: FictionalWorkoutExercise[]
  feedback?: {
    completed?: boolean
    generalPain?: boolean
    exercisePain?: string[]
    energy?: number
    difficulty?: number
    contradictory?: boolean
  }
}

export interface FictionalHistory {
  workouts: FictionalWorkout[]
}

export interface CatalogExercise {
  id: string
  name: string
  equipment: string[]
  muscles: string[]
  alternatives: string[]
}

export interface FictionalPlan {
  sessions: Array<{
    sessionId: string
    name: string
    scheduledAt?: number
    exercises: PlannedExercise[]
  }>
}

export interface UserRestrictions {
  injuriesOrPain: string[]
  unavailableEquipment: string[]
  excludedExercises: string[]
  nutritionConstraints: string[]
}

export interface SimulatedPermissions {
  accountId: string
  consentVersion: string
  canReadHistory: boolean
  canReadGoals: boolean
  canReadCatalog: boolean
  canPropose: boolean
  canApply: boolean
}

export interface VersionedContext {
  version: string
  capturedAt: number
  timezone: string
  isCurrent: boolean
}

export interface LabCorpusSource {
  id: string
  author: string
  title: string
  url: string
  license: string
  publishedAt?: string
  location?: string
  approved: boolean
}

export interface LabCorpusChunk {
  id: string
  sourceId: string
  text: string
  location: string
  section?: string
  textHash?: string
  retrievalClass?: 'evidence' | 'administrative' | 'ambiguous-table'
  collection?: string
  population?: string[]
  populationReviewed?: boolean
}

export interface LabCorpus {
  version: string
  status: 'proposal' | 'approved'
  sources: LabCorpusSource[]
  chunks: LabCorpusChunk[]
}

export interface LabInput {
  event: CoachEvent
  context: VersionedContext
  profile: FictionalProfile
  history: FictionalHistory
  plan: FictionalPlan
  restrictions: UserRestrictions
  permissions: SimulatedPermissions
  catalog: CatalogExercise[]
}

export interface LabObservation {
  text: string
  kind: 'observation' | 'estimate' | 'limitation'
  source: string
}

export interface LabEvidence extends EvidenceReference {
  chunkId?: string
  relevance: number
}

export interface ScenarioExpectation {
  decision: LabDecisionKind
  requiredAgents?: AgentName[]
  forbiddenOperationKinds?: string[]
  minimumEvidence?: number
  reason?: string
}

export interface LabScenario {
  id: string
  caseNumber: number
  title: string
  set: 'development' | 'acceptance' | 'rag' | 'safety'
  variant: 'satisfactory' | 'adverse' | 'query' | 'no-answer'
  description: string
  input: LabInput
  expectation: ScenarioExpectation
  continuation?: Partial<LabInput>
  continuationExpectation?: ScenarioExpectation
  repeatEvent?: boolean
}

export interface AgentTrace {
  agent: AgentName
  status: 'completed' | 'skipped' | 'blocked'
  observations: LabObservation[]
  evidence: LabEvidence[]
  durationMs: number
}

export interface LabDecisionBase {
  kind: LabDecisionKind
  explanation: string
  observations: LabObservation[]
  evidence: LabEvidence[]
  trace: AgentTrace[]
  executionMode: ExecutionMode
  qualityEvidence: false
}

export interface ProposeDecision extends LabDecisionBase {
  kind: 'propose'
  changeSet: ChangeSet
}

export interface MaintainDecision extends LabDecisionBase {
  kind: 'maintain'
}

export interface AskDecision extends LabDecisionBase {
  kind: 'ask'
  questions: string[]
  continuation?: string
}

export interface AbstainDecision extends LabDecisionBase {
  kind: 'abstain'
  reason: string
}

export interface UnavailableDecision extends LabDecisionBase {
  kind: 'unavailable'
  reason: string
}

export type LabDecision = ProposeDecision | MaintainDecision | AskDecision | AbstainDecision | UnavailableDecision

export interface ModelBudget {
  provider: 'flash'
  maxCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  timeoutMs: number
}

export interface LabConfig {
  labVersion?: string
  instructionVersion?: string
  toolVersion?: string
  modelConfigVersion?: string
  mode?: ExecutionMode
  providerAvailable?: boolean
  budgetVerified?: boolean
  budget?: Partial<ModelBudget>
}

export interface LabRun {
  scenarioId: string
  repetition?: number
  labVersion: string
  instructionVersion: string
  toolVersion: string
  modelConfigVersion: string
  decision: LabDecision
  calls: number
  uncertainCalls?: number
  usage?: { inputTokens: number; outputTokens: number }
  fingerprint?: string
  providerId?: string
  providerKind?: 'stub' | 'remote'
  tokenEstimate: { input: number; output: number }
}

export interface LabCheckpoint {
  schema: 'agent-lab-checkpoint-v2'
  fingerprint: string
  labVersion: string
  scenarioIds: string[]
  completedScenarioIds: string[]
  runs: LabRun[]
  uncertainCalls: number
  updatedAt: string
}
