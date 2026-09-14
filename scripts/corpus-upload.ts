import path from 'node:path'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { corpusMetadataKey, corpusNamespace, corpusSourceKey, utf8ByteLength, vectorPhysicalId } from '../packages/corpus-identity/src/index.mjs'
import { EMBEDDING_MODEL, loadLocalEnv, readJson, writeJson } from '../packages/corpus-pipeline/src/runtime.ts'
import { scientificReviewReady } from '../packages/corpus-evaluation/src/scientific-review.mjs'

const execFileAsync = promisify(execFile)
const args = process.argv.slice(2)
loadLocalEnv()
function option(name: string): string | undefined { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; if (!v || v.startsWith('--')) throw new Error(`Falta valor de ${name}`); return v }
function has(name: string): boolean { return args.includes(name) }
function fail(message: string): never { throw new Error(`corpus:upload: ${message}`) }
const runWrangler = (wranglerArgs: string[]) => {
  if (process.platform !== 'win32') return execFileAsync('npx', ['wrangler', ...wranglerArgs], { cwd: path.resolve('.') })
  const quote = (value: string) => /[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
  const command = ['npx.cmd', 'wrangler', ...wranglerArgs].map(quote).join(' ')
  return execFileAsync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { cwd: path.resolve('.') })
}
type Source = { id: string; author: string; title: string; url: string; license: string; evidenceLevel: number; language: string; approvedAt: number; publishedAt?: string; location?: string; approved: boolean; collection?: string; population?: string[]; sourceHash?: string; reviewStatus?: string; scientificReview?: string; populationReviewed?: boolean; populationScope?: string }
type Chunk = { id: string; sourceId: string; text: string; textHash?: string; location?: string; section?: string; retrievalClass?: 'evidence' | 'administrative' | 'ambiguous-table'; collection?: string; population?: string[]; populationReviewed?: boolean; populationScope?: string }
type Manifest = { corpusVersion: string; status: string; sources: Source[]; chunks: Chunk[] }
type Matrix = { corpusVersion: string; model: string; dimensions: number; documents: Array<{ id: string; inputType?: string; textHash?: string; vector2048: number[] }> }
type Capacity = { accessVerified: true; budgetVerified: true; maxAdditionalCost: 0; verifiedAt: string; reviewer: string; evidence: string; accountId: string; estimatedDimensionsStored: number; existingDimensionsStored: number; estimatedDimensionsQueried: number; legacyIndexVectorCount: number }
type UploadCheckpoint = { schema: 'hevy-upload-checkpoint-v2'; corpusVersion: string; metadataFingerprint?: string; primaryIndex: string; evaluationIndex: string; completedIds: string[]; mutationIds: Record<string, { primary?: string; evaluation?: string }>; backupPath?: string; updatedAt: string }
type ApiBody = { success?: boolean; errors?: unknown; result?: { dimensions?: number; vectorCount?: number; count?: number; vectors?: number; config?: { dimensions?: number }; mutationId?: string; matches?: Array<{ id?: string }>; metadataIndexes?: Array<{ propertyName?: string; indexType?: string }> } }
type D1Body = { success?: boolean; errors?: unknown; result?: Array<{ results?: Array<Record<string, unknown>> }> }

const manifestPath = path.resolve(option('--manifest') ?? '.cache/corpus/hevy/manifest.json')
const matrixPath = path.resolve(option('--matrix') ?? path.join(path.dirname(manifestPath), 'embeddings', 'matrix-2048.json'))
const checkpointPath = path.resolve(option('--checkpoint') ?? path.join(path.dirname(manifestPath), 'upload-checkpoint.json'))
const referencePath = path.resolve(option('--reference') ?? path.join(path.dirname(manifestPath), 'reference-final.json'))
const capacityPath = option('--capacity')
const verificationPath = path.resolve(option('--verification-output') ?? path.join(path.dirname(checkpointPath), 'remote-verification.json'))
const primaryIndex = option('--primary-index') ?? 'nextrep-adaptation-512'
const evaluationIndex = option('--evaluation-index') ?? 'nextrep-adaptation-eval-1024'
const legacyIndex = option('--legacy-index') ?? 'nextrep-adaptation-768'
const dbId = option('--database-id') ?? 'b7e25a26-9264-49d2-9ac8-f6cb5b7024e8'
const manifest = readJson<Manifest>(manifestPath)
const metadataFingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
if (manifest.status !== 'approved' || !manifest.corpusVersion || manifest.chunks.length !== 2708) fail('el manifiesto debe ser el corpus científico aprobado de 2.708 fragmentos')
const chunks = new Map(manifest.chunks.map(chunk => [chunk.id, chunk]))
const sources = new Map(manifest.sources.map(source => [source.id, source]))
if (manifest.sources.length !== 88 || sources.size !== manifest.sources.length || [...chunks.values()].some(chunk => !sources.has(chunk.sourceId))) fail('identidad de fuentes/chunks inconsistente')
if (manifest.sources.some(source => !/^[a-f0-9]{64}$/i.test(source.sourceHash ?? ''))) fail('cada fuente aprobada debe conservar una huella SHA-256 antes de cargarla')
const dimensionsStored = manifest.chunks.length * (512 + 1024)

