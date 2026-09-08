import { assertPhysicalId, canonicalJson, corpusMetadataKey, corpusNamespace, corpusSourceKey, sha256Hex, vectorPhysicalId } from '../../packages/corpus-identity/src/index.mjs'

export { corpusMetadataKey, corpusNamespace, vectorPhysicalId }

export interface ApprovedSource { id: string; author: string; title: string; url: string; license: string; evidenceLevel: number; language: string; approvedAt: number; publishedAt?: string; location?: string; approved: boolean; sourceHash?: string; reviewStatus?: string; scientificReview?: string; population?: string[]; populationReviewed?: boolean; collection?: string }
export interface ApprovedChunk { id: string; sourceId: string; text: string; source: ApprovedSource; corpusVersion: string; location?: string; section?: string; retrievalClass?: 'evidence' | 'administrative' | 'ambiguous-table'; collection?: string; population?: string[]; populationReviewed?: boolean }
export interface PassageEmbedding { embed(input: string, inputType: 'passage'): Promise<number[]> }
export interface VectorRecord { id: string; values: number[]; metadata: Record<string, string>; namespace?: string }
export interface VectorIndexWriter {
  upsert(items: VectorRecord[]): Promise<unknown>
  delete?(ids: string[]): Promise<unknown>
  /** Adaptador legado; el binding nativo no ofrece este método. */
  deleteByNamespace?(namespace: string): Promise<unknown>
}
export interface CorpusDatabase { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all?<T = Record<string, unknown>>(): Promise<{ results: T[] }> } } }

export const VECTORIZE_BATCH_LIMIT = 1_000
export const VECTORIZE_METADATA_LIMIT_BYTES = 10 * 1024
export const VECTORIZE_METADATA_INDEX_LIMIT_BYTES = 64

export type EmbeddingDimensions = 512 | 768 | 1024

