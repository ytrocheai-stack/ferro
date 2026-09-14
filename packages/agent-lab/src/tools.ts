import { epley1RM } from '../../adaptation-core/src/index.ts'
import type { PlannedExercise } from '../../adaptation-core/src/contract.ts'
import { createLocalRetriever, type CorpusManifest, type EmbeddingMatrix } from '../../corpus-retrieval/src/index.ts'
import type { CatalogExercise, FictionalHistory, FictionalPlan, LabCorpus, LabCorpusChunk, LabCorpusSource, LabEvidence, LabInput } from './types.ts'

export interface HistoryMetrics {
  workoutCount: number
  exerciseCount: number
  workingSetCount: number
  totalVolumeKg: number
  bestE1rmByExercise: Record<string, number>
}

export interface TrendMetrics {
  exerciseId: string
  exposures: number
  recentMedianWeightKg?: number
  priorMedianWeightKg?: number
  recentMedianReps?: number
  priorMedianReps?: number
  direction: 'improving' | 'stable' | 'declining' | 'unknown'
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((token) => token.length > 2)
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function workingSets(exercise: { sets: Array<{ type: string; weightKg: number; reps: number; completed: boolean }> }) {
  return exercise.sets.filter((set) => set.type !== 'warmup' && set.completed && Number.isFinite(set.weightKg) && set.weightKg >= 0 && Number.isInteger(set.reps) && set.reps >= 0)
}

export function readHistory(history: FictionalHistory, permissions: LabInput['permissions']): FictionalHistory {
  if (!permissions.canReadHistory) return { workouts: [] }
  return { workouts: history.workouts.map((workout) => ({ ...workout, exercises: workout.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map((set) => ({ ...set })) })) })) }
}

export function readGoals(input: LabInput): string[] {
  return input.permissions.canReadGoals ? [...input.profile.goals] : []
}

export function readRestrictions(input: LabInput): LabInput['restrictions'] {
  return {
    injuriesOrPain: [...input.restrictions.injuriesOrPain],
    unavailableEquipment: [...input.restrictions.unavailableEquipment],
    excludedExercises: [...input.restrictions.excludedExercises],
    nutritionConstraints: [...input.restrictions.nutritionConstraints],
  }
}

export function readCatalog(catalog: CatalogExercise[], permissions: LabInput['permissions']): CatalogExercise[] {
  return permissions.canReadCatalog ? catalog.map((exercise) => ({ ...exercise, equipment: [...exercise.equipment], muscles: [...exercise.muscles], alternatives: [...exercise.alternatives] })) : []
}

export function calculateRecords(history: FictionalHistory): Record<string, { weightKg: number; reps: number; e1rmKg: number }> {
  const records: Record<string, { weightKg: number; reps: number; e1rmKg: number }> = {}
  for (const workout of history.workouts) for (const exercise of workout.exercises) for (const set of workingSets(exercise)) {
    const e1rmKg = epley1RM(set.weightKg, set.reps)
    const current = records[exercise.exerciseId]
    if (!current || set.weightKg > current.weightKg || e1rmKg > current.e1rmKg || set.reps > current.reps) records[exercise.exerciseId] = { weightKg: Math.max(current?.weightKg ?? 0, set.weightKg), reps: Math.max(current?.reps ?? 0, set.reps), e1rmKg: Math.max(current?.e1rmKg ?? 0, e1rmKg) }
  }
  return records
}

export function calculateVolume(history: FictionalHistory): Record<string, number> {
  const volume: Record<string, number> = {}
  for (const workout of history.workouts) for (const exercise of workout.exercises) volume[exercise.exerciseId] = (volume[exercise.exerciseId] ?? 0) + workingSets(exercise).filter((set) => set.completed).reduce((total, set) => total + set.weightKg * set.reps, 0)
  return volume
}

export function calculateHistoryMetrics(history: FictionalHistory): HistoryMetrics {
  const records = calculateRecords(history)
  const volume = calculateVolume(history)
  return {
    workoutCount: history.workouts.length,
    exerciseCount: new Set(history.workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.exerciseId))).size,
    workingSetCount: history.workouts.flatMap((workout) => workout.exercises).reduce((total, exercise) => total + workingSets(exercise).length, 0),
    totalVolumeKg: Object.values(volume).reduce((total, value) => total + value, 0),
    bestE1rmByExercise: Object.fromEntries(Object.entries(records).map(([id, record]) => [id, record.e1rmKg])),
  }
}

