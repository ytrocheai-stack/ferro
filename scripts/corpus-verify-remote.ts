import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { corpusNamespace, corpusSourceKey, vectorPhysicalId } from '../packages/corpus-identity/src/index.mjs'
import { EMBEDDING_MODEL, loadLocalEnv, readJson } from '../packages/corpus-pipeline/src/runtime.ts'
import { scientificReviewReady } from '../packages/corpus-evaluation/src/scientific-review.mjs'
import { corpusMetadataKey } from '../packages/corpus-identity/src/index.mjs'
import { buildVectorizeFilter, eligibleCorpusEvidence } from '../packages/corpus-retrieval/src/index.ts'

type Source = { id: string; author: string; title: string; url: string; license: string; approved: boolean; sourceHash?: string; population?: string[]; populationReviewed?: boolean; collection?: string; language?: string; [key: string]: unknown }
type Chunk = { id: string; sourceId: string; text: string; location: string; textHash?: string; retrievalClass?: 'evidence' | 'administrative' | 'ambiguous-table'; population?: string[]; populationReviewed?: boolean; collection?: string }
type Manifest = { corpusVersion: string; status: string; sources: Source[]; chunks: Chunk[] }
type Matrix = { corpusVersion: string; model: string; dimensions: number; documents: Array<{ id: string; inputType?: string; textHash?: string; vector2048: number[] }> }
type Query = { queryId: string; text: string; mode?: 'research' | 'recommendation'; population?: string[] }
type Reference = { status: string; corpusVersion: string; queries: Query[] }
type Capacity = { accessVerified: true; budgetVerified: true; maxAdditionalCost: 0; verifiedAt: string; reviewer: string; evidence: string; accountId: string; estimatedDimensionsQueried: number; legacyIndexVectorCount: number }
type VectorRecord = { id?: string; namespace?: string; metadata?: Record<string, string>; values?: number[] }
type ApiResult = { dimensions?: number; vectorCount?: number; count?: number; vectors?: number; config?: { dimensions?: number }; matches?: Array<{ id: string; score?: number; metadata?: Record<string, string> }> }
type ApiBody = { success?: boolean; errors?: unknown; result?: ApiResult }

const args = process.argv.slice(2)
loadLocalEnv()
const option = (name: string, fallback?: string) => { const index = args.indexOf(name); const value = index < 0 ? undefined : args[index + 1]; return value && !value.startsWith('--') ? value : fallback }
const has = (name: string) => args.includes(name)
const fail = (message: string): never => { throw new Error(`corpus:verify-remote: ${message}`) }

const manifestPath = path.resolve(option('--manifest', '.cache/corpus/hevy/manifest.json')!)
const base = path.dirname(manifestPath)
const referencePath = path.resolve(option('--reference', path.join(base, 'reference-final.json'))!)
const matrixPath = path.resolve(option('--matrix', path.join(base, 'embeddings/matrix-2048.json'))!)
const queryVectorsPath = path.resolve(option('--query-vectors', path.join(base, 'embeddings/queries-2048.jsonl'))!)
const outputPath = path.resolve(option('--output', path.join(base, 'remote-verification.json'))!)
const primaryIndex = option('--primary-index', 'nextrep-adaptation-512')!
const evaluationIndex = option('--evaluation-index', 'nextrep-adaptation-eval-1024')!
const legacyIndex = option('--legacy-index', 'nextrep-adaptation-768')!
const databaseId = option('--database-id', 'b7e25a26-9264-49d2-9ac8-f6cb5b7024e8')!
const capacityPath = option('--capacity')

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function cosine(a: number[], b: number[], dimensions: number): number { let dot = 0; let an = 0; let bn = 0; for (let i = 0; i < dimensions; i += 1) { dot += a[i] * b[i]; an += a[i] ** 2; bn += b[i] ** 2 } return an && bn ? dot / Math.sqrt(an * bn) : 0 }
function vectorCount(info: ApiBody): number { return Number(info.result?.vectorCount ?? info.result?.count ?? info.result?.vectors) }
function assertVector(vector: number[], label: string): void { if (!Array.isArray(vector) || vector.length !== 2048 || vector.some(value => !Number.isFinite(value)) || !Math.hypot(...vector.slice(0, 512)) || !Math.hypot(...vector.slice(0, 1024))) fail(`${label} no tiene 2048 valores finitos y normas válidas`) }
function normalizedPrefix(vector: number[], dimensions: 512 | 1024): number[] { const prefix = vector.slice(0, dimensions); const norm = Math.hypot(...prefix); if (!norm) fail(`vector local sin norma ${dimensions}`); return prefix.map(value => value / norm) }
function sameFloat32Prefix(actual: number[], expected: number[]): boolean { return actual.length === expected.length && actual.every((value, index) => Math.abs(value - expected[index]) <= 1e-5) }