export function validateApprovedChunks(chunks: ApprovedChunk[]): void {
  const corpusVersions = new Set(chunks.map((chunk) => chunk.corpusVersion))
  if (corpusVersions.size !== 1 || !chunks[0]?.corpusVersion) throw new Error('La importación debe contener una única versión de corpus')
  for (const chunk of chunks) {
    if (!chunk.source.approved) throw new Error(`La fuente ${chunk.source.id} no está aprobada`)
    if (!chunk.text?.trim() || !chunk.source.title || !chunk.source.url || !chunk.source.license || !Number.isFinite(chunk.source.evidenceLevel) || chunk.source.evidenceLevel < 0 || !Number.isFinite(chunk.source.approvedAt)) throw new Error(`El chunk ${chunk.id || chunkId(chunk)} tiene metadata incompleta`)
    if (chunk.sourceId !== chunk.source.id) throw new Error(`El chunk ${chunk.id || chunkId(chunk)} no referencia su fuente declarada`)
    if (!chunk.source.author || !chunk.source.language) throw new Error(`La fuente ${chunk.source.id} carece de autor o idioma`)
    const metadata = metadataFor({ ...chunk, id: chunk.id || chunkId(chunk) })
    if (new TextEncoder().encode(canonicalJson(metadata)).byteLength > VECTORIZE_METADATA_LIMIT_BYTES) throw new Error(`Los metadatos del chunk ${chunk.id || chunkId(chunk)} superan 10 KiB`)
    for (const property of ['corpusKey', 'retrievalClass', 'populationReviewed', 'collection', 'language', 'sourceId', 'population']) if (new TextEncoder().encode(metadata[property]).byteLength > VECTORIZE_METADATA_INDEX_LIMIT_BYTES) throw new Error(`La metadata indexada ${property} del chunk ${chunk.id || chunkId(chunk)} supera 64 bytes`)
    assertPhysicalId(corpusNamespace(chunk.corpusVersion, 512), 'Namespace')
    assertPhysicalId(corpusNamespace(chunk.corpusVersion, 1024), 'Namespace')
    assertPhysicalId(vectorPhysicalId(chunk.corpusVersion, chunk.id || chunkId(chunk)), 'ID de vector')
  }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function chunkId(chunk: Omit<ApprovedChunk, 'id'>): string {
  return `chunk-${fnv1a(canonicalJson({ sourceId: chunk.sourceId, text: chunk.text, corpusVersion: chunk.corpusVersion }))}`
}

function metadataFor(chunk: ApprovedChunk): Record<string, string> {
  return {
    chunkId: chunk.id || chunkId(chunk),
    sourceId: chunk.sourceId,
    textHash: sha256Hex(chunk.text),
    author: chunk.source.author,
    source: chunk.source.title,
    title: chunk.source.title,
    url: chunk.source.url,
    license: chunk.source.license,
    evidenceLevel: String(chunk.source.evidenceLevel),
    language: chunk.source.language,
    text: chunk.text,
    corpusVersion: chunk.corpusVersion,
    corpusKey: corpusMetadataKey(chunk.corpusVersion),
    location: chunk.location ?? chunk.section ?? 'unknown',
    section: chunk.section ?? chunk.location ?? 'unknown',
    retrievalClass: chunk.retrievalClass ?? 'evidence',
    collection: chunk.collection ?? chunk.source.collection ?? 'scientific',
    population: (chunk.population ?? chunk.source.population ?? ['unknown']).join(','),
    populationReviewed: String(chunk.populationReviewed ?? chunk.source.populationReviewed ?? false),
  }
}

export function deriveNormalizedPrefixes(vector: number[]): { values512: number[]; values768: number[]; values1024: number[] } {
  if (vector.length !== 2048 || vector.some((value) => !Number.isFinite(value))) throw new Error('El embedding de pasaje debe tener 2048 dimensiones')
  const normalize = (size: number) => { const prefix = vector.slice(0, size); const norm = Math.hypot(...prefix); if (!norm) throw new Error('El embedding tiene norma cero'); return prefix.map((value) => value / norm) }
  return { values512: normalize(512), values768: normalize(768), values1024: normalize(1024) }
}

/** Importador determinista: una llamada passage por chunk y metadatos no confiables en Vectorize. */
export async function importApprovedCorpus(chunks: ApprovedChunk[], embedding: PassageEmbedding, indexes: { primary: VectorIndexWriter; evaluation1024?: VectorIndexWriter }, db?: CorpusDatabase, options: { batchSize?: number; skipIds?: Set<string>; onBatch?: (ids: string[]) => Promise<void> } = {}): Promise<number> {
  validateApprovedChunks(chunks)
  const batchSize = Math.min(VECTORIZE_BATCH_LIMIT, Math.max(1, options.batchSize ?? VECTORIZE_BATCH_LIMIT))
  const sorted = [...chunks].sort((a, b) => a.id.localeCompare(b.id))
  const primary: VectorRecord[] = []
  const evaluation: VectorRecord[] = []
  const batchIds: string[] = []
  let imported = 0
  for (const chunk of sorted) {
    const id = chunk.id || chunkId(chunk)
    if (options.skipIds?.has(id)) continue
    const vector = await embedding.embed(chunk.text, 'passage')
    const derived = deriveNormalizedPrefixes(vector)
    const metadata = metadataFor({ ...chunk, id })
    if (db) {
      await db.prepare('INSERT OR REPLACE INTO adaptation_sources (id, author, title, url, license, evidence_level, language, approved_at, published_at, location, approved, corpus_version, source_hash, review_status, scientific_review, population_json, population_reviewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(corpusSourceKey(chunk.source.id, chunk.corpusVersion), chunk.source.author, chunk.source.title, chunk.source.url, chunk.source.license, chunk.source.evidenceLevel, chunk.source.language, chunk.source.approvedAt, chunk.source.publishedAt ?? null, chunk.source.location ?? null, chunk.source.approved ? 1 : 0, chunk.corpusVersion, chunk.source.sourceHash ?? null, chunk.source.reviewStatus ?? 'unknown', chunk.source.scientificReview ?? 'not_appraised', JSON.stringify(chunk.source.population ?? ['unknown']), chunk.source.populationReviewed ? 1 : 0).run()
      await db.prepare('INSERT OR REPLACE INTO adaptation_chunks (id, vector_id, source_id, text_hash, text, metadata_json, corpus_version, section, retrieval_class, collection, population_json, population_reviewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(`${chunk.corpusVersion}:${id}`, vectorPhysicalId(chunk.corpusVersion, id), corpusSourceKey(chunk.sourceId, chunk.corpusVersion), sha256Hex(chunk.text), chunk.text, JSON.stringify(metadata), chunk.corpusVersion, chunk.section ?? chunk.location ?? null, chunk.retrievalClass ?? 'evidence', chunk.collection ?? 'scientific', JSON.stringify(chunk.population ?? ['unknown']), chunk.populationReviewed ? 1 : 0).run()
    }
    primary.push({ id: vectorPhysicalId(chunk.corpusVersion, id), values: derived.values512, metadata, namespace: corpusNamespace(chunk.corpusVersion, 512) })
    batchIds.push(id)
    if (indexes.evaluation1024) evaluation.push({ id: vectorPhysicalId(chunk.corpusVersion, id), values: derived.values1024, metadata, namespace: corpusNamespace(chunk.corpusVersion, 1024) })
    imported += 1
    if (primary.length >= batchSize) {
      const ids = batchIds.splice(0, batchIds.length)
      await indexes.primary.upsert(primary.splice(0, primary.length))
      if (indexes.evaluation1024) await indexes.evaluation1024.upsert(evaluation.splice(0, evaluation.length))
      if (options.onBatch) await options.onBatch(ids)
    }
  }
  if (primary.length) {
    await indexes.primary.upsert(primary)
    if (indexes.evaluation1024 && evaluation.length) await indexes.evaluation1024.upsert(evaluation)
    const ids = batchIds.splice(0, batchIds.length)
    if (options.onBatch) await options.onBatch(ids)
  }
  return imported
}

/** Borra únicamente una versión aislada; nunca toca el corpus activo de otra versión. */
export async function rollbackCorpusVersion(corpusVersion: string, indexes: { primary: VectorIndexWriter; evaluation1024?: VectorIndexWriter }, db?: CorpusDatabase): Promise<void> {
  let ids: string[] = []
  if (db) {
    const statement = db.prepare('SELECT id, vector_id FROM adaptation_chunks WHERE corpus_version = ?').bind(corpusVersion)
    if (!statement.all) throw new Error('El adaptador D1 no puede listar los vectores del rollback')
    const rows = await statement.all<{ id: string; vector_id?: string }>()
    ids = rows.results.map((row) => row.vector_id || row.id)
  }
  const deleteIndex = async (index: VectorIndexWriter | undefined, dimensions: EmbeddingDimensions) => {
    if (!index) return
    if (index.delete && ids.length > 0) {
      await index.delete(ids)
      return
    }
    if (index.deleteByNamespace) {
      await index.deleteByNamespace(corpusNamespace(corpusVersion, dimensions))
      return
    }
    throw new Error('El adaptador Vectorize debe implementar delete(ids) para rollback')
  }
  await deleteIndex(indexes.primary, 512)
  await deleteIndex(indexes.evaluation1024, 1024)
  if (!db) return
  await db.prepare('DELETE FROM adaptation_chunks WHERE corpus_version = ?').bind(corpusVersion).run()
  await db.prepare('DELETE FROM adaptation_sources WHERE corpus_version = ?').bind(corpusVersion).run()
}
