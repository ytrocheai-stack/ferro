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

const GEMINI_MODEL = 'gemini-3.5-flash-lite'
const QUERY_COUNT = 50
const DIMENSIONS = [512, 1024]
const REPETITIONS = 3
const REQUIRED_RESPONSES = QUERY_COUNT * DIMENSIONS.length * REPETITIONS
const resultPath = option('--results', '.cache/corpus/hevy/results.generated.json')
const reviewsPath = option('--reviews', '.cache/corpus/hevy/response-reviews.json')
const manifestPath = option('--manifest', '.cache/corpus/hevy/manifest.json')
const referencePath = option('--reference', '.cache/corpus/hevy/reference-final.json')
const outputPath = option('--output', '.cache/corpus/hevy/review-report.json')
const results = await read(resultPath)
const manifest = await read(manifestPath)
const reference = await read(referencePath)

const corpusFingerprint = sha256Hex(canonicalJson(manifest))
const benchmarkFingerprint = sha256Hex(canonicalJson(reference))
const resultWithoutFingerprint = structuredClone(results)
delete resultWithoutFingerprint.fingerprints
const resultFingerprint = sha256Hex(canonicalJson(resultWithoutFingerprint))

if (reference?.corpusVersion !== manifest?.corpusVersion || !Array.isArray(reference?.queries) || reference.queries.length !== QUERY_COUNT || new Set(reference.queries.map(query => query?.queryId)).size !== QUERY_COUNT) fail('manifiesto y benchmark deben ser los artefactos exactos con 50 consultas únicas')
if (results?.schema !== 'generated-benchmark-v4' || results.responseSchemaVersion !== 4 || results.corpusVersion !== manifest?.corpusVersion || results.benchmarkVersion !== reference?.version || results.execution !== 'remote-gemini-complete' || results.generationModel !== GEMINI_MODEL || results.authorization?.provider !== 'google-ai-studio' || results.authorization?.model !== GEMINI_MODEL || results.authorization?.accessVerified !== true || results.authorization?.budgetVerified !== true || results.authorization?.maxAdditionalCost !== 0 || results.repetitions !== REPETITIONS || results.formalRemoteResponsesRequired !== REQUIRED_RESPONSES || results.formalRemoteResponsesComplete !== REQUIRED_RESPONSES || !Array.isArray(results.runs) || results.runs.length !== REPETITIONS || results.fingerprints?.results !== resultFingerprint) fail('resultado incompatible: se requieren las 300 respuestas formales completas con instrucciones actuales de gemini-3.5-flash-lite, autorización verificada y huellas exactas del corpus y benchmark')

const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : []
const chunkById = new Map(chunks.map(chunk => [chunk?.id, chunk]))
const corpusIds = new Set(chunks.map(chunk => chunk?.id).filter(id => typeof id === 'string' && id.length > 0))
if (!chunks.length || corpusIds.size !== chunks.length) fail('manifiesto sin chunks válidos y únicos')
const sourceIds = new Set((Array.isArray(manifest.sources) ? manifest.sources : []).map(source => source?.id).filter(id => typeof id === 'string' && id.length > 0))
const queryIds = reference.queries.map(query => query.queryId)
const queryIdSet = new Set(queryIds)
for (const query of reference.queries) {
  if (!Array.isArray(query.relevantChunkIds) || query.relevantChunkIds.length === 0 || query.relevantChunkIds.some(id => !corpusIds.has(id))) fail(`referencia incompleta o ajena al corpus: ${query.queryId}`)
}

const reviews = await read(reviewsPath)
const reviewerId = typeof reviews?.reviewerId === 'string' ? reviews.reviewerId.trim() : ''
const generatorId = typeof reviews?.generatorId === 'string' ? reviews.generatorId.trim() : ''
if (!Array.isArray(reviews?.responses) || !reviewerId || !generatorId || reviewerId.toLowerCase() === generatorId.toLowerCase() || generatorId !== GEMINI_MODEL || !['human', 'agent'].includes(reviews.reviewerType) || reviews.independent !== true) fail('la revisión debe identificar un revisor humano o agente independiente, distinto del generador Gemini')
if (reviews.fingerprints?.corpus !== corpusFingerprint || reviews.fingerprints?.benchmark !== benchmarkFingerprint || reviews.fingerprints?.results !== resultFingerprint) fail('la revisión no está ligada a las huellas exactas del corpus, benchmark y resultado')
if (results.provider?.calls !== REQUIRED_RESPONSES || results.provider?.uncertainCalls !== 0) fail('el ledger Gemini no confirma 300 llamadas con consumo medido y sin incertidumbre')