const manifest = readJson<Manifest>(manifestPath)
if (!has('--execute')) {
  console.log(JSON.stringify({ status: 'blocked', corpusVersion: manifest.corpusVersion, sources: manifest.sources.length, chunks: manifest.chunks.length, primaryIndex, evaluationIndex, reason: 'Añade --execute y credenciales Cloudflare; no se hicieron consultas remotas.' }, null, 2))
  process.exit(0)
}
const reference = readJson<Reference>(referencePath)
const matrix = readJson<Matrix>(matrixPath)
if (manifest.status !== 'approved' || manifest.sources.length !== 88 || manifest.chunks.length !== 2708) fail('el corpus debe estar aprobado y contener 88 fuentes y 2.708 chunks')
if (reference.status !== 'approved' || reference.corpusVersion !== manifest.corpusVersion || reference.queries.length !== 50 || !scientificReviewReady(reference)) fail('el benchmark debe estar aprobado científicamente, ligado y contener exactamente 50 consultas')
if (matrix.corpusVersion !== manifest.corpusVersion || matrix.model !== EMBEDDING_MODEL || matrix.dimensions !== 2048 || matrix.documents.length !== manifest.chunks.length) fail('la matriz no corresponde al corpus candidato')
if (!capacityPath) fail('falta --capacity con cuota de consultas y coste adicional cero verificados')
const capacity = readJson<Capacity>(path.resolve(capacityPath))
const capacityAge = Date.now() - Date.parse(capacity.verifiedAt)
if (capacity.accessVerified !== true || capacity.budgetVerified !== true || capacity.maxAdditionalCost !== 0 || capacity.accountId !== process.env.CLOUDFLARE_ACCOUNT_ID || !capacity.reviewer?.trim() || !capacity.evidence?.trim() || !Number.isFinite(capacity.estimatedDimensionsQueried) || capacity.estimatedDimensionsQueried < reference.queries.length * (512 + 1024) || !Number.isSafeInteger(capacity.legacyIndexVectorCount) || capacity.legacyIndexVectorCount < 0 || !Number.isFinite(capacityAge) || capacityAge < 0 || capacityAge >= 86400000) fail('la comprobación de cuota/coste, preservación del índice legado o consultas es incompleta, insuficiente o caducada')
const matrixById = new Map(matrix.documents.map(document => [document.id, document]))
const chunkById = new Map(manifest.chunks.map(chunk => [chunk.id, chunk]))
if (matrixById.size !== manifest.chunks.length) fail('la matriz contiene IDs duplicados')
for (const chunk of manifest.chunks) { const document = matrixById.get(chunk.id); if (!document || document.inputType !== 'passage' || document.textHash !== chunk.textHash || sha256(chunk.text) !== chunk.textHash) fail(`hash o input_type de texto incoherente para ${chunk.id}`); assertVector(document.vector2048, `vector ${chunk.id}`) }
const queryVectors = new Map<string, number[]>()
for (const line of (await readFile(queryVectorsPath, 'utf8')).split(/\r?\n/).filter(Boolean)) { const item = JSON.parse(line) as { queryId: string; inputType?: string; vector2048: number[] }; if (item.inputType !== 'query') fail(`vector de consulta ${item.queryId} no conserva input_type=query`); if (queryVectors.has(item.queryId)) fail(`vector de consulta duplicado: ${item.queryId}`); assertVector(item.vector2048, `consulta ${item.queryId}`); queryVectors.set(item.queryId, item.vector2048) }
if (queryVectors.size !== reference.queries.length || reference.queries.some(query => !queryVectors.has(query.queryId))) fail('faltan vectores de consulta para el benchmark')

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN
if (!accountId || !token) fail('CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN son obligatorios')
const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}`
const headers = { Authorization: `Bearer ${token}` }
async function api(url: string, init: RequestInit = {}): Promise<ApiBody> { const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }); const body = await response.json().catch(() => null) as ApiBody | null; if (!response.ok || body?.success === false) throw new Error(`Cloudflare ${response.status}: ${JSON.stringify(body?.errors ?? body)}`); return body ?? {} }
async function info(index: string): Promise<ApiBody> { return api(`${baseUrl}/vectorize/v2/indexes/${encodeURIComponent(index)}/info`) }
async function query(index: string, vector: number[], dimensions: 512 | 1024, filter: Record<string, string | { $in: string[] }>): Promise<ApiBody> { return api(`${baseUrl}/vectorize/v2/indexes/${encodeURIComponent(index)}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vector, topK: 20, returnMetadata: 'all', namespace: corpusNamespace(manifest.corpusVersion, dimensions), filter }) }) }
async function d1(sql: string, params: unknown[]): Promise<{ results?: Record<string, unknown>[] }[]> { const response = await fetch(`${baseUrl}/d1/database/${databaseId}/query`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) }); const body = await response.json().catch(() => null) as { success?: boolean; errors?: unknown; result?: { results?: Record<string, unknown>[] }[] } | null; if (!response.ok || body?.success === false) throw new Error(`Cloudflare D1 ${response.status}: ${JSON.stringify(body?.errors ?? body)}`); return body?.result ?? [] }
async function getByIds(index: string, ids: string[]): Promise<VectorRecord[]> {
  const records: VectorRecord[] = []
  for (let offset = 0; offset < ids.length; offset += 20) {
    const batchIds = ids.slice(offset, offset + 20)
    const response = await fetch(`${baseUrl}/vectorize/v2/indexes/${encodeURIComponent(index)}/get_by_ids`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: batchIds }) })
    const body = await response.json().catch(() => null) as { success?: boolean; errors?: unknown; result?: VectorRecord[] } | null
    if (!response.ok || body?.success === false) throw new Error(`Cloudflare get_by_ids ${response.status}: ${JSON.stringify(body?.errors ?? body)}`)
    if (!Array.isArray(body?.result)) fail(`get_by_ids de ${index} devolvió una forma inválida`)
    records.push(...body.result)
  }
  return records
}