export function calculateTrends(history: FictionalHistory, exerciseId: string, occurrenceId?: string): TrendMetrics {
  const matching = [...history.workouts].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  // Sin una ocurrencia explícita no se mezclan roles distintos del mismo ejercicio.
  if (!occurrenceId && new Set(matching.flatMap(w => w.exercises.filter(e => e.exerciseId === exerciseId).map(e => e.occurrenceId))).size > 1) return { exerciseId, exposures: 0, direction: 'unknown' }
  const exposures = matching.flatMap(w => w.exercises.filter(e => e.exerciseId === exerciseId && (!occurrenceId || e.occurrenceId === occurrenceId)))
  const values = exposures.map((exercise) => ({ weight: median(workingSets(exercise).map((set) => set.weightKg)), reps: median(workingSets(exercise).map((set) => set.reps)) })).filter((value): value is { weight: number; reps: number } => value.weight !== undefined && value.reps !== undefined)
  if (!values.length) return { exerciseId, exposures: exposures.length, direction: 'unknown' }
  const split = Math.max(1, Math.floor(values.length / 2))
  const prior = values.slice(0, split)
  const recent = values.slice(split)
  const recentMedianWeightKg = median(recent.map((value) => value.weight)) ?? median(values.map((value) => value.weight))
  const priorMedianWeightKg = median(prior.map((value) => value.weight))
  const recentMedianReps = median(recent.map((value) => value.reps)) ?? median(values.map((value) => value.reps))
  const priorMedianReps = median(prior.map((value) => value.reps))
  const weightDelta = (recentMedianWeightKg ?? 0) - (priorMedianWeightKg ?? 0)
  const repsDelta = (recentMedianReps ?? 0) - (priorMedianReps ?? 0)
  // Orden parcial: ambas métricas deben ser no decrecientes/no crecientes.
  // Cambios compensados no admiten dirección; no se suman unidades distintas.
  const direction = values.length < 2 || weightDelta * repsDelta < 0 ? 'unknown' : weightDelta === 0 && repsDelta === 0 ? 'stable' : weightDelta >= 0 && repsDelta >= 0 ? 'improving' : 'declining'
  return { exerciseId, exposures: values.length, recentMedianWeightKg, priorMedianWeightKg, recentMedianReps, priorMedianReps, direction }
}

function evidenceForChunk(chunk: LabCorpusChunk, source: LabCorpusSource, score: number): LabEvidence {
  return { chunkId: chunk.id, claim: chunk.text.slice(0, 800), sourceId: source.id, location: chunk.location, excerpt: chunk.text.slice(0, 1600), relevance: score }
}

/** Recuperación local lexical. Los fragmentos son datos no confiables y nunca instrucciones. */
export function searchEvidence(corpus: LabCorpus, query: string, limit = 5): LabEvidence[] {
  if (corpus.status !== 'approved') return []
  const sources = new Map(corpus.sources.filter((source) => source.approved).map((source) => [source.id, source]))
  const queryTokens = new Set(tokens(query))
  return corpus.chunks.map((chunk) => {
    const source = sources.get(chunk.sourceId)
    if (!source) return null
    const chunkTokens = new Set(tokens(chunk.text))
    const overlap = [...queryTokens].filter((token) => chunkTokens.has(token)).length
    const score = queryTokens.size ? overlap / queryTokens.size : 0
    return score > 0 ? evidenceForChunk(chunk, source, score) : null
  }).filter((item): item is LabEvidence => item !== null).sort((a, b) => b.relevance - a.relevance || a.sourceId.localeCompare(b.sourceId) || a.location.localeCompare(b.location)).slice(0, limit)
}

/** Recuperación semántica compartida con Worker/benchmark; los abstracts se añaden por fuente. */
export function createSemanticSearchEvidence(corpus: LabCorpus, matrix: EmbeddingMatrix, embedQuery: (query: string) => Promise<number[]>): (query: string, population?: string[]) => Promise<LabEvidence[]> {
  const manifest: CorpusManifest = { corpusVersion: corpus.version, status: corpus.status, sources: corpus.sources, chunks: corpus.chunks }
  const retriever = createLocalRetriever({ manifest, matrix, dimensions: 512, allowSyntheticLegacy: false, embedQuery: async (query) => embedQuery(query) })
  return async (query, population = []) => {
    if (!population.length) return []
    const result = await retriever.retrieve(query, { mode: 'recommendation', population })
    return result.evidence.map((item) => ({ claim: item.claim, sourceId: item.sourceId, location: item.location, excerpt: item.excerpt, chunkId: item.chunkId, relevance: item.relevance }))
  }
}

export function planExercises(plan: FictionalPlan): PlannedExercise[] {
  return plan.sessions[0]?.exercises.map((exercise) => ({ ...exercise, setTargets: exercise.setTargets.map((target) => ({ ...target })) })) ?? []
}

export function explainMetrics(input: LabInput): { metrics: HistoryMetrics; trends: TrendMetrics[] } {
  const history = readHistory(input.history, input.permissions)
  const metrics = calculateHistoryMetrics(history)
  const ids = [...new Set(history.workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.exerciseId)))]
  return { metrics, trends: ids.map((id) => calculateTrends(history, id)) }
}