const expected = []
const failures = []
const reviewCompletenessFailures = []
const semanticQualityFindings = []
const semanticQualityFields = ['contextFaithful', 'sportsCoherent', 'applicable', 'uncertaintyHandled']
const semanticQualityCounts = Object.fromEntries(semanticQualityFields.map(field => [field, { passed: 0, failed: 0, missing: 0 }]))
const queryById = new Map(reference.queries.map(query => [query.queryId, query]))
const responseUsage = { calls: 0, inputTokens: 0, outputTokens: 0 }
for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
  const run = results.runs[repetition]
  if (run?.repetition !== repetition) failures.push(`repetición inválida: se esperaba ${repetition}`)
  for (const dimensions of DIMENSIONS) {
    const items = run?.citations?.[dimensions]
    if (!Array.isArray(items) || items.length !== QUERY_COUNT) {
      failures.push(`${dimensions}: la repetición ${repetition} no contiene exactamente 50 respuestas`)
      continue
    }
    const seenQueries = new Set()
    for (const item of items) {
      if (!queryIdSet.has(item?.queryId) || seenQueries.has(item.queryId)) failures.push(`${dimensions}:${item?.queryId ?? 'sin queryId'}: query ausente, extra o duplicada`)
      seenQueries.add(item?.queryId)
      const usage = item?.usageMetadata
      const measured = usage && Number.isSafeInteger(usage.promptTokenCount) && usage.promptTokenCount >= 0 && Number.isSafeInteger(usage.candidatesTokenCount) && usage.candidatesTokenCount >= 0 && Number.isSafeInteger(usage.totalTokenCount) && usage.totalTokenCount >= usage.promptTokenCount + usage.candidatesTokenCount
      if (measured) {
        responseUsage.calls += 1
        responseUsage.inputTokens += usage.promptTokenCount
        responseUsage.outputTokens += usage.totalTokenCount - usage.promptTokenCount
      }
      const usageMatches = measured && item.usage?.inputTokens === usage.promptTokenCount && item.usage?.outputTokens === usage.totalTokenCount - usage.promptTokenCount
      if (item?.repetition !== repetition || item?.providerKind !== 'remote' || item?.retrievalSource !== 'remote-vectorize' || item?.parseError !== false || typeof item?.rawResponse !== 'string' || !item.rawResponse.trim() || typeof item?.responseText !== 'string' || !item.responseText.trim() || item.requestIdentity?.model !== GEMINI_MODEL || !/^[a-f0-9]{64}$/.test(item.requestIdentity?.fingerprint ?? '') || !usageMatches) failures.push(`${dimensions}:${item?.queryId}: respuesta sin procedencia Gemini, formato válido, identidad o uso medido`)
      const retrieved = item?.retrievedChunkIds
      const retrievedContext = item?.retrievedContext
      const contextIds = Array.isArray(retrievedContext) ? retrievedContext.map(chunk => chunk?.id) : []
      if (!Array.isArray(retrieved) || retrieved.length === 0 || !Array.isArray(retrievedContext) || new Set(retrieved).size !== retrieved.length || retrieved.some(id => !corpusIds.has(id)) || canonicalJson(contextIds) !== canonicalJson(retrieved) || retrievedContext.some(context => {
        const chunk = chunkById.get(context?.id)
        return !chunk || context.text !== chunk.text || !sourceIds.has(chunk.sourceId)
      })) failures.push(`${dimensions}:${item?.queryId}: contexto recuperado incompleto, duplicado o ajeno al corpus`)
      if (!Array.isArray(item?.claims) || item.claims.some(claim => !claim?.claimId || !claim.text?.trim()) || new Set((item.claims ?? []).map(claim => claim.claimId)).size !== (item.claims ?? []).length) failures.push(`${dimensions}:${item?.queryId}: claims generados incompletos o duplicados`)
      for (const claim of item?.claims ?? []) {
        const ids = claim.citedIds
        if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length || ids.some(id => !corpusIds.has(id)) || !Array.isArray(claim.rawCitedIds) || canonicalJson(claim.rawCitedIds) !== canonicalJson(ids) || !Array.isArray(claim.invalidCitedIds) || claim.invalidCitedIds.length > 0) failures.push(`${dimensions}:${item.queryId}:${claim.claimId}: cita ausente, inventada o alterada durante el parseo`)
      }
      expected.push({ queryId: item?.queryId, repetition, dimensions, fingerprint: responseFingerprint(item, dimensions, results.corpusVersion, results.benchmarkVersion), claims: item?.claims ?? [], source: item })
    }
    if (seenQueries.size !== QUERY_COUNT || queryIds.some(id => !seenQueries.has(id))) failures.push(`${dimensions}: la repetición ${repetition} no cubre las 50 consultas de referencia`)
  }
}
if (expected.length !== REQUIRED_RESPONSES) failures.push(`se esperaban ${REQUIRED_RESPONSES} respuestas, se encontraron ${expected.length}`)
if (responseUsage.calls !== REQUIRED_RESPONSES || results.provider?.inputTokens !== responseUsage.inputTokens || results.provider?.outputTokens !== responseUsage.outputTokens) failures.push('el uso agregado del proveedor no coincide con los 300 usageMetadata medidos')
if (canonicalJson(results.citations) !== canonicalJson(results.runs?.[0]?.citations)) failures.push('la copia resumida de citas no coincide con la primera repetición')