if (!has('--execute')) {
  console.log(JSON.stringify({ status: 'blocked', corpusVersion: manifest.corpusVersion, primaryIndex, evaluationIndex, chunks: manifest.chunks.length, storedDimensions: dimensionsStored, batchSize: 1000, existingIndexPreserved: 'nextrep-adaptation-768', providerExecution: 'disabled', reason: 'Añade --execute, credenciales Cloudflare, --capacity verificado y un backup D1 antes de escribir.' }, null, 2))
  process.exit(0)
}
const matrix = readJson<Matrix>(matrixPath)
const reference = readJson<{ status?: string; corpusVersion?: string; queries?: unknown[]; scientificReview?: Record<string, unknown> }>(referencePath)
if (reference.status !== 'approved' || reference.corpusVersion !== manifest.corpusVersion || reference.queries?.length !== 50 || !scientificReviewReady(reference)) fail('la carga remota requiere aprobación científica completa y vinculada antes de mutar D1 o Vectorize')
if (matrix.corpusVersion !== manifest.corpusVersion || matrix.model !== EMBEDDING_MODEL || matrix.dimensions !== 2048) fail('matriz incompatible con el corpus o modelo')
if (matrix.documents.length !== manifest.chunks.length || new Set(matrix.documents.map(item => item.id)).size !== matrix.documents.length || matrix.documents.some(item => item.inputType !== 'passage')) fail('la matriz no cubre exactamente los chunks con input_type=passage')
for (const chunk of manifest.chunks) {
  const expectedHash = createHash('sha256').update(chunk.text).digest('hex')
  if (chunk.textHash !== expectedHash) fail(`textHash del chunk ${chunk.id} no coincide con su texto`)
  const matrixDocument = matrix.documents.find(item => item.id === chunk.id)
  if (!matrixDocument || matrixDocument.textHash !== expectedHash) fail(`textHash de matriz ausente o incorrecto para ${chunk.id}`)
}
if (!capacityPath) fail('falta --capacity con comprobación de acceso, límites y coste adicional cero')
const capacity = readJson<Capacity>(path.resolve(capacityPath))
const age = Date.now() - Date.parse(capacity.verifiedAt)
const requiredStoredDimensions = dimensionsStored + capacity.existingDimensionsStored
if (capacity.accessVerified !== true || capacity.budgetVerified !== true || capacity.maxAdditionalCost !== 0 || !capacity.accountId?.trim() || !capacity.reviewer?.trim() || !capacity.evidence?.trim() || !Number.isFinite(capacity.existingDimensionsStored) || capacity.existingDimensionsStored < 0 || !Number.isFinite(capacity.estimatedDimensionsStored) || capacity.estimatedDimensionsStored < requiredStoredDimensions || !Number.isFinite(capacity.estimatedDimensionsQueried) || capacity.estimatedDimensionsQueried < 50 * (512 + 1024) || !Number.isSafeInteger(capacity.legacyIndexVectorCount) || capacity.legacyIndexVectorCount < 0 || !Number.isFinite(age) || age < 0 || age >= 86400000) fail('la comprobación de capacidad/coste o preservación del índice legado está incompleta, insuficiente o caducada')
if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ACCOUNT_ID !== capacity.accountId) fail('la cuenta de la autorización de capacidad no coincide con CLOUDFLARE_ACCOUNT_ID')
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? capacity.accountId
const token = process.env.CLOUDFLARE_API_TOKEN
if (!accountId || !token) fail('CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN son obligatorios; no se hicieron escrituras')
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`
const headers = { Authorization: `Bearer ${token}` }
async function api(url: string, init: RequestInit = {}): Promise<ApiBody> {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const body = await response.json().catch(() => null) as ApiBody | null
  if (!response.ok || body?.success === false) throw new Error(`Cloudflare ${response.status}: ${JSON.stringify(body?.errors ?? body)}`)
  return body
}
async function ensureIndex(name: string, dimensions: number): Promise<ApiBody> {
  try {
    const info = await api(`${base}/vectorize/v2/indexes/${encodeURIComponent(name)}/info`)
    const actual = Number(info.result?.dimensions ?? info.result?.config?.dimensions)
    if (actual !== dimensions) fail(`índice ${name} tiene dimensión ${actual}, se esperaba ${dimensions}`)
    return info
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Cloudflare 404')) throw error
    return api(`${base}/vectorize/v2/indexes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, config: { dimensions, metric: 'cosine' } }) })
  }
}
async function verifyLegacyIndex(): Promise<ApiBody> {
  try {
    const info = await api(`${base}/vectorize/v2/indexes/${encodeURIComponent(legacyIndex)}/info`)
    const dimensions = Number(info.result?.dimensions ?? info.result?.config?.dimensions)
    if (dimensions !== 768) fail(`el índice legado ${legacyIndex} tiene dimensión ${dimensions}, se esperaba 768`)
    return info
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Cloudflare 404')) fail(`no se encontró el índice legado ${legacyIndex}; se detiene para no sobrescribirlo`)
    throw error
  }
}
async function ensureMetadataIndexes(name: string): Promise<void> {
  const expected = ['corpusKey', 'retrievalClass', 'populationReviewed', 'collection', 'language', 'sourceId', 'population']
  const listed = await api(`${base}/vectorize/v2/indexes/${encodeURIComponent(name)}/metadata_index/list`)
  const current = new Set((listed.result?.metadataIndexes ?? []).map(index => index.propertyName).filter((value): value is string => Boolean(value)))
  if (current.size > 10 || current.size + expected.filter(propertyName => !current.has(propertyName)).length > 10) fail(`el índice ${name} superaría el límite de 10 metadata indexes`)
  for (const propertyName of expected) if (!current.has(propertyName)) await api(`${base}/vectorize/v2/indexes/${encodeURIComponent(name)}/metadata_index/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyName, indexType: 'string' }) })
}
async function backupD1(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const version = manifest.corpusVersion.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48)
  const backup = path.resolve(option('--backup') ?? path.join(path.dirname(checkpointPath), `d1-backup-${version}-${stamp}.sql`))
  await mkdir(path.dirname(backup), { recursive: true })
  const backupArgument = path.relative(path.resolve('.'), backup) || path.basename(backup)
  await runWrangler(['d1', 'export', 'nextrep-adaptation', '--remote', '--config', 'worker/wrangler.production.toml', '--output', backupArgument])
  const details = await stat(backup)
  if (!details.isFile() || details.size === 0) fail(`backup D1 ilegible o vacío: ${backup}`)
  const sql = await readFile(backup, 'utf8')
  if (!sql.includes('adaptation_sources') || !sql.includes('adaptation_chunks')) fail(`backup D1 no contiene las tablas críticas esperadas: ${backup}`)
  return backup
}
async function applyMigrations(): Promise<void> {
  if (!has('--apply-migrations')) fail('falta --apply-migrations para aplicar exclusivamente las migraciones remotas pendientes antes de mutar Vectorize/D1')
  await runWrangler(['d1', 'migrations', 'apply', 'nextrep-adaptation', '--remote', '--config', 'worker/wrangler.production.toml'])
}
async function upsert(index: string, vectors: Array<{ id: string; values: number[]; metadata: Record<string, string>; namespace: string }>): Promise<string | undefined> {
  const ndjson = vectors.map(vector => JSON.stringify(vector)).join('\n') + '\n'
  const form = new FormData()
  form.set('vectors', new Blob([ndjson], { type: 'application/x-ndjson' }), 'vectors.ndjson')
  const result = await api(`${base}/vectorize/v2/indexes/${encodeURIComponent(index)}/upsert?unparsable-behavior=error`, { method: 'POST', body: form })
  return result.result?.mutationId
}
async function d1Batch(statements: Array<{ sql: string; params: unknown[] }>): Promise<void> {
  await api(`${base}/d1/database/${dbId}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: statements }) })
}
async function d1Select(sql: string, params: unknown[]): Promise<D1Body> {
  const response = await fetch(`${base}/d1/database/${dbId}/query`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) })
  const body = await response.json().catch(() => null) as D1Body | null
  if (!response.ok || body?.success === false) throw new Error(`Cloudflare D1 ${response.status}: ${JSON.stringify(body?.errors ?? body)}`)
  return body ?? {}
}
type RemoteVector = { id?: string; namespace?: string; values?: number[]; metadata?: Record<string, string> }
async function getByIds(index: string, ids: string[]): Promise<RemoteVector[]> {
  const records: RemoteVector[] = []
  for (let offset = 0; offset < ids.length; offset += 20) {
    const body = await api(`${base}/vectorize/v2/indexes/${encodeURIComponent(index)}/get_by_ids`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids.slice(offset, offset + 20) }) })
    const batch = body.result as unknown as RemoteVector[] | undefined
    if (!Array.isArray(batch)) fail(`get_by_ids de ${index} devolvió una forma inválida`)
    records.push(...batch)
  }
  return records
}
async function verifyIndexedBatch(index: string, vectors: Array<{ id: string; values: number[]; metadata: Record<string, string>; namespace: string }>, dimensions: 512 | 1024): Promise<void> {
  const expected = new Map(vectors.map(vector => [vector.id, vector]))
  for (let offset = 0; offset < vectors.length; offset += 500) {
    const batch = vectors.slice(offset, offset + 500)
    let confirmed = false
    for (let attempt = 0; attempt < 6 && !confirmed; attempt += 1) {
      const records = await getByIds(index, batch.map(vector => vector.id))
      const seen = new Set<string>()
      confirmed = records.length === batch.length && records.every(record => {
        const expectedVector = record.id ? expected.get(record.id) : undefined
        if (!expectedVector || seen.has(record.id!)) return false
        seen.add(record.id!)
        return record.namespace === corpusNamespace(manifest.corpusVersion, dimensions) && record.metadata?.corpusKey === corpusMetadataKey(manifest.corpusVersion) && record.metadata.corpusVersion === manifest.corpusVersion && record.metadata.chunkId === expectedVector.metadata.chunkId && record.metadata.sourceId === expectedVector.metadata.sourceId && record.metadata.textHash === expectedVector.metadata.textHash && Array.isArray(record.values) && record.values.length === dimensions && record.values.every(value => Number.isFinite(value)) && Math.hypot(...record.values) > 0
      })
      if (!confirmed) await new Promise(resolve => setTimeout(resolve, 2_000))
    }
    if (!confirmed) fail(`Vectorize no confirmó el lote completo de ${index} iniciado en ${batch[0]?.id}; el checkpoint no avanza`)
  }
}
async function verifyD1Batch(batch: Chunk[]): Promise<void> {
  for (let offset = 0; offset < batch.length; offset += 100) {
    const part = batch.slice(offset, offset + 100)
    const ids = part.map(chunk => manifest.corpusVersion + ':' + chunk.id)
    const placeholders = ids.map(() => '?').join(',')
    const rows = (await d1Select(`SELECT id, vector_id, source_id, text_hash, corpus_version FROM adaptation_chunks WHERE id IN (${placeholders})`, ids)).result?.[0]?.results ?? []
    const expected = new Map(part.map(chunk => [chunk.id, chunk]))
    if (rows.length !== part.length || rows.some(row => {
      const rowId = String(row.id)
      const id = rowId.startsWith(manifest.corpusVersion + ':') ? rowId.slice(manifest.corpusVersion.length + 1) : ''
      const chunk = expected.get(id)
      return !chunk || String(row.vector_id) !== vectorPhysicalId(manifest.corpusVersion, chunk.id) || String(row.source_id) !== corpusSourceKey(chunk.sourceId, manifest.corpusVersion) || String(row.text_hash) !== chunk.textHash || String(row.corpus_version) !== manifest.corpusVersion
    })) fail(`D1 no confirmó el lote completo iniciado en ${part[0]?.id}; el checkpoint no avanza`)
  }
}
function metadata(chunk: Chunk, source: Source): Record<string, string> {
  const value = { chunkId: chunk.id, sourceId: chunk.sourceId, textHash: chunk.textHash ?? createHash('sha256').update(chunk.text).digest('hex'), author: source.author, source: source.title, title: source.title, url: source.url, license: source.license, evidenceLevel: String(source.evidenceLevel ?? 0), language: source.language, text: chunk.text, location: chunk.location ?? chunk.section ?? 'unknown', section: chunk.section ?? chunk.location ?? 'unknown', retrievalClass: chunk.retrievalClass ?? 'evidence', collection: chunk.collection ?? source.collection ?? 'scientific', population: (chunk.population ?? source.population ?? ['unknown']).join(','), populationReviewed: String(chunk.populationReviewed ?? source.populationReviewed ?? false), populationScope: source.populationScope ?? '', corpusVersion: manifest.corpusVersion, corpusKey: corpusMetadataKey(manifest.corpusVersion) }
  if (utf8ByteLength(JSON.stringify(value)) > 10 * 1024) fail(`metadata del chunk ${chunk.id} supera 10 KiB`)
  for (const property of ['corpusKey', 'retrievalClass', 'populationReviewed', 'collection', 'language', 'sourceId', 'population']) if (utf8ByteLength(value[property as keyof typeof value]) > 64) fail(`metadata indexada ${property} del chunk ${chunk.id} supera 64 bytes`)
  return value
}
let checkpoint: UploadCheckpoint = { schema: 'hevy-upload-checkpoint-v2', corpusVersion: manifest.corpusVersion, metadataFingerprint, primaryIndex, evaluationIndex, completedIds: [], mutationIds: {}, updatedAt: new Date().toISOString() }
try {
  checkpoint = readJson<UploadCheckpoint>(checkpointPath)
  if (checkpoint.schema !== 'hevy-upload-checkpoint-v2' || checkpoint.corpusVersion !== manifest.corpusVersion || checkpoint.primaryIndex !== primaryIndex || checkpoint.evaluationIndex !== evaluationIndex) fail('checkpoint incompatible; no se reanuda otro índice o corpus')
  if (checkpoint.completedIds.length && checkpoint.metadataFingerprint !== metadataFingerprint) fail('La revisión de metadatos cambió; usa un checkpoint nuevo para verificar y publicar todos los cambios')
} catch (error) {
  if (!(error instanceof Error) || !/ENOENT/.test((error as NodeJS.ErrnoException).code ?? '')) throw error
}
const completed = new Set(checkpoint.completedIds)
const matrixById = new Map(matrix.documents.map(item => [item.id, item.vector2048]))
const backupPath = await backupD1()
checkpoint.backupPath = backupPath
await applyMigrations()
const legacyInfoBefore = await verifyLegacyIndex()
const legacyVectorCountBefore = Number(legacyInfoBefore.result?.vectorCount ?? legacyInfoBefore.result?.count ?? legacyInfoBefore.result?.vectors)
if (!Number.isSafeInteger(legacyVectorCountBefore) || legacyVectorCountBefore !== capacity.legacyIndexVectorCount) fail(`el conteo legado cambió o no coincide con la autorización: ${legacyVectorCountBefore}/${capacity.legacyIndexVectorCount}`)
await ensureIndex(primaryIndex, 512)
await ensureIndex(evaluationIndex, 1024)
await ensureMetadataIndexes(primaryIndex)
await ensureMetadataIndexes(evaluationIndex)
for (let offset = 0; offset < manifest.chunks.length; offset += 1000) {
  const batch = manifest.chunks.slice(offset, offset + 1000).filter(chunk => !completed.has(chunk.id))
  if (!batch.length) continue
  const primary = batch.map(chunk => { const source = sources.get(chunk.sourceId)!; const vector = matrixById.get(chunk.id)!; return { id: vectorPhysicalId(manifest.corpusVersion, chunk.id), values: vector.slice(0, 512).map((value, _, values) => value / Math.hypot(...values)), metadata: metadata(chunk, source), namespace: corpusNamespace(manifest.corpusVersion, 512) } })
  const evaluation = batch.map(chunk => { const source = sources.get(chunk.sourceId)!; const vector = matrixById.get(chunk.id)!; return { id: vectorPhysicalId(manifest.corpusVersion, chunk.id), values: vector.slice(0, 1024).map((value, _, values) => value / Math.hypot(...values)), metadata: metadata(chunk, source), namespace: corpusNamespace(manifest.corpusVersion, 1024) } })
  const primaryMutation = await upsert(primaryIndex, primary)
  const evaluationMutation = await upsert(evaluationIndex, evaluation)
  if (!primaryMutation || !evaluationMutation) fail(`Vectorize no devolvió mutationId para el lote iniciado en ${batch[0].id}; el checkpoint no avanza`)
  await verifyIndexedBatch(primaryIndex, primary, 512)
  await verifyIndexedBatch(evaluationIndex, evaluation, 1024)
  await d1Batch(batch.flatMap(chunk => { const source = sources.get(chunk.sourceId)!; return [{ sql: 'INSERT OR REPLACE INTO adaptation_sources (id, author, title, url, license, evidence_level, language, approved_at, published_at, location, approved, corpus_version, source_hash, review_status, scientific_review, population_json, population_reviewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [corpusSourceKey(source.id, manifest.corpusVersion), source.author, source.title, source.url, source.license, source.evidenceLevel ?? 0, source.language, source.approvedAt, source.publishedAt ?? null, source.location ?? null, source.approved ? 1 : 0, manifest.corpusVersion, source.sourceHash ?? null, source.reviewStatus ?? 'unknown', source.scientificReview ?? 'not_appraised', JSON.stringify(source.population ?? ['unknown']), source.populationReviewed ? 1 : 0] }, { sql: 'INSERT OR REPLACE INTO adaptation_chunks (id, vector_id, source_id, text_hash, text, metadata_json, corpus_version, section, retrieval_class, collection, population_json, population_reviewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [`${manifest.corpusVersion}:${chunk.id}`, vectorPhysicalId(manifest.corpusVersion, chunk.id), corpusSourceKey(chunk.sourceId, manifest.corpusVersion), chunk.textHash ?? String(chunk.id), chunk.text, JSON.stringify(metadata(chunk, source)), manifest.corpusVersion, chunk.section ?? chunk.location ?? null, chunk.retrievalClass ?? 'evidence', chunk.collection ?? source.collection ?? 'scientific', JSON.stringify(chunk.population ?? source.population ?? ['unknown']), (chunk.populationReviewed ?? source.populationReviewed) ? 1 : 0] }] }))
  await verifyD1Batch(batch)
  batch.forEach(chunk => completed.add(chunk.id))
  checkpoint = { schema: 'hevy-upload-checkpoint-v2', corpusVersion: manifest.corpusVersion, metadataFingerprint, primaryIndex, evaluationIndex, completedIds: [...completed].sort(), mutationIds: { ...checkpoint.mutationIds, [batch[0].id]: { primary: primaryMutation, evaluation: evaluationMutation } }, backupPath, updatedAt: new Date().toISOString() }
  writeJson(checkpointPath, checkpoint)
  console.log(JSON.stringify({ stage: 'verified-batch', completed: completed.size, total: manifest.chunks.length }))
}
if (completed.size === manifest.chunks.length) {
  const countRows = (await d1Select('SELECT COUNT(*) AS count FROM adaptation_chunks WHERE corpus_version = ?', [manifest.corpusVersion])).result?.[0]?.results ?? []
  const sourceRows = (await d1Select('SELECT COUNT(*) AS count FROM adaptation_sources WHERE corpus_version = ?', [manifest.corpusVersion])).result?.[0]?.results ?? []
  const chunkCount = Number(countRows[0]?.count)
  const sourceCount = Number(sourceRows[0]?.count)
  if (chunkCount !== manifest.chunks.length || sourceCount !== manifest.sources.length) fail(`conteo D1 no coincide: chunks=${chunkCount}/${manifest.chunks.length}, sources=${sourceCount}/${manifest.sources.length}`)
  const rows = (await d1Select('SELECT id, vector_id, source_id, text_hash, corpus_version FROM adaptation_chunks WHERE corpus_version = ? ORDER BY id', [manifest.corpusVersion])).result?.[0]?.results ?? []
  const sourceRowsExact = (await d1Select('SELECT id, source_hash, corpus_version, approved FROM adaptation_sources WHERE corpus_version = ? ORDER BY id', [manifest.corpusVersion])).result?.[0]?.results ?? []
  const remoteHash = createHash('sha256').update(rows.map(row => `${String(row.id)}:${String(row.vector_id)}:${String(row.source_id)}:${String(row.text_hash)}:${String(row.corpus_version)}\n`).sort().join()).digest('hex')
  const localHash = createHash('sha256').update(manifest.chunks.map(chunk => {
    const source = sources.get(chunk.sourceId)!
    return `${manifest.corpusVersion}:${chunk.id}:${vectorPhysicalId(manifest.corpusVersion, chunk.id)}:${corpusSourceKey(source.id, manifest.corpusVersion)}:${chunk.textHash}:${manifest.corpusVersion}\n`
  }).sort().join()).digest('hex')
  const expectedChunkIds = manifest.chunks.map(chunk => `${manifest.corpusVersion}:${chunk.id}`).sort()
  if (rows.length !== manifest.chunks.length || rows.map(row => String(row.id)).sort().join('\n') !== expectedChunkIds.join('\n')) fail('D1 no contiene exactamente los IDs de chunks de la versión candidata')
  if (remoteHash !== localHash) fail(`hash D1 no coincide: ${remoteHash} !== ${localHash}`)
  const expectedSourceHashes = new Map(manifest.sources.map(source => [corpusSourceKey(source.id, manifest.corpusVersion), source.sourceHash]))
  if (sourceRowsExact.length !== manifest.sources.length || sourceRowsExact.some(row => String(row.corpus_version) !== manifest.corpusVersion || Number(row.approved) !== 1 || expectedSourceHashes.get(String(row.id)) !== String(row.source_hash))) fail('D1 no contiene exactamente las fuentes aprobadas y sus huellas de la versión candidata')
  const primaryInfo = await ensureIndex(primaryIndex, 512)
  const evaluationInfo = await ensureIndex(evaluationIndex, 1024)
  const primaryVectors = Number(primaryInfo.result?.vectorCount ?? primaryInfo.result?.count ?? primaryInfo.result?.vectors)
  const evaluationVectors = Number(evaluationInfo.result?.vectorCount ?? evaluationInfo.result?.count ?? evaluationInfo.result?.vectors)
  if (primaryVectors !== manifest.chunks.length || evaluationVectors !== manifest.chunks.length) fail(`Vectorize no confirma el conteo exacto: 512=${primaryVectors}, 1024=${evaluationVectors}`)
  const verification = { schema: 'hevy-remote-verification-v1', verifiedAt: new Date().toISOString(), corpusVersion: manifest.corpusVersion, sources: sourceCount, chunks: chunkCount, vectors512: primaryVectors, vectors1024: evaluationVectors, idsVerified: true, hashesVerified: true, d1Fingerprint: remoteHash, namespaces: { primary: corpusNamespace(manifest.corpusVersion, 512), evaluation1024: corpusNamespace(manifest.corpusVersion, 1024) }, expectedNamespaces: { primary: corpusNamespace(manifest.corpusVersion, 512), evaluation1024: corpusNamespace(manifest.corpusVersion, 1024) }, indexes: { primary: primaryIndex, evaluation1024: evaluationIndex }, dimensions: { primary: primaryInfo.result?.dimensions ?? primaryInfo.result?.config?.dimensions, evaluation1024: evaluationInfo.result?.dimensions ?? evaluationInfo.result?.config?.dimensions }, backupPath: checkpoint.backupPath ?? null }
  writeJson(verificationPath, verification)
  console.log(JSON.stringify({ status: 'complete', corpusVersion: manifest.corpusVersion, primaryIndex, evaluationIndex, completedChunks: completed.size, totalChunks: manifest.chunks.length, storedDimensions: dimensionsStored, checkpoint: checkpointPath, verification: { ...verification, output: verificationPath }, d1: { databaseId: dbId, backupRequired: true }, rollback: `rollbackCorpusVersion(${JSON.stringify(manifest.corpusVersion)})` }, null, 2))
} else {
  console.log(JSON.stringify({ status: 'partial', corpusVersion: manifest.corpusVersion, primaryIndex, evaluationIndex, completedChunks: completed.size, totalChunks: manifest.chunks.length, storedDimensions: dimensionsStored, checkpoint: checkpointPath, d1: { databaseId: dbId, backupRequired: true }, rollback: `rollbackCorpusVersion(${JSON.stringify(manifest.corpusVersion)})` }, null, 2))
}
