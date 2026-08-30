export const ADAPTATION_POLICY_VERSION = 'v1' as const

/** Epley es una señal informativa; la política v1 nunca decide únicamente por e1RM. */
export function epley1RM(weightKg: number, reps: number): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps) || weightKg <= 0 || reps <= 0) return 0
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30)
}

export type TrainingRole = 'strength' | 'hypertrophy' | 'accessory'
export type CandidateKind = 'maintain' | 'increase-reps' | 'increase-load' | 'add-set' | 'reduce-load' | 'reduce-set'
export type Confidence = 'low' | 'medium' | 'high'
export type SetType = 'normal' | 'warmup' | 'failure' | 'drop'

export interface AdaptationSet {
  type: SetType
  weightKg: number
  reps: number
  completed: boolean
  rpe?: number
}

export interface AdaptationFeedback {
  completed?: boolean
  generalPain?: boolean
  exercisePain?: boolean
  energy?: number
  difficulty?: number
  contradictory?: boolean
}

export interface Exposure {
  workoutId: string
  startedAt: number
  exerciseId: string
  occurrenceId?: string
  role: TrainingRole
  repRangeMin: number
  repRangeMax: number
  targetRpeMin?: number
  targetRpeMax?: number
  loadIncrementKg: number
  plannedSets: number
  plannedRepsMin?: number
  plannedRepsMax?: number
  sets: AdaptationSet[]
  feedback?: AdaptationFeedback
}

export interface ExerciseAnalysisInput extends Exposure {
  previousExposures: Exposure[]
}

export interface Evidence {
  comparableWorkoutIds: string[]
  comparableCount: number
  medianWeightKg?: number
  medianReps?: number
  completedUpperBoundCount: number
  discreteIncreaseCount: number
  currentE1rmKg?: number
  medianPreviousE1rmKg?: number
}

export interface CandidateChange {
  candidateId: string
  kind: CandidateKind
  rule: `${typeof ADAPTATION_POLICY_VERSION}:${string}`
  exerciseId: string
  previous: {
    plannedSets: number
    repsMin: number
    repsMax: number
    loadKg?: number
  }
  next: {
    plannedSets: number
    repsMin: number
    repsMax: number
    loadKg?: number
  }
  evidence: Evidence
  confidence: Confidence
  warnings: string[]
  citations?: string[]
  explanation: string
}

export interface ExerciseDecision {
  exerciseId: string
  occurrenceId?: string
  fallbackCandidateId: string
  selectedCandidateId?: string
  candidates: CandidateChange[]
  comparableWorkoutIds: string[]
  warnings: string[]
}

export interface AdaptationAnalysis {
  policyVersion: typeof ADAPTATION_POLICY_VERSION
  decisions: ExerciseDecision[]
}

const MAX_COMPARABLES = 3

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function workingSets(exposure: Exposure): AdaptationSet[] {
  return exposure.sets.filter((set) => set.type !== 'warmup')
}

function bestE1rm(exposure: Exposure): number | undefined {
  const values = workingSets(exposure).map((set) => epley1RM(set.weightKg, set.reps)).filter((value) => value > 0)
  return values.length ? Math.max(...values) : undefined
}

function typeSignature(exposure: Exposure): string {
  return workingSets(exposure).map((set) => set.type).join(',')
}

function rpeOverlaps(a: Exposure, b: Exposure): boolean {
  const aHas = finite(a.targetRpeMin) && finite(a.targetRpeMax)
  const bHas = finite(b.targetRpeMin) && finite(b.targetRpeMax)
  if (!aHas && !bHas) return true
  if (!aHas || !bHas) return false
  return a.targetRpeMin! <= b.targetRpeMax! && b.targetRpeMin! <= a.targetRpeMax!
}

export function isComparable(current: Exposure, candidate: Exposure): boolean {
  return (
    candidate.workoutId !== current.workoutId &&
    candidate.exerciseId === current.exerciseId &&
    ((current.occurrenceId === undefined && candidate.occurrenceId === undefined) || candidate.occurrenceId === current.occurrenceId) &&
    candidate.role === current.role &&
    candidate.repRangeMin === current.repRangeMin &&
    candidate.repRangeMax === current.repRangeMax &&
    rpeOverlaps(current, candidate) &&
    typeSignature(current) === typeSignature(candidate) &&
    workingSets(candidate).length > 0
  )
}