const reviewByKey = new Map()
for (const review of reviews.responses) {
  const key = `${review?.dimensions}:${review?.repetition}:${review?.queryId}:${review?.responseFingerprint}`
  if (reviewByKey.has(key)) {
    const message = `${review?.dimensions}:${review?.queryId}: revisión duplicada`
    failures.push(message)
    reviewCompletenessFailures.push(message)
  }
  else reviewByKey.set(key, review)
}
const expectedKeys = new Set()
const reviewedEntries = []
for (const item of expected) {
  const key = `${item.dimensions}:${item.repetition}:${item.queryId}:${item.fingerprint}`
  expectedKeys.add(key)
  const review = reviewByKey.get(key)
  if (!review) {
    const message = `${item.dimensions}:${item.queryId}: falta revisión vinculada a la respuesta`
    failures.push(message)
    reviewCompletenessFailures.push(message)
    continue
  }
  reviewedEntries.push({ item, review })
  if (review.reviewerId !== reviewerId || review.generatorId !== generatorId || typeof review.justification !== 'string' || !review.justification.trim() || typeof review.notes !== 'string' || !review.notes.trim()) {
    const message = `${item.dimensions}:${item.queryId}: identidad o notas de revisión incompletas`
    failures.push(message)
    reviewCompletenessFailures.push(message)
  }
  const falseChecks = []
  for (const field of semanticQualityFields) {
    if (typeof review[field] !== 'boolean') {
      semanticQualityCounts[field].missing += 1
      const message = `${item.dimensions}:${item.queryId}: falta el juicio booleano ${field}`
      failures.push(message)
      reviewCompletenessFailures.push(message)
    } else if (review[field] === true) semanticQualityCounts[field].passed += 1
    else {
      semanticQualityCounts[field].failed += 1
      falseChecks.push(field)
    }
  }
  if (falseChecks.length) semanticQualityFindings.push({ queryId: item.queryId, repetition: item.repetition, dimensions: item.dimensions, failedChecks: falseChecks, notes: review.notes ?? '' })
  if (review.allNewClaimsReviewed !== true) {
    const message = `${item.dimensions}:${item.queryId}: el revisor no confirma que revisó todos los claims`
    failures.push(message)
    reviewCompletenessFailures.push(message)
  }
  const claimReviews = review.claims
  if (!Array.isArray(claimReviews) || claimReviews.length !== item.claims.length || new Set(claimReviews.map(claim => claim?.claimId)).size !== item.claims.length || claimReviews.some(claim => !item.claims.some(sourceClaim => sourceClaim.claimId === claim?.claimId))) {
    const message = `${item.dimensions}:${item.queryId}: afirmaciones no cubiertas exactamente`
    failures.push(message)
    reviewCompletenessFailures.push(message)
    continue
  }
  for (const claim of item.claims) {
    const claimReview = claimReviews.find(candidate => candidate.claimId === claim.claimId)
    if (!Array.isArray(claimReview.supportedChunkIds) || new Set(claimReview.supportedChunkIds).size !== claimReview.supportedChunkIds.length || claimReview.supportedChunkIds.some(id => !corpusIds.has(id) || !claim.citedIds.includes(id))) {
      const message = `${item.dimensions}:${item.queryId}:${claim.claimId}: revisión de citas incompleta o con respaldo inválido`
      failures.push(message)
      reviewCompletenessFailures.push(message)
    }
  }
}
if (reviewByKey.size !== REQUIRED_RESPONSES || [...reviewByKey.keys()].some(key => !expectedKeys.has(key))) {
  const message = 'hay revisiones extra, ausentes o ligadas a otra respuesta'
  failures.push(message)
  reviewCompletenessFailures.push(message)
}
const reviewComplete = expected.length === REQUIRED_RESPONSES && reviewedEntries.length === REQUIRED_RESPONSES && reviewByKey.size === REQUIRED_RESPONSES && reviewCompletenessFailures.length === 0
if (!reviewComplete) failures.push('no se completó la revisión estructural de las 300 respuestas y todos sus claims/citas')
const semanticQualityTotal = REQUIRED_RESPONSES * semanticQualityFields.length
const semanticQualityPassedCount = semanticQualityFields.reduce((total, field) => total + semanticQualityCounts[field].passed, 0)
const semanticQualityScore = semanticQualityTotal ? semanticQualityPassedCount / semanticQualityTotal : 0
const semanticQualityPassed = reviewComplete && semanticQualityFindings.length === 0 && semanticQualityFields.every(field => semanticQualityCounts[field].missing === 0)
if (reviewComplete && !semanticQualityPassed) failures.push('la revisión completa registra hallazgos semánticos de calidad')

