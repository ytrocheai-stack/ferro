import { enrichWithSourceSummaries } from './summary-context.mjs'
import { canonicalJson, corpusMetadataKey, corpusNamespace, sha256Base64url, sha256Hex, vectorPhysicalId } from '../../corpus-identity/src/index.mjs'

export const EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b'
export interface CorpusSource {
  id: string; author: string; title: string; url: string; license: string; approved: boolean
  language?: string; reviewStatus?: string; population?: string[]; populationReviewed?: boolean; populationScope?: string; collection?: string
}
export interface CorpusChunk {
  id: string; sourceId: string; text: string; location: string; section?: string; textHash?: string
  retrievalClass?: 'evidence' | 'administrative' | 'ambiguous-table'; collection?: string
  population?: string[]; populationReviewed?: boolean
}
export interface CorpusManifest { version?: string; corpusVersion?: string; status: string; sources: CorpusSource[]; chunks: CorpusChunk[] }
export interface EmbeddingMatrix { schema?: string; corpusVersion: string; model: string; fingerprint?: string; documents: { id: string; inputType?: string; textHash?: string; vector2048: number[] }[] }
export interface RetrievalOptions { mode?: 'recommendation' | 'research'; sourceIds?: string[]; population?: string[]; collection?: string; language?: string }
export interface RetrievedEvidence { claim: string; sourceId: string; chunkId: string; location: string; excerpt: string; relevance: number; author: string; title: string; url: string; license: string }
export interface RetrievalResult { candidates: RetrievedEvidence[]; evidence: RetrievedEvidence[] }
export interface EvidenceRetriever { retrieve(query: string, options?: RetrievalOptions): Promise<RetrievalResult> }
export type EmbedQuery = (text: string, inputType: 'query') => Promise<number[]>
export interface VectorizeMatch { id: string; score: number; metadata?: Record<string, unknown> }
export interface VectorizeQueryOptions { topK: number; namespace: string; returnMetadata: 'all'; filter: Record<string, string | boolean | { $in: string[] }> }
export type VectorizeMetadataFilter = Record<string, string | { $in: string[] }>
export type VectorizeQuery = (vector: number[], options: VectorizeQueryOptions) => Promise<{ matches?: VectorizeMatch[] }>
interface RetrieverConfig { manifest: CorpusManifest; embedQuery: EmbedQuery; dimensions?: 512 | 1024; allowSyntheticLegacy?: boolean }

export function eligibleCorpusEvidence(chunk: CorpusChunk, source: CorpusSource, options: RetrievalOptions = {}, manifestApproved = true, legacy = false): boolean {
  if (!manifestApproved || !source.approved || (chunk.retrievalClass ?? (legacy ? 'evidence' : undefined)) !== 'evidence') return false
  if (options.sourceIds && !options.sourceIds.includes(source.id)) return false
  if (options.collection && (chunk.collection ?? source.collection) !== options.collection) return false
  if (options.language && source.language !== options.language) return false
  const populations = chunk.population ?? source.population ?? (legacy ? ['adult-general'] : [])
  const reviewed = chunk.populationReviewed ?? source.populationReviewed ?? legacy
  if (options.mode === 'research') {
    if (options.sourceIds?.includes(source.id)) return true
    if (options.population?.length) return options.population.some(population => populations.includes(population))
    return true
  }
  if (!reviewed || populations.length === 0 || populations.some(population => ['unknown', 'contextual'].includes(population))) return false
  return (options.population ?? ['adult-general']).some(population => populations.includes(population))
}

export function selectDiverseMatches<T>(matches: T[], sourceIdFor: (match: T) => string | undefined, limit = 8, maxPerSource = 2): T[] {
  const counts = new Map<string, number>()
  return matches.filter(match => {
    const sourceId = sourceIdFor(match)
    if (!sourceId) return false
    const count = counts.get(sourceId) ?? 0
    if (count >= maxPerSource) return false
    counts.set(sourceId, count + 1)
    return true
  }).slice(0, limit)
}

