import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { EMBEDDING_MODEL, ProviderSession, hash, loadLocalEnv, readAuthorization, readJson, writeJson } from '../packages/corpus-pipeline/src/runtime.ts'
import { scientificReviewReady } from '../packages/corpus-evaluation/src/scientific-review.mjs'

type Chunk = { id: string; text: string; textHash?: string }
type Manifest = { corpusVersion: string; chunks: Chunk[]; embeddingModel?: { name?: string; dimension?: number } }
type ApprovedReference = { corpusVersion?: string | null; status?: string; scientificReview?: Record<string, unknown>; queries?: Array<{ queryId: string; text: string }> }
type Checkpoint = { schema: 'hevy-embedding-checkpoint-v1'; corpusVersion: string; model: string; dimensions: 2048; completedIds: string[]; updatedAt: string }

const args = process.argv.slice(2)
function option(name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Falta valor de ${name}`)
  return value
}
function has(name: string): boolean { return args.includes(name) }
function fail(message: string): never { throw new Error(`corpus:embed: ${message}`) }
function textSha256(value: string): string { return createHash('sha256').update(value).digest('hex') }

const manifestPath = path.resolve(option('--manifest') ?? '.cache/corpus/hevy/manifest.json')
const output = path.resolve(option('--output') ?? path.dirname(manifestPath))
const checkpointPath = path.resolve(option('--checkpoint') ?? path.join(output, 'embeddings', 'checkpoint.json'))
const matrixPath = path.resolve(option('--matrix') ?? path.join(output, 'embeddings', 'matrix-2048.jsonl'))
const queryPath = option('--queries')
const queryOutput = path.resolve(option('--query-output') ?? path.join(output, 'embeddings', 'queries-2048.jsonl'))
const authorizationPath = option('--authorization')
const referencePath = path.resolve(option('--reference') ?? path.join(output, 'reference-final.json'))
const manifest = readJson<Manifest>(manifestPath)
if (!manifest.corpusVersion || !Array.isArray(manifest.chunks) || !manifest.chunks.length) fail('manifiesto vacío o sin corpusVersion')
if (manifest.chunks.some(chunk => !chunk.textHash || chunk.textHash !== textSha256(chunk.text))) fail('cada chunk debe conservar un textHash SHA-256 exacto antes de generar embeddings')
if (manifest.embeddingModel?.name && manifest.embeddingModel.name !== EMBEDDING_MODEL) fail(`modelo incompatible: ${manifest.embeddingModel.name}`)
if (manifest.embeddingModel?.dimension !== undefined && manifest.embeddingModel.dimension !== 2048) fail('el manifiesto no declara embeddings originales de 2048 dimensiones')
if (new Set(manifest.chunks.map(chunk => chunk.id)).size !== manifest.chunks.length) fail('hay IDs de chunk duplicados')

await mkdir(path.dirname(checkpointPath), { recursive: true })
const expectedIds = new Set(manifest.chunks.map(chunk => chunk.id))
let checkpoint: Checkpoint = { schema: 'hevy-embedding-checkpoint-v1', corpusVersion: manifest.corpusVersion, model: EMBEDDING_MODEL, dimensions: 2048, completedIds: [], updatedAt: new Date().toISOString() }
try {
  checkpoint = readJson<Checkpoint>(checkpointPath)
  if (checkpoint.schema !== 'hevy-embedding-checkpoint-v1' || checkpoint.corpusVersion !== manifest.corpusVersion || checkpoint.model !== EMBEDDING_MODEL || checkpoint.dimensions !== 2048) fail('checkpoint incompatible; usa uno nuevo para otra versión o modelo')
  if (checkpoint.completedIds.some(id => !expectedIds.has(id)) || new Set(checkpoint.completedIds).size !== checkpoint.completedIds.length) fail('checkpoint corrupto o con IDs ajenos al corpus')
} catch (error) {
  if (!(error instanceof Error) || !/ENOENT/.test((error as NodeJS.ErrnoException).code ?? '')) throw error
}

const existing = new Map<string, number[]>()
try {
  const lines = (await readFile(matrixPath, 'utf8')).split(/\r?\n/).filter(Boolean)
  for (const line of lines) {
    const item = JSON.parse(line) as { id?: string; textHash?: string; inputType?: string; vector2048?: number[] }
    const expectedChunk = item.id ? manifest.chunks.find(chunk => chunk.id === item.id) : undefined
    if (!item.id || item.inputType !== 'passage' || existing.has(item.id) || !expectedIds.has(item.id) || item.textHash !== expectedChunk?.textHash || !Array.isArray(item.vector2048) || item.vector2048.length !== 2048 || item.vector2048.some(value => !Number.isFinite(value))) fail('matriz parcial corrupta o incompatible')
    existing.set(item.id, item.vector2048)
  }
} catch (error) {
  if (!(error instanceof Error) || !/ENOENT/.test((error as NodeJS.ErrnoException).code ?? '')) throw error
}
for (const id of checkpoint.completedIds) if (!existing.has(id)) fail(`checkpoint confirma ${id}, pero falta su vector en la matriz`) 

const pending = manifest.chunks.filter(chunk => !existing.has(chunk.id))
loadLocalEnv()
const execute = has('--execute')
if (!execute) {
  await writeJson(path.join(output, 'embeddings', 'plan.json'), { schema: 'hevy-embedding-plan-v1', corpusVersion: manifest.corpusVersion, model: EMBEDDING_MODEL, dimensions: 2048, totalChunks: manifest.chunks.length, completedChunks: existing.size, pendingChunks: pending.length, providerExecution: 'blocked-by-default', reason: 'Añade --execute, NVIDIA_API_KEY y una autorización fresca con coste adicional cero.' })
  console.log(JSON.stringify({ status: 'blocked', corpusVersion: manifest.corpusVersion, model: EMBEDDING_MODEL, dimensions: 2048, totalChunks: manifest.chunks.length, completedChunks: existing.size, pendingChunks: pending.length, matrix: matrixPath, checkpoint: checkpointPath, providerExecution: 'disabled' }, null, 2))
  process.exit(0)
}
let approvedReference: ApprovedReference
try { approvedReference = readJson<ApprovedReference>(referencePath) } catch { fail(`falta la referencia aprobada ${referencePath}; no se hicieron llamadas`) }
if (approvedReference.corpusVersion !== manifest.corpusVersion || approvedReference.status !== 'approved' || approvedReference.queries?.length !== 50 || !scientificReviewReady(approvedReference)) fail('la referencia científica debe estar aprobada completamente para las 50 consultas y ligada al corpus antes de llamar al proveedor')
const authorization = readAuthorization(authorizationPath)
if (!process.env.NVIDIA_API_KEY?.trim()) fail('NVIDIA_API_KEY no está configurada; no se hicieron llamadas')
if (authorization.embeddingModel !== EMBEDDING_MODEL) fail('la autorización no corresponde al modelo de embeddings')
const session = new ProviderSession({ directory: path.join(output, 'provider-ledger'), authorization, apiKey: process.env.NVIDIA_API_KEY })
const completed = new Set(existing.keys())
const chunksById = new Map(manifest.chunks.map(chunk => [chunk.id, chunk]))
for (const chunk of pending) {
  const vector = await session.embed(chunk.text, 'passage')
  if (vector.length !== 2048 || vector.some(value => !Number.isFinite(value)) || !Math.hypot(...vector.slice(0, 512)) || !Math.hypot(...vector.slice(0, 1024))) fail(`embedding inválido para ${chunk.id}`)
  await appendFile(matrixPath, JSON.stringify({ id: chunk.id, textHash: chunk.textHash ?? hash(chunk.text), inputType: 'passage', vector2048: vector }) + '\n', 'utf8')
  existing.set(chunk.id, vector); completed.add(chunk.id)
  checkpoint = { schema: 'hevy-embedding-checkpoint-v1', corpusVersion: manifest.corpusVersion, model: EMBEDDING_MODEL, dimensions: 2048, completedIds: [...completed].sort(), updatedAt: new Date().toISOString() }
  writeJson(checkpointPath, checkpoint)
}
if (completed.size === manifest.chunks.length) {
      const documents = [...existing].sort(([a], [b]) => a.localeCompare(b)).map(([id, vector2048]) => ({ id, textHash: chunksById.get(id)!.textHash!, inputType: 'passage', vector2048 }))
  writeJson(path.join(output, 'embeddings', 'matrix-2048.json'), { schema: 'hevy-embedding-matrix-v1', corpusVersion: manifest.corpusVersion, model: EMBEDDING_MODEL, dimensions: 2048, documents, fingerprint: hash({ corpusVersion: manifest.corpusVersion, model: EMBEDDING_MODEL, documents: documents.map(item => ({ id: item.id, textHash: chunksById.get(item.id)?.textHash ?? hash(chunksById.get(item.id)?.text ?? ''), inputType: item.inputType })) }) })
}

if (queryPath) {
  const reference = readJson<{ queries?: Array<{ queryId: string; text: string }> }>(path.resolve(queryPath))
  const queries = reference.queries ?? []
  const queryVectors = new Map<string, number[]>()
  try {
    for (const line of (await readFile(queryOutput, 'utf8')).split(/\r?\n/).filter(Boolean)) {
      const item = JSON.parse(line) as { queryId?: string; inputType?: string; vector2048?: number[] }
      if (!item.queryId || item.inputType !== 'query' || queryVectors.has(item.queryId) || !Array.isArray(item.vector2048) || item.vector2048.length !== 2048 || item.vector2048.some(value => !Number.isFinite(value)) || !Math.hypot(...item.vector2048.slice(0, 512)) || !Math.hypot(...item.vector2048.slice(0, 1024))) fail('consulta cacheada inválida')
      queryVectors.set(item.queryId, item.vector2048)
    }
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
  for (const query of queries) if (!queryVectors.has(query.queryId)) {
    const vector = await session.embed(query.text, 'query')
    if (vector.length !== 2048 || vector.some(value => !Number.isFinite(value)) || !Math.hypot(...vector.slice(0, 512)) || !Math.hypot(...vector.slice(0, 1024))) fail(`embedding de consulta inválido para ${query.queryId}`)
    await appendFile(queryOutput, JSON.stringify({ queryId: query.queryId, inputType: 'query', vector2048: vector }) + '\n', 'utf8')
    queryVectors.set(query.queryId, vector)
  }
  const expectedQueryIds = new Set(queries.map(query => query.queryId))
  if (queryVectors.size !== expectedQueryIds.size || [...queryVectors.keys()].some(queryId => !expectedQueryIds.has(queryId))) fail('los embeddings de consulta no cubren exactamente las 50 consultas aprobadas')
}
console.log(JSON.stringify({ status: 'complete', corpusVersion: manifest.corpusVersion, model: EMBEDDING_MODEL, dimensions: 2048, completedChunks: completed.size, totalChunks: manifest.chunks.length, matrix: path.join(output, 'embeddings', 'matrix-2048.json'), checkpoint: checkpointPath, queryVectors: queryPath ? queryOutput : null, provider: session.report() }, null, 2))