const ragGates = []
for (let repetition = 0; repetition < REPETITIONS; repetition += 1) for (const dimensions of DIMENSIONS) {
  const items = results.runs[repetition]?.citations?.[dimensions] ?? []
  let recall = 0
  let cited = 0
  let supported = 0
  for (const item of items) {
    const query = queryById.get(item.queryId)
    const retrieved = (item.retrievedChunkIds ?? []).slice(0, 5)
    recall += query?.relevantChunkIds?.length ? retrieved.filter(id => query.relevantChunkIds.includes(id)).length / query.relevantChunkIds.length : 0
    const fingerprint = responseFingerprint(item, dimensions, results.corpusVersion, results.benchmarkVersion)
    const reviewed = reviewedEntries.find(entry => entry.item.fingerprint === fingerprint && entry.item.repetition === repetition && entry.item.dimensions === dimensions)?.review
    for (const claim of item.claims ?? []) {
      const claimReview = reviewed?.claims?.find(candidate => candidate.claimId === claim.claimId)
      for (const id of claim.citedIds ?? []) { cited += 1; if (claimReview?.supportedChunkIds?.includes(id)) supported += 1 }
    }
  }
  const recallAt5 = items.length ? recall / items.length : 0
  const citationPrecision = cited ? supported / cited : 0
  ragGates.push({ repetition, dimensions, queries: items.length, recallAt5, citationPrecision, passes: items.length === QUERY_COUNT && recallAt5 >= 0.8 && citationPrecision >= 0.9 })
}
if (ragGates.length !== 6 || ragGates.some(gate => !gate.passes)) failures.push('Recall@5 y precisión de citas no superan los umbrales en cada repetición y dimensión')
const byDimension = dimensions => ragGates.filter(gate => gate.dimensions === dimensions)
const average = (items, field) => items.length ? items.reduce((sum, item) => sum + item[field], 0) / items.length : 0
const dimensionComparison = { recall512: average(byDimension(512), 'recallAt5'), recall1024: average(byDimension(1024), 'recallAt5'), precision512: average(byDimension(512), 'citationPrecision'), precision1024: average(byDimension(1024), 'citationPrecision') }
dimensionComparison.recallGain = dimensionComparison.recall1024 - dimensionComparison.recall512
dimensionComparison.improvesAtLeastThreePoints = dimensionComparison.recallGain >= 0.03
dimensionComparison.noPrecisionDrop = dimensionComparison.precision1024 >= dimensionComparison.precision512

const report = { schema: 'hevy-independent-review-v1', reviewedAt: new Date().toISOString(), corpusVersion: results.corpusVersion, benchmarkVersion: results.benchmarkVersion, fingerprints: { corpus: corpusFingerprint, benchmark: benchmarkFingerprint, results: resultFingerprint }, resultFingerprint, reviewsFingerprint: sha256Hex(canonicalJson(reviews)), reviewerId, reviewerType: reviews.reviewerType, independentReviewer: reviews.independent, generatorId, responses: expected.length, reviewedResponses: reviewedEntries.length, reviewComplete, semanticQuality: { passed: semanticQualityPassed, score: semanticQualityScore, checks: semanticQualityCounts, findings: semanticQualityFindings }, ragGates, dimensionComparison, complete: failures.length === 0, failures }
const output = await write(outputPath, report)
console.log(JSON.stringify({ output, ...report }, null, 2))
if (!report.complete) process.exitCode = 1