export function selectComparables(input: ExerciseAnalysisInput): Exposure[] {
  return [input, ...input.previousExposures]
    .slice(1)
    .filter((exposure) => isComparable(input, exposure))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 6)
    .slice(0, MAX_COMPARABLES + 3)
}

function allSetsAtUpper(exposure: Exposure): boolean {
  const sets = workingSets(exposure)
  const target = exposure.plannedRepsMax ?? exposure.repRangeMax
  return exposure.feedback?.completed !== false && sets.length >= exposure.plannedSets && sets.every((set) => set.completed && set.reps >= target)
}

function completedPrescription(exposure: Exposure): boolean {
  const sets = workingSets(exposure)
  const min = exposure.plannedRepsMin ?? exposure.repRangeMin
  return exposure.feedback?.completed !== false && sets.length >= exposure.plannedSets && sets.every((set) => set.completed && set.reps >= min)
}

function validRpe(exposure: Exposure): boolean {
  const sets = workingSets(exposure)
  const min = exposure.targetRpeMin
  const max = exposure.targetRpeMax
  return sets.length > 0 && sets.every((set) => finite(set.rpe) && (min === undefined || set.rpe! >= min) && (max === undefined || set.rpe! <= max))
}

function hasRpeTarget(exposure: Exposure): boolean {
  return finite(exposure.targetRpeMin) && finite(exposure.targetRpeMax) && exposure.targetRpeMin! <= exposure.targetRpeMax!
}

function validInput(input: ExerciseAnalysisInput): string[] {
  const warnings: string[] = []
  if (!Number.isInteger(input.repRangeMin) || !Number.isInteger(input.repRangeMax) || input.repRangeMin < 1 || input.repRangeMax < input.repRangeMin) warnings.push('rango de repeticiones inválido')
  if (!Number.isFinite(input.loadIncrementKg) || input.loadIncrementKg <= 0) warnings.push('incremento de carga inválido')
  if (!Number.isInteger(input.plannedSets) || input.plannedSets < 1) warnings.push('número de series inválido')
  if (input.startedAt <= 0 || !Number.isFinite(input.startedAt)) warnings.push('fecha inválida')
  if (workingSets(input).some((set) => set.weightKg < 0 || set.reps < 0 || !Number.isFinite(set.weightKg) || !Number.isFinite(set.reps))) warnings.push('rendimiento inválido')
  if (input.plannedRepsMin !== undefined && input.plannedRepsMax !== undefined && input.plannedRepsMax < input.plannedRepsMin) warnings.push('prescripción inválida')
  return warnings
}

function completeFeedback(exposure: Exposure): boolean {
  const feedback = exposure.feedback
  return !!feedback && feedback.completed !== undefined && feedback.energy !== undefined && feedback.difficulty !== undefined
}

function feedbackBlocks(exposure: Exposure): string[] {
  const feedback = exposure.feedback
  const warnings: string[] = []
  if (feedback?.completed === false) warnings.push('sesión incompleta')
  if (feedback?.generalPain) warnings.push('dolor general')
  if (feedback?.exercisePain) warnings.push('dolor del ejercicio')
  if (feedback?.energy !== undefined && feedback.energy <= 2) warnings.push('energía baja')
  if (feedback?.difficulty === 5) warnings.push('dificultad máxima')
  if (feedback?.contradictory) warnings.push('feedback contradictorio')
  return warnings
}

function isDrop(current: Exposure, previous: Exposure[]): boolean {
  const comparable = previous.slice(0, 1)
  if (comparable.length < 1) return false
  const currentSets = workingSets(current)
  const currentWeight = median(currentSets.map((set) => set.weightKg)) ?? 0
  const currentReps = median(currentSets.map((set) => set.reps)) ?? 0
  const previousWeight = median(workingSets(comparable[0]).map((set) => set.weightKg)) ?? 0
  const previousReps = median(workingSets(comparable[0]).map((set) => set.reps)) ?? 0
  return (previousWeight > 0 && currentWeight <= previousWeight * 0.95 && currentReps >= previousReps) ||
    (previousReps > 0 && currentReps <= previousReps * 0.95 && currentWeight >= previousWeight * 0.95)
}

