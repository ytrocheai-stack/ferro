#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { assertPhysicalId, canonicalJson, corpusMetadataKey, corpusNamespace, PHYSICAL_ID_SCHEMA_VERSION, sha256Base64url, utf8ByteLength, vectorPhysicalId } from '../packages/corpus-identity/src/index.mjs'
import { evaluateBenchmark } from '../packages/corpus-evaluation/src/index.mjs'

const root = path.resolve(import.meta.dirname, '..')
const manifestPath = path.resolve(process.argv[2] ?? path.join(root, 'worker', 'corpus', 'manifest.json'))
const command = process.argv[3] ?? 'validate'
const args = process.argv.slice(4)
const maxMetadataBytes = 10 * 1024
const batchSize = 1_000

function option(name) {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

function fail(message) { throw new Error(`Corpus inválido: ${message}`) }
function sha256Hex(value) { return createHash('sha256').update(value).digest('hex') }

function validateGeneratedAuditTrail(results) {
  if (results?.schema !== 'generated-benchmark-v1') return
  if (results.repetitions !== 3 || !Array.isArray(results.runs) || results.runs.length !== 3) fail('la evaluación generada debe conservar exactamente tres repeticiones')
  const sets = [results.citations, ...results.runs.map(run => run.citations)]
  for (const set of sets) for (const dimension of ['512', '1024']) for (const item of set?.[dimension] ?? []) {
    if (typeof item.rawResponse !== 'string' || !item.rawResponse.trim() || item.parseError === true) fail(`la respuesta original de ${dimension}/${item.queryId} falta o no es JSON válido`)
    for (const claim of item.claims ?? []) {
      if (!Array.isArray(claim.rawCitedIds) || !Array.isArray(claim.invalidCitedIds)) fail(`la auditoría de citas de ${dimension}/${item.queryId}/${claim.claimId} está incompleta`)
      if (claim.invalidCitedIds.length || claim.rawCitedIds.some(id => !manifest.chunks.some(chunk => chunk.id === id))) fail(`la respuesta contiene citas inválidas en ${dimension}/${item.queryId}/${claim.claimId}`)
    }
  }
}

function metadataFor(chunk, source, corpusVersion) {
  return { chunkId: chunk.id, sourceId: chunk.sourceId, textHash: chunk.textHash ?? sha256Hex(chunk.text), author: source.author, source: source.title, title: source.title, url: source.url, license: source.license, evidenceLevel: String(source.evidenceLevel ?? 0), language: source.language, text: chunk.text, location: chunk.location ?? chunk.section ?? 'unknown', section: chunk.section ?? chunk.location ?? 'unknown', retrievalClass: chunk.retrievalClass ?? 'evidence', collection: chunk.collection ?? source.collection ?? 'scientific', population: (chunk.population ?? source.population ?? ['unknown']).join(','), populationReviewed: String(chunk.populationReviewed ?? source.populationReviewed ?? false), corpusVersion, corpusKey: corpusMetadataKey(corpusVersion) }
}
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
if (!manifest || !['proposal', 'approved'].includes(manifest.status) || typeof manifest.corpusVersion !== 'string' || !Array.isArray(manifest.sources) || !Array.isArray(manifest.chunks)) fail('faltan corpusVersion, sources o chunks')

const sources = new Map()
for (const source of manifest.sources) {
  if (!source || typeof source !== 'object' || !source.id || !source.author || !source.title || !source.url || !source.license || !source.language || typeof source.approved !== 'boolean') fail(`fuente incompleta: ${source?.id ?? 'sin id'}`)
  if (sources.has(source.id)) fail(`fuente duplicada: ${source.id}`)
  sources.set(source.id, source)
}

for (const chunk of manifest.chunks) {
  if (!chunk?.id || !chunk.sourceId || typeof chunk.text !== 'string' || !chunk.text.trim()) fail(`chunk incompleto: ${chunk?.id ?? 'sin id'}`)
  const source = sources.get(chunk.sourceId)
  if (!source) fail(`chunk ${chunk.id} referencia una fuente inexistente`)
  if (!source.approved) fail(`chunk ${chunk.id} usa una fuente no aprobada`)
  const metadata = canonicalJson(metadataFor(chunk, source, manifest.corpusVersion))
  if (utf8ByteLength(metadata) > maxMetadataBytes) fail(`metadata demasiado grande en ${chunk.id}`)
  assertPhysicalId(corpusNamespace(manifest.corpusVersion, 512), 'Namespace')
  assertPhysicalId(corpusNamespace(manifest.corpusVersion, 1024), 'Namespace')
  assertPhysicalId(vectorPhysicalId(manifest.corpusVersion, chunk.id), 'ID de vector')
}

const readyToImport = manifest.status === 'approved' && manifest.chunks.length > 0 && manifest.chunks.every((chunk) => sources.get(chunk.sourceId)?.approved)

if (command === 'report') {
  console.log(JSON.stringify({ corpusVersion: manifest.corpusVersion, status: manifest.status, sources: manifest.sources.length, approvedSources: manifest.sources.filter((source) => source.approved).length, chunks: manifest.chunks.length, readyToImport }, null, 2))
} else if (command === 'import') {
  const checkpointPath = option('--checkpoint')
  let checkpoint = { schema: PHYSICAL_ID_SCHEMA_VERSION, corpusVersion: manifest.corpusVersion, completedIds: [] }
  if (checkpointPath) {
    try {
      checkpoint = JSON.parse(await fs.readFile(path.resolve(checkpointPath), 'utf8'))
      if (checkpoint.schema !== PHYSICAL_ID_SCHEMA_VERSION || checkpoint.corpusVersion !== manifest.corpusVersion || !Array.isArray(checkpoint.completedIds)) fail('el checkpoint no corresponde al esquema físico o versión del corpus')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  const validIds = new Set(manifest.chunks.map((chunk) => chunk.id))
  const completedIds = new Set(checkpoint.completedIds.filter((id) => validIds.has(id)))
  const complete = (option('--complete') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  for (const id of complete) {
    if (!validIds.has(id)) fail(`--complete referencia un chunk inexistente: ${id}`)
    completedIds.add(id)
  }
  const pendingIds = manifest.chunks.map((chunk) => chunk.id).filter((id) => !completedIds.has(id))
  const batches = []
  for (let index = 0; index < pendingIds.length; index += batchSize) batches.push(pendingIds.slice(index, index + batchSize))
  if (checkpointPath) {
    const target = path.resolve(checkpointPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify({ schema: PHYSICAL_ID_SCHEMA_VERSION, corpusVersion: manifest.corpusVersion, completedIds: [...completedIds].sort(), updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
  }
  console.log(JSON.stringify({ mode: 'checkpointed-import', physicalIdSchema: PHYSICAL_ID_SCHEMA_VERSION, corpusVersion: manifest.corpusVersion, readyToImport, namespace: { primary: corpusNamespace(manifest.corpusVersion, 512), evaluation1024: corpusNamespace(manifest.corpusVersion, 1024) }, batchSize, totalChunks: manifest.chunks.length, completedChunks: completedIds.size, pendingChunks: pendingIds.length, batches, checkpoint: checkpointPath ? path.resolve(checkpointPath) : null, providerExecution: 'disabled; los embeddings/upserts se ejecutan únicamente desde el importador autorizado' }, null, 2))
} else if (command === 'validate') {
  console.log(`Manifest válido: ${manifest.sources.length} fuentes, ${manifest.chunks.length} chunks, versión ${manifest.corpusVersion}.`)
} else if (command === 'evaluate') {
  const resultsPath = option('--results')
  if (!resultsPath) fail('evaluate requiere --results <json>')
  const results = JSON.parse(await fs.readFile(path.resolve(resultsPath), 'utf8'))
  validateGeneratedAuditTrail(results)
  const evaluationQueriesPath = path.resolve(option('--reference') ?? path.join(path.dirname(manifestPath), 'evaluation-queries.json'))
  let evaluationQueries
  try { evaluationQueries = JSON.parse(await fs.readFile(evaluationQueriesPath, 'utf8')) } catch { fail('falta evaluation-queries.json para fijar el universo de consultas') }
  let report
  try {
    report = evaluateBenchmark(evaluationQueries, manifest, results)
  } catch (error) {
    report = {
      benchmarkVersion: evaluationQueries?.version ?? null,
      corpusVersion: manifest.corpusVersion,
      queries: Array.isArray(evaluationQueries?.queries) ? evaluationQueries.queries.length : 0,
      coverageComplete: false,
      baseGate: false,
      dimensionGate1024: false,
      fingerprints: { manifest: sha256Base64url(canonicalJson(manifest)), reference: null, results: sha256Base64url(canonicalJson(results)) },
      errors: [error instanceof Error ? error.message.replace(/^Evaluación inválida:\s*/, '') : 'falló la validación compartida'],
    }
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.baseGate) fail('la evaluación no puede aprobarse sin corpus listo, referencia aprobada, Recall@5 ≥80% y precisión ≥90%')
} else {
  fail(`comando desconocido: ${command}`)
}
