import { canonicalJson } from '../../packages/adaptation-core/src/index'

export interface ApprovedSource { id: string; title: string; url: string; license: string; evidenceLevel: number; approvedAt: number }
export interface ApprovedChunk { id: string; sourceId: string; text: string; source: ApprovedSource; corpusVersion: string }
export interface PassageEmbedding { embed(input: string, inputType: 'passage'): Promise<number[]> }
export interface VectorIndexWriter { upsert(items: { id: string; values: number[]; metadata: Record<string, string> }[]): Promise<unknown> }
export interface CorpusDatabase { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } } }

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function chunkId(chunk: Omit<ApprovedChunk, 'id'>): string {
  return `chunk-${fnv1a(canonicalJson({ sourceId: chunk.sourceId, text: chunk.text, corpusVersion: chunk.corpusVersion }))}`
}

export function deriveNormalizedPrefixes(vector: number[]): { values768: number[]; values1024: number[] } {
  if (vector.length !== 2048 || vector.some((value) => !Number.isFinite(value))) throw new Error('El embedding de pasaje debe tener 2048 dimensiones')
  const normalize = (size: number) => { const prefix = vector.slice(0, size); const norm = Math.hypot(...prefix); if (!norm) throw new Error('El embedding tiene norma cero'); return prefix.map((value) => value / norm) }
  return { values768: normalize(768), values1024: normalize(1024) }
}

/** Importador determinista: una llamada passage por chunk y metadatos no confiables en Vectorize. */
export async function importApprovedCorpus(chunks: ApprovedChunk[], embedding: PassageEmbedding, indexes: { primary: VectorIndexWriter; evaluation1024?: VectorIndexWriter }, db?: CorpusDatabase): Promise<number> {
  const sorted = [...chunks].sort((a, b) => a.id.localeCompare(b.id))
  const primary: { id: string; values: number[]; metadata: Record<string, string> }[] = []
  const evaluation: { id: string; values: number[]; metadata: Record<string, string> }[] = []
  for (const chunk of sorted) {
    const vector = await embedding.embed(chunk.text, 'passage')
    const derived = deriveNormalizedPrefixes(vector)
    const metadata = { sourceId: chunk.sourceId, source: chunk.source.title, url: chunk.source.url, license: chunk.source.license, evidenceLevel: String(chunk.source.evidenceLevel), text: chunk.text, corpusVersion: chunk.corpusVersion }
    if (db) {
      await db.prepare('INSERT OR REPLACE INTO adaptation_sources (id, title, url, license, evidence_level, approved_at, corpus_version) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(chunk.source.id, chunk.source.title, chunk.source.url, chunk.source.license, chunk.source.evidenceLevel, chunk.source.approvedAt, chunk.corpusVersion).run()
      await db.prepare('INSERT OR REPLACE INTO adaptation_chunks (id, source_id, text_hash, text, metadata_json, corpus_version) VALUES (?, ?, ?, ?, ?, ?)').bind(chunk.id || chunkId(chunk), chunk.sourceId, fnv1a(chunk.text), chunk.text, JSON.stringify(metadata), chunk.corpusVersion).run()
    }
    primary.push({ id: chunk.id || chunkId(chunk), values: derived.values768, metadata })
    if (indexes.evaluation1024) evaluation.push({ id: chunk.id || chunkId(chunk), values: derived.values1024, metadata })
  }
  if (primary.length) await indexes.primary.upsert(primary)
  if (indexes.evaluation1024 && evaluation.length) await indexes.evaluation1024.upsert(evaluation)
  return primary.length
}