function repeatedDrop(current: Exposure, comparable: Exposure[]): boolean {
  if (comparable.length < 2 || !isDrop(current, comparable)) return false
  return isDrop(comparable[0], comparable.slice(1))
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function buildCandidate(input: ExerciseAnalysisInput, kind: CandidateKind, next: CandidateChange['next'], evidence: Evidence, confidence: Confidence, warnings: string[], explanation: string, rule: string): CandidateChange {
  const previous = {
    plannedSets: input.plannedSets,
    repsMin: input.plannedRepsMin ?? input.repRangeMin,
    repsMax: input.plannedRepsMax ?? input.repRangeMax,
    ...(median(workingSets(input).map((set) => set.weightKg)) === undefined ? {} : { loadKg: median(workingSets(input).map((set) => set.weightKg)) }),
  }
  const identity = { policy: ADAPTATION_POLICY_VERSION, exerciseId: input.exerciseId, occurrenceId: input.occurrenceId, kind, previous, next, rule }
  return {
    candidateId: `${ADAPTATION_POLICY_VERSION}-${fnv1a64(canonicalJson(identity))}`,
    kind,
    rule: `${ADAPTATION_POLICY_VERSION}:${rule}`,
    exerciseId: input.exerciseId,
    previous,
    next,
    evidence,
    confidence,
    warnings: [...warnings],
    citations: [],
    explanation,
  }
}

export function analyzeExercise(input: ExerciseAnalysisInput): ExerciseDecision {
  const availableComparables = selectComparables(input)
  const comparable = availableComparables.slice(0, MAX_COMPARABLES)
  const all = [input, ...comparable]
  const blockers = [...new Set([...validInput(input), ...all.flatMap(feedbackBlocks)])]
  const currentSets = workingSets(input)
  const currentWeight = median(currentSets.map((set) => set.weightKg))
  const currentReps = median(currentSets.map((set) => set.reps))
  const upperCount = comparable.filter(allSetsAtUpper).length
  const sequence = [input, ...comparable]
  const discreteCount = sequence.slice(0, -1).reduce((count, exposure, index) => {
    const next = sequence[index + 1]
    const weight = median(workingSets(exposure).map((set) => set.weightKg)) ?? 0
    const nextWeight = median(workingSets(next).map((set) => set.weightKg)) ?? 0
    const reps = median(workingSets(exposure).map((set) => set.reps)) ?? 0
    const nextReps = median(workingSets(next).map((set) => set.reps)) ?? 0
    return count + ((weight >= nextWeight + input.loadIncrementKg || reps > nextReps) ? 1 : 0)
  }, 0)
  const evidence: Evidence = {
    comparableWorkoutIds: comparable.map((exposure) => exposure.workoutId),
    comparableCount: comparable.length,
    ...(median(workingSets(input).map((set) => set.weightKg)) === undefined ? {} : { medianWeightKg: currentWeight }),
    ...(currentReps === undefined ? {} : { medianReps: currentReps }),
    completedUpperBoundCount: upperCount,
    discreteIncreaseCount: discreteCount,
    ...(bestE1rm(input) === undefined ? {} : { currentE1rmKg: bestE1rm(input) }),
    ...(comparable.length === 0 ? {} : { medianPreviousE1rmKg: median(comparable.map((exposure) => bestE1rm(exposure) ?? 0)) }),
  }
  const confidence: Confidence = availableComparables.length >= 4 && [...all, ...availableComparables.slice(3, 4)].slice(0, 5).every(completeFeedback) && currentSets.some((set) => finite(set.rpe)) ? 'high' : comparable.length >= 3 ? 'medium' : 'low'
  const warnings = [...blockers]
  const maintain = buildCandidate(input, 'maintain', {
    plannedSets: input.plannedSets,
    repsMin: input.plannedRepsMin ?? input.repRangeMin,
    repsMax: input.plannedRepsMax ?? input.repRangeMax,
    ...(currentWeight === undefined ? {} : { loadKg: currentWeight }),
  }, evidence, confidence, warnings, comparable.length < 3 ? 'Mantén la prescripción hasta reunir tres exposiciones comparables.' : blockers.length ? `Mantén: ${blockers.join(', ')}.` : 'Mantén la prescripción actual.', 'maintain')
  const candidates = [maintain]
  if (comparable.length < 3 || blockers.length > 0 || input.feedback?.completed === false) {
    return { exerciseId: input.exerciseId, occurrenceId: input.occurrenceId, fallbackCandidateId: maintain.candidateId, candidates, comparableWorkoutIds: evidence.comparableWorkoutIds, warnings }
  }

  const rpeValid = validRpe(input)
  const drop = isDrop(input, comparable)
  const targetMin = input.plannedRepsMin ?? input.repRangeMin
  const targetMax = input.plannedRepsMax ?? input.repRangeMax
  const load = currentWeight ?? 0
  if (drop) {
    if (repeatedDrop(input, comparable) && !blockers.some((warning) => warning === 'dolor general' || warning === 'dolor del ejercicio')) {
      candidates.push(buildCandidate(input, 'reduce-load', { plannedSets: input.plannedSets, repsMin: targetMin, repsMax: targetMax, loadKg: Math.max(0, load - input.loadIncrementKg) }, evidence, confidence, ['caída de rendimiento'], 'Reduce la carga una progresión para recuperar el rendimiento.', 'drop-recovery'))
    }
    return { exerciseId: input.exerciseId, occurrenceId: input.occurrenceId, fallbackCandidateId: maintain.candidateId, candidates, comparableWorkoutIds: evidence.comparableWorkoutIds, warnings }
  }

  const allUpper = allSetsAtUpper(input)
  const commonNext = { plannedSets: input.plannedSets, repsMin: targetMin, repsMax: targetMax }
  const rpeEligible = hasRpeTarget(input) && rpeValid
  if (input.role === 'strength') {
    if (completedPrescription(input) && !allUpper && targetMax > targetMin) {
      candidates.push(buildCandidate(input, 'increase-reps', { ...commonNext, repsMin: targetMin + 1, repsMax: Math.min(targetMax, targetMax) }, evidence, confidence, [], 'Añade una repetición manteniendo la carga.', 'strength-reps'))
    } else if (allUpper && rpeEligible && comparable.slice(0, 2).every((exposure) => allSetsAtUpper(exposure) && hasRpeTarget(exposure) && validRpe(exposure))) {
      candidates.push(buildCandidate(input, 'increase-load', { ...commonNext, loadKg: load + input.loadIncrementKg }, evidence, confidence, [], 'Dos exposiciones consecutivas completaron el límite superior dentro del RPE objetivo.', 'strength-load'))
    }
  } else if (allUpper && rpeEligible) {
    candidates.push(buildCandidate(input, 'increase-load', { plannedSets: input.plannedSets, repsMin: input.repRangeMin, repsMax: input.repRangeMax, loadKg: load + input.loadIncrementKg }, evidence, confidence, [], 'Completa el extremo superior con RPE válido y reinicia las repeticiones.', 'hypertrophy-load'))
  } else if (completedPrescription(input) && targetMax > targetMin) {
    candidates.push(buildCandidate(input, 'increase-reps', { ...commonNext, repsMin: Math.min(targetMax, targetMin + 1), repsMax: targetMax }, evidence, confidence, [], 'Aumenta primero el objetivo de repeticiones por serie.', 'hypertrophy-reps'))
  }

  if (!candidates.some((candidate) => candidate.kind === 'increase-load' || candidate.kind === 'increase-reps') && comparable.length >= 3 && discreteCount === 0 && input.plannedSets < 10 && hasRpeTarget(input) && (input.feedback?.energy ?? 0) >= 4 && (input.feedback?.difficulty ?? 5) <= 3 && all.slice(0, 4).every((exposure) => exposure.feedback?.completed === true)) {
    candidates.push(buildCandidate(input, 'add-set', { plannedSets: input.plannedSets + 1, repsMin: targetMin, repsMax: targetMax, ...(currentWeight === undefined ? {} : { loadKg: currentWeight }) }, evidence, confidence, ['estancamiento de tres comparables'], 'Añade una serie por estancamiento, manteniendo la carga.', 'plateau-volume'))
  }
  return { exerciseId: input.exerciseId, occurrenceId: input.occurrenceId, fallbackCandidateId: maintain.candidateId, candidates: candidates.slice(0, 2), comparableWorkoutIds: evidence.comparableWorkoutIds, warnings }
}

export function analyzeAdaptation(inputs: ExerciseAnalysisInput[]): AdaptationAnalysis {
  return { policyVersion: ADAPTATION_POLICY_VERSION, decisions: inputs.map(analyzeExercise) }
}

export { fnv1a64 }
