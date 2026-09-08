#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { canonicalJson, sha256Hex } from '../packages/corpus-identity/src/index.mjs'
import { responseFingerprint } from '../packages/corpus-evaluation/src/index.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(name); const value = index < 0 ? undefined : args[index + 1]; return value && !value.startsWith('--') ? value : fallback }
const root = path.resolve(import.meta.dirname, '..')
const read = async file => JSON.parse(await fs.readFile(path.resolve(root, file), 'utf8'))
const write = async (file, value) => { const target = path.resolve(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8'); return target }
const fail = message => { throw new Error(`corpus:review: ${message}`) }

const resultPath = option('--results', '.cache/corpus/hevy/results.kimi-k3-generated.json')
const reviewsPath = option('--reviews', '.cache/corpus/hevy/response-reviews.json')
const manifestPath = option('--manifest', '.cache/corpus/hevy/manifest.json')
const referencePath = option('--reference', '.cache/corpus/hevy/reference-final.json')
const outputPath = option('--output', '.cache/corpus/hevy/review-report.json')
const results = await read(resultPath)
const manifest = await read(manifestPath)
const reference = await read(referencePath)
if (results?.schema !== 'generated-benchmark-v1' || results.corpusVersion !== manifest?.corpusVersion || results.benchmarkVersion !== reference?.version || results.execution !== 'remote-flash' || results.authorization?.model !== 'moonshotai/kimi-k3' || results.repetitions !== 3 || results.provider?.calls !== 300 || !Array.isArray(results.runs) || results.runs.length !== 3) fail('resultados incompatibles: se requieren 300 respuestas Flash remotas de moonshotai/kimi-k3 en tres repeticiones del corpus y benchmark exactos')
const reviews = await read(reviewsPath)
if (!Array.isArray(reviews?.responses) || !reviews.reviewerId?.trim() || !reviews.generatorId?.trim() || reviews.reviewerId === reviews.generatorId) fail('revisor y generador deben estar identificados y ser distintos')
const corpusIds = new Set((manifest.chunks ?? []).map(chunk => chunk.id))
const expected = []
for (const run of results.runs) for (const dimensions of [512, 1024]) for (const item of run.citations?.[dimensions] ?? []) expected.push({ queryId: item.queryId, repetition: run.repetition, dimensions, fingerprint: responseFingerprint(item, dimensions, results.corpusVersion, results.benchmarkVersion), claims: item.claims ?? [], source: item })
if (expected.length !== 300) fail(`se esperaban 300 respuestas, se encontraron ${expected.length}`)
const seen = new Set()
const failures = []
const reviewedEntries = []
for (const item of expected) {
  const matches = reviews.responses.filter(review => review.responseFingerprint === item.fingerprint && review.queryId === item.queryId && Number(review.repetition) === item.repetition && Number(review.dimensions) === item.dimensions)
  if (matches.length !== 1) { failures.push(`${item.dimensions}:${item.queryId}: falta una revisión única`); continue }
  const review = matches[0]
  seen.add(item.fingerprint)
  reviewedEntries.push({ item, review })
  if (item.source?.providerKind !== 'remote' || item.source?.retrievalSource !== 'remote-vectorize' || item.source?.parseError === true || !item.source?.rawResponse?.trim()) failures.push(`${item.dimensions}:${item.queryId}: la respuesta no proviene de Flash remoto con evidencia remota o no conserva el original`)
  if (review.reviewerId !== reviews.reviewerId || review.generatorId !== reviews.generatorId || !review.justification?.trim() || !review.notes?.trim() || review.contextFaithful !== true || review.sportsCoherent !== true || review.applicable !== true || review.uncertaintyHandled !== true || review.allNewClaimsReviewed !== true) failures.push(`${item.dimensions}:${item.queryId}: revisión incompleta`)
  if (!Array.isArray(review.claims) || review.claims.length !== item.claims.length || new Set(review.claims.map(claim => claim.claimId)).size !== item.claims.length) { failures.push(`${item.dimensions}:${item.queryId}: afirmaciones no cubiertas`); continue }
  for (const claim of item.claims) {
    if (!Array.isArray(claim.rawCitedIds) || !Array.isArray(claim.invalidCitedIds) || claim.invalidCitedIds.length > 0 || claim.rawCitedIds.some(id => !corpusIds.has(id))) failures.push(`${item.dimensions}:${item.queryId}:${claim.claimId}: la respuesta conserva una cita inválida o inventada`)
    const claimReview = review.claims.find(candidate => candidate.claimId === claim.claimId)
    if (!claimReview || !Array.isArray(claimReview.supportedChunkIds) || claimReview.supportedChunkIds.some(id => !corpusIds.has(id))) failures.push(`${item.dimensions}:${item.queryId}:${claim.claimId}: respaldo inválido`)
  }
}
if (seen.size !== expected.length) failures.push('hay huellas de respuesta duplicadas o ausentes')
const queryById = new Map(reference.queries.map(query => [query.queryId, query]))
const ragGates = []
for (let repetition = 0; repetition < 3; repetition += 1) for (const dimensions of [512, 1024]) {
  const items = results.runs[repetition].citations?.[dimensions] ?? []
  let recall = 0
  let cited = 0
  let supported = 0
  for (const item of items) {
    const query = queryById.get(item.queryId)
    const retrieved = (item.retrievedChunkIds ?? []).slice(0, 5)
    recall += query?.relevantChunkIds?.length ? retrieved.filter(id => query.relevantChunkIds.includes(id)).length / query.relevantChunkIds.length : 0
    const reviewed = reviewedEntries.find(entry => entry.item.fingerprint === responseFingerprint(item, dimensions, results.corpusVersion, results.benchmarkVersion))?.review
    for (const claim of item.claims ?? []) {
      const claimReview = reviewed?.claims?.find(candidate => candidate.claimId === claim.claimId)
      for (const id of claim.citedIds ?? []) { cited += 1; if (claimReview?.supportedChunkIds?.includes(id)) supported += 1 }
    }
  }
  const recallAt5 = items.length ? recall / items.length : 0
  const citationPrecision = cited ? supported / cited : 0
  ragGates.push({ repetition, dimensions, queries: items.length, recallAt5, citationPrecision, passes: items.length === 50 && recallAt5 >= 0.8 && citationPrecision >= 0.9 })
}
if (ragGates.some(gate => !gate.passes)) failures.push('Recall@5 y precisión de citas no superan los umbrales en cada repetición')
const byDimension = dimensions => ragGates.filter(gate => gate.dimensions === dimensions)
const average = (items, field) => items.length ? items.reduce((sum, item) => sum + item[field], 0) / items.length : 0
const dimensionComparison = { recall512: average(byDimension(512), 'recallAt5'), recall1024: average(byDimension(1024), 'recallAt5'), precision512: average(byDimension(512), 'citationPrecision'), precision1024: average(byDimension(1024), 'citationPrecision') }
dimensionComparison.recallGain = dimensionComparison.recall1024 - dimensionComparison.recall512
dimensionComparison.improvesAtLeastThreePoints = dimensionComparison.recallGain >= 0.03
dimensionComparison.noPrecisionDrop = dimensionComparison.precision1024 >= dimensionComparison.precision512
const resultWithoutFingerprint = structuredClone(results)
delete resultWithoutFingerprint.fingerprints
const report = { schema: 'hevy-independent-review-v1', reviewedAt: new Date().toISOString(), corpusVersion: results.corpusVersion, benchmarkVersion: results.benchmarkVersion, resultFingerprint: results.fingerprints?.results ?? sha256Hex(canonicalJson(resultWithoutFingerprint)), reviewsFingerprint: sha256Hex(canonicalJson(reviews)), reviewerId: reviews.reviewerId, generatorId: reviews.generatorId, responses: expected.length, reviewedResponses: seen.size, ragGates, dimensionComparison, complete: failures.length === 0, failures }
const output = await write(outputPath, report)
console.log(JSON.stringify({ output, ...report }, null, 2))
if (!report.complete) process.exitCode = 1