/**
 * The server-side filter is shared by the Worker, the remote verifier and the
 * benchmark. The local eligibility check remains authoritative after the
 * query because Vectorize metadata is untrusted input.
 */
export function buildVectorizeFilter(version: string, options: RetrievalOptions = {}): VectorizeMetadataFilter {
  const filter: VectorizeMetadataFilter = { corpusKey: corpusMetadataKey(version), retrievalClass: 'evidence' }
  if (options.collection) filter.collection = options.collection
  if (options.language) filter.language = options.language
  if (options.sourceIds?.length) filter.sourceId = { $in: options.sourceIds }
  if (options.population?.length) filter.population = { $in: options.population }
  if (options.mode !== 'research') filter.populationReviewed = 'true'
  return filter
}

export function corpusVersion(manifest: CorpusManifest): string {
  const version = manifest.corpusVersion ?? manifest.version
  if (!version || (manifest.version && manifest.corpusVersion && manifest.version !== manifest.corpusVersion)) throw new Error('Invalid corpus version')
  return version
}
export function manifestFingerprint(manifest: CorpusManifest): string {
  return sha256Base64url(canonicalJson({ corpusVersion: corpusVersion(manifest), status: manifest.status, sources: [...manifest.sources].sort((a, b) => a.id.localeCompare(b.id)), chunks: [...manifest.chunks].sort((a, b) => a.id.localeCompare(b.id)) }))
}
export function normalizePrefix(vector: number[], dimensions: 512 | 1024): number[] {
  if (vector.length !== 2048 || vector.some(value => !Number.isFinite(value))) throw new Error('Embedding must contain 2048 finite values')
  const prefix = vector.slice(0, dimensions)
  const norm = Math.hypot(...prefix)
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding prefix has invalid norm')
  return prefix.map(value => value / norm)
}
function repository(config: RetrieverConfig) {
  const version = corpusVersion(config.manifest)
  const sources = new Map(config.manifest.sources.map(source => [source.id, source]))
  const chunks = new Map(config.manifest.chunks.map(chunk => [chunk.id, chunk]))
  if (sources.size !== config.manifest.sources.length || chunks.size !== config.manifest.chunks.length) throw new Error('Duplicate manifest identity')
  for (const chunk of chunks.values()) if (!chunk.id || !sources.has(chunk.sourceId) || !chunk.location || !chunk.text) throw new Error('Invalid chunk identity or location')
  const legacy = config.allowSyntheticLegacy === true && /^synthetic(?:-|:)/.test(version)
  function eligible(chunk: CorpusChunk, options: RetrievalOptions): boolean {
    const source = sources.get(chunk.sourceId)!
    return eligibleCorpusEvidence(chunk, source, options, config.manifest.status === 'approved', legacy)
  }
  function result(scores: { id: string; score: number }[], options: RetrievalOptions): RetrievalResult {
    const seen = new Set<string>()
    const candidates: RetrievedEvidence[] = []
    for (const match of scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))) {
      const chunk = chunks.get(match.id)
      if (!chunk || seen.has(chunk.id) || !Number.isFinite(match.score) || !eligible(chunk, options)) continue
      seen.add(chunk.id)
      const source = sources.get(chunk.sourceId)!
      // Corpus passages are data, never instructions. Only authoritative manifest text is returned.
      candidates.push({ claim: chunk.text.slice(0, 800), excerpt: chunk.text.slice(0, 1600), sourceId: source.id, chunkId: chunk.id, location: chunk.location, relevance: match.score, author: source.author, title: source.title, url: source.url, license: source.license })
      if (candidates.length === 20) break
    }
    const evidence = enrichWithSourceSummaries(candidates.map(candidate => ({ id: candidate.chunkId, score: candidate.relevance })), [...chunks.values()], chunk => eligible(chunk, options)).map(match => {
      const chunk = chunks.get(match.id)!; const source = sources.get(chunk.sourceId)!
      return { claim: chunk.text.slice(0, 800), excerpt: chunk.text, sourceId: source.id, chunkId: chunk.id, location: chunk.location, relevance: match.score, author: source.author, title: source.title, url: source.url, license: source.license }
    })
    return { candidates, evidence }
  }
  return { version, chunks, eligible, result }
}
export function createLocalRetriever(config: RetrieverConfig & { matrix: EmbeddingMatrix }): EvidenceRetriever {
  const repo = repository(config)
  const dimensions = config.dimensions ?? 512
  const matrix = config.matrix
  const generated = matrix.schema === 'hevy-embedding-matrix-v1'
  const expectedFingerprint = generated
    ? sha256Hex(JSON.stringify({ corpusVersion: matrix.corpusVersion, model: matrix.model, documents: matrix.documents.map(({ id, textHash, inputType }) => ({ id, textHash, inputType })) }))
    : manifestFingerprint(config.manifest)
  if (matrix.corpusVersion !== repo.version || matrix.model !== EMBEDDING_MODEL || ((generated || matrix.fingerprint !== undefined) && matrix.fingerprint !== expectedFingerprint)) throw new Error('Matrix corpus version, model or fingerprint mismatch')
  const vectors = new Map<string, number[]>()
  for (const document of matrix.documents) {
    if (vectors.has(document.id) || !repo.chunks.has(document.id)) throw new Error('Matrix duplicate or unknown chunk identity')
    if (generated && (document.inputType !== 'passage' || document.textHash !== sha256Hex(repo.chunks.get(document.id)!.text))) throw new Error('Matrix passage text hash mismatch')
    // Validate both supported prefixes even if this run uses only one.
    normalizePrefix(document.vector2048, 512)
    normalizePrefix(document.vector2048, 1024)
    vectors.set(document.id, normalizePrefix(document.vector2048, dimensions))
  }
  if (vectors.size !== repo.chunks.size) throw new Error('Matrix coverage mismatch')
  return { async retrieve(query, options = {}) {
    const vector = normalizePrefix(await config.embedQuery(query, 'query'), dimensions)
    return repo.result([...vectors].filter(([id]) => repo.eligible(repo.chunks.get(id)!, options)).map(([id, values]) => ({ id, score: values.reduce((sum, value, i) => sum + value * vector[i], 0) })), options)
  } }
}
export function createVectorizeRetriever(config: RetrieverConfig & { query: VectorizeQuery }): EvidenceRetriever {
  const repo = repository(config)
  const dimensions = config.dimensions ?? 512
  const physical = new Map([...repo.chunks.keys()].map(id => [vectorPhysicalId(repo.version, id), id]))
  return { async retrieve(query, options = {}) {
    const vector = normalizePrefix(await config.embedQuery(query, 'query'), dimensions)
    const eligible = [...repo.chunks.values()].filter(chunk => repo.eligible(chunk, options))
    if (eligible.length === 0) return { candidates: [], evidence: [] }
    // Filter authoritative eligible identities before topK, so excluded populations
    // cannot crowd useful evidence out of the remote candidate window.
    // The server applies these indexed filters before topK. The local
    // eligibility check remains authoritative for unindexed/contextual fields.
    const filter = buildVectorizeFilter(repo.version, options)
    const responses = await Promise.all([config.query(vector, { topK: 20, namespace: corpusNamespace(repo.version, dimensions), returnMetadata: 'all', filter })])
    const matches = responses.flatMap(response => response.matches ?? []).flatMap(match => {
      const id = physical.get(match.id)
      const chunk = id ? repo.chunks.get(id) : undefined
      if (!chunk || match.metadata?.corpusKey !== corpusMetadataKey(repo.version) || (match.metadata?.chunkId !== undefined && match.metadata.chunkId !== chunk.id) || (match.metadata?.sourceId !== undefined && match.metadata.sourceId !== chunk.sourceId) || (match.metadata?.corpusVersion !== undefined && match.metadata.corpusVersion !== repo.version)) return []
      return [{ id: chunk.id, score: match.score }]
    })
    return repo.result(matches, options)
  } }
}