const primaryInfo = await info(primaryIndex)
const evaluationInfo = await info(evaluationIndex)
const legacyInfo = await info(legacyIndex)
if (Number(legacyInfo.result?.dimensions ?? legacyInfo.result?.config?.dimensions) !== 768) fail(`el índice legado ${legacyIndex} no conserva dimensión 768`)
const legacyVectorCount = vectorCount(legacyInfo)
if (!Number.isSafeInteger(legacyVectorCount) || legacyVectorCount !== capacity.legacyIndexVectorCount) fail(`el índice legado no conserva el conteo autorizado: ${legacyVectorCount}/${capacity.legacyIndexVectorCount}`)
const primaryVectors = vectorCount(primaryInfo)
const evaluationVectors = vectorCount(evaluationInfo)
const expectedVectorIds = manifest.chunks.map(chunk => vectorPhysicalId(manifest.corpusVersion, chunk.id))
const expectedVectorIdSet = new Set(expectedVectorIds)
async function verifyCandidateVectors(index: string, dimensions: 512 | 1024): Promise<number> {
  const records: VectorRecord[] = []
  for (let offset = 0; offset < expectedVectorIds.length; offset += 500) records.push(...await getByIds(index, expectedVectorIds.slice(offset, offset + 500)))
  const seen = new Set<string>()
  for (const record of records) {
    if (!record.id || !expectedVectorIdSet.has(record.id) || seen.has(record.id)) fail(`el índice ${index} devolvió un ID candidato ausente, ajeno o duplicado`)
    if (record.namespace !== corpusNamespace(manifest.corpusVersion, dimensions)) fail(`el vector ${record.id} no conserva el namespace ${dimensions}`)
    const expectedId = manifest.chunks.find(chunk => vectorPhysicalId(manifest.corpusVersion, chunk.id) === record.id)?.id
    const expectedChunk = manifest.chunks.find(chunk => chunk.id === expectedId)
    if (!expectedId || !expectedChunk || record.metadata?.corpusKey !== corpusMetadataKey(manifest.corpusVersion) || record.metadata?.corpusVersion !== manifest.corpusVersion || record.metadata?.chunkId !== expectedId || record.metadata?.sourceId !== expectedChunk.sourceId || record.metadata?.textHash !== expectedChunk.textHash) fail(`metadata incoherente para el vector ${record.id}`)
    const expectedVector = expectedId ? matrixById.get(expectedId)?.vector2048 : undefined
    if (!Array.isArray(record.values) || record.values.length !== dimensions || record.values.some(value => !Number.isFinite(value)) || !Math.hypot(...record.values)) fail(`valores o dimensión inválidos para el vector ${record.id}`)
    if (!expectedVector || !sameFloat32Prefix(record.values, normalizedPrefix(expectedVector, dimensions))) fail(`valores del vector ${record.id} no coinciden con el prefijo local normalizado dentro de la tolerancia float32`)
    seen.add(record.id)
  }
  if (seen.size !== expectedVectorIds.length) fail(`el índice ${index} confirma ${seen.size}/${expectedVectorIds.length} vectores de la versión candidata`)
  return seen.size
}
const candidateVectors512 = await verifyCandidateVectors(primaryIndex, 512)
const candidateVectors1024 = await verifyCandidateVectors(evaluationIndex, 1024)
if (candidateVectors512 !== manifest.chunks.length || candidateVectors1024 !== manifest.chunks.length) fail(`los índices no confirman 2.708 vectores candidatos: 512=${candidateVectors512}, 1024=${candidateVectors1024}`)
const queryComparisons: unknown[] = []
let identityMismatches = 0
let excludedEvidence = 0
const sourceById = new Map(manifest.sources.map(source => [source.id, source]))
for (const queryReference of reference.queries) {
  const vector = queryVectors.get(queryReference.queryId)!
  const mode = queryReference.mode ?? 'research'
  const filter = buildVectorizeFilter(manifest.corpusVersion, { mode, population: queryReference.population })
  const local = (dimensions: 512 | 1024) => matrix.documents.map(document => ({ id: document.id, score: cosine(vector, document.vector2048, dimensions) })).filter(match => { const chunk = chunkById.get(match.id); const source = chunk ? sourceById.get(chunk.sourceId) : undefined; return Boolean(chunk && source && eligibleCorpusEvidence(chunk, source, { mode, population: queryReference.population }, manifest.status === 'approved')) }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 20)
  const remote512 = (await query(primaryIndex, vector.slice(0, 512).map((value, _, values) => value / Math.hypot(...values)), 512, filter)).result?.matches ?? []
  const remote1024 = (await query(evaluationIndex, vector.slice(0, 1024).map((value, _, values) => value / Math.hypot(...values)), 1024, filter)).result?.matches ?? []
  const normalizeRemote = (matches: Array<{ id: string; score?: number; metadata?: Record<string, string> }>, dimensions: 512 | 1024) => matches.map(match => { const expectedId = [...chunkById.keys()].find(id => vectorPhysicalId(manifest.corpusVersion, id) === match.id); const expectedChunk = expectedId ? chunkById.get(expectedId) : undefined; if (!expectedId || !expectedChunk || match.metadata?.corpusKey !== corpusMetadataKey(manifest.corpusVersion) || match.metadata?.corpusVersion !== manifest.corpusVersion || match.metadata?.chunkId !== expectedId || match.metadata?.sourceId !== expectedChunk.sourceId || match.metadata?.textHash !== expectedChunk.textHash) { identityMismatches += 1; return null } return { id: expectedId, score: match.score ?? 0, dimensions, evidence: { source: match.metadata?.source, author: match.metadata?.author, url: match.metadata?.url, location: match.metadata?.location ?? match.metadata?.section, text: match.metadata?.text } } }).filter(match => match !== null)
  const normalized512 = normalizeRemote(remote512, 512)
  const normalized1024 = normalizeRemote(remote1024, 1024)
  excludedEvidence += [...normalized512, ...normalized1024].filter(match => { const chunk = match && chunkById.get(match.id); const source = chunk && sourceById.get(chunk.sourceId); return !match || !chunk || !source || !eligibleCorpusEvidence(chunk, source, { mode, population: queryReference.population }, manifest.status === 'approved') }).length
  queryComparisons.push({ queryId: queryReference.queryId, mode, filter, local512: local(512).slice(0, 5), local1024: local(1024).slice(0, 5), remote512: normalized512, remote1024: normalized1024, localRemoteMatch512: JSON.stringify(local(512).slice(0, 5).map(match => match.id)) === JSON.stringify(normalized512.slice(0, 5).map(match => match.id)), localRemoteMatch1024: JSON.stringify(local(1024).slice(0, 5).map(match => match.id)) === JSON.stringify(normalized1024.slice(0, 5).map(match => match.id)) })
}
const d1Chunks = (await d1('SELECT id, vector_id, source_id, text_hash, corpus_version FROM adaptation_chunks WHERE corpus_version = ? ORDER BY id', [manifest.corpusVersion]))[0]?.results ?? []
const d1Sources = (await d1('SELECT id, source_hash, corpus_version, approved FROM adaptation_sources WHERE corpus_version = ? ORDER BY id', [manifest.corpusVersion]))[0]?.results ?? []
const expectedChunkRows = manifest.chunks.map(chunk => { const source = manifest.sources.find(candidate => candidate.id === chunk.sourceId)!; return `${manifest.corpusVersion}:${chunk.id}:${vectorPhysicalId(manifest.corpusVersion, chunk.id)}:${corpusSourceKey(source.id, manifest.corpusVersion)}:${chunk.textHash}:${manifest.corpusVersion}` }).sort()
const remoteChunkRows = d1Chunks.map(row => `${String(row.id)}:${String(row.vector_id)}:${String(row.source_id)}:${String(row.text_hash)}:${String(row.corpus_version)}`).sort()
const expectedSourceIds = new Set(manifest.sources.map(source => corpusSourceKey(source.id, manifest.corpusVersion)))
const expectedSourceHashes = new Map(manifest.sources.map(source => [corpusSourceKey(source.id, manifest.corpusVersion), source.sourceHash]))
const hashesVerified = remoteChunkRows.length === expectedChunkRows.length && sha256(remoteChunkRows.join('\n')) === sha256(expectedChunkRows.join('\n')) && d1Sources.length === manifest.sources.length && d1Sources.every(row => expectedSourceIds.has(String(row.id)) && String(row.corpus_version) === manifest.corpusVersion && Number(row.approved) === 1 && expectedSourceHashes.get(String(row.id)) === String(row.source_hash))
const expectedFilters = reference.queries.map(queryReference => buildVectorizeFilter(manifest.corpusVersion, { mode: queryReference.mode ?? 'research', population: queryReference.population }))
const filtersMatchWorker = queryComparisons.length === expectedFilters.length && queryComparisons.every((comparison, index) => JSON.stringify((comparison as { filter?: unknown }).filter) === JSON.stringify(expectedFilters[index]))
const queriesComplete = queryComparisons.length === 50 && queryComparisons.every(comparison => {
  const item = comparison as { remote512?: unknown[]; remote1024?: unknown[] }
  return Array.isArray(item.remote512) && item.remote512.length >= 5 && Array.isArray(item.remote1024) && item.remote1024.length >= 5
})
const verification = { schema: 'hevy-remote-verification-v2', verifiedAt: new Date().toISOString(), corpusVersion: manifest.corpusVersion, sources: d1Sources.length, chunks: d1Chunks.length, vectors512: candidateVectors512, vectors1024: candidateVectors1024, indexVectorCounts: { primary: primaryVectors, evaluation1024: evaluationVectors, legacy768: legacyVectorCount }, idsVerified: identityMismatches === 0 && d1Chunks.length === manifest.chunks.length, hashesVerified, d1Fingerprint: sha256(remoteChunkRows.join('\n')), identityMismatches, excludedEvidence, filtersMatchWorker, queriesComplete, queryComparisons, legacyIndexVerified: Number(legacyInfo.result?.dimensions ?? legacyInfo.result?.config?.dimensions) === 768 && legacyVectorCount === capacity.legacyIndexVectorCount, namespaces: { primary: corpusNamespace(manifest.corpusVersion, 512), evaluation1024: corpusNamespace(manifest.corpusVersion, 1024) }, expectedNamespaces: { primary: corpusNamespace(manifest.corpusVersion, 512), evaluation1024: corpusNamespace(manifest.corpusVersion, 1024) }, indexes: { primary: primaryIndex, evaluation1024: evaluationIndex, legacy768: legacyIndex }, dimensions: { primary: primaryInfo.result?.dimensions ?? primaryInfo.result?.config?.dimensions, evaluation1024: evaluationInfo.result?.dimensions ?? evaluationInfo.result?.config?.dimensions, legacy768: legacyInfo.result?.dimensions ?? legacyInfo.result?.config?.dimensions }, approvedSources: d1Sources.filter(row => Number(row.approved) === 1).length }
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, JSON.stringify(verification, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ status: verification.idsVerified && verification.hashesVerified && verification.queriesComplete && verification.excludedEvidence === 0 && verification.legacyIndexVerified ? 'complete' : 'blocked', output: outputPath, ...verification }, null, 2))
if (!(verification.idsVerified && verification.hashesVerified && verification.queriesComplete && verification.excludedEvidence === 0 && verification.legacyIndexVerified)) process.exitCode = 1
