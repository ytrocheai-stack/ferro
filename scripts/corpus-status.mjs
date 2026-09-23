#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { canonicalJson, corpusMetadataKey, sha256Hex } from '../packages/corpus-identity/src/index.mjs'
import { scientificReviewReady } from '../packages/corpus-evaluation/src/scientific-review.mjs'
import { responseFingerprint } from '../packages/corpus-evaluation/src/index.mjs'

const filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(filename), '..')
const EXPECTED_SOURCE_COUNT = 88
const EXPECTED_CHUNK_COUNT = 2708
const EMBEDDING_DIMENSIONS = 2048
const EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b'
const GEMINI_MODEL = 'gemini-3.5-flash-lite'
const READINESS_STAGES = ['preflight', 'evaluation', 'canary', 'closure']
export const CANDIDATE_FLAGS = { ENABLE_BETA: false, ENABLE_EMBEDDINGS: true, ENABLE_FLASH: false, ENABLE_GEMINI: true, ENABLE_NVIDIA: false, ENABLE_COACH_STREAMING: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
const CLOSED_FLAGS = { ENABLE_BETA: false, ENABLE_EMBEDDINGS: false, ENABLE_FLASH: false, ENABLE_GEMINI: false, ENABLE_NVIDIA: false, ENABLE_COACH_STREAMING: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function fileSha256(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }

function safeChangedPath(value) {
  return value && !/^\.env(?:\.|$)/i.test(value) && !/(?:^|[\\/])\.cache(?:[\\/]|$)/.test(value) && !/(?:^|[\\/])node_modules(?:[\\/]|$)/.test(value) && !/(?:^|[\\/])dist(?:[\\/]|$)/.test(value)
}

/** Snapshot project files relative to HEAD, or to a candidate's recorded base commit. */
export function workingTreeSnapshot(baseCommit) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd()
  const head = git(['rev-parse', 'HEAD'])
  if (baseCommit !== undefined && !/^[a-f0-9]{40,64}$/i.test(baseCommit)) throw new Error('El commit base del expediente no es un hash Git válido')
  const commit = baseCommit ?? head
  const status = git(['status', '--porcelain=v1'])
  const tracked = git(['diff', '--name-only', commit])
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
  const changedFiles = [...new Set([...tracked.split(/\r?\n/), ...untracked.split(/\r?\n/)].filter(safeChangedPath))].sort()
  const changedFileHashes = Object.fromEntries(changedFiles.map(file => {
    try { return [file, fileSha256(path.resolve(root, file))] }
    catch { return [file, 'deleted'] }
  }))
  return {
    commit,
    workingTreeDirty: Boolean(status),
    changedFiles,
    changedFileHashes,
    workingTreeFingerprint: sha256Hex(canonicalJson(changedFileHashes)),
  }
}

function isFresh(value, now, maxAgeMs) {
  const timestamp = Date.parse(value ?? '')
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs
}

export function productionAllowlist(config) {
  const match = config.match(/^ALLOWED_CLERK_IDS\s*=\s*"([^"]*)"\s*$/m)
  const ids = match?.[1].split(',').map(value => value.trim()).filter(Boolean) ?? []
  return ids.length === 1 ? ids[0] : null
}

export function productionFlagValues(config) {
  return Object.fromEntries(Object.keys(CANDIDATE_FLAGS).map(name => {
    const value = config.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"\\s*$`, 'm'))?.[1]
    return [name, value === 'true' ? true : value === 'false' ? false : null]
  }))
}

export function benchmarkArtifacts(base, manifest, reference) {
  const files = (() => { try { return fs.readdirSync(base).filter(file => /^results(?:\..+)?\.json(?:\.checkpoint)?$/.test(file)) } catch { return [] } })()
  const resultCandidates = files.filter(file => !file.endsWith('.checkpoint.json')).map(file => ({ file, value: read(path.join(base, file)) })).filter(item => item.value?.schema === 'generated-benchmark-v1' && item.value.corpusVersion === manifest?.corpusVersion && item.value.benchmarkVersion === reference?.version && item.value.execution === 'remote-gemini-complete' && item.value.generationModel === GEMINI_MODEL && item.value.model === EMBEDDING_MODEL && item.value.formalRemoteResponsesRequired === 300 && item.value.formalRemoteResponsesComplete === 300 && item.value.repetitions === 3 && item.value.provider?.calls === 300 && item.value.provider?.uncertainCalls === 0)
  const errors = []
  if (resultCandidates.length > 1) errors.push('hay varios resultados benchmark Gemini compatibles; seleccionar explícitamente uno')
  const result = resultCandidates.length === 1 ? resultCandidates[0] : null
  const checkpointPath = result ? path.join(base, `${result.file}.checkpoint.json`) : null
  return { result: result?.value ?? null, resultPath: result ? path.join(base, result.file) : null, checkpoint: checkpointPath ? read(checkpointPath) : null, checkpointPath, errors }
}

function asInteger(value) {
  return Number.isInteger(value) ? value : Number(value)
}

function embeddingEvidence(manifest, matrix, checkpoint) {
  const errors = []
  const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : []
  const expected = new Map(chunks.map(chunk => [chunk.id, chunk]))
  if (!matrix) errors.push('falta embeddings/matrix-2048.json')
  if (!checkpoint) errors.push('falta embeddings/checkpoint.json')
  if (matrix && (matrix.corpusVersion !== manifest?.corpusVersion || matrix.model !== EMBEDDING_MODEL || matrix.dimensions !== EMBEDDING_DIMENSIONS)) errors.push('matriz incompatible con corpus, modelo o dimensiones')
  if (checkpoint && (checkpoint.corpusVersion !== manifest?.corpusVersion || checkpoint.dimensions !== EMBEDDING_DIMENSIONS)) errors.push('checkpoint de embeddings incompatible')
  const documents = Array.isArray(matrix?.documents) ? matrix.documents : []
  const completedIds = Array.isArray(checkpoint?.completedIds) ? checkpoint.completedIds : []
  const seen = new Set()
  for (const document of documents) {
    if (!document?.id || seen.has(document.id) || !expected.has(document.id)) { errors.push(`documento de embedding inválido: ${document?.id ?? 'sin id'}`); continue }
    seen.add(document.id)
    const vector = document.vector2048
    if (document.inputType !== 'passage') errors.push(`input_type de passage inválido: ${document.id}`)
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) errors.push(`vector inválido: ${document.id}`)
    const expectedHash = expected.get(document.id)?.textHash
    if (!expectedHash || document.textHash !== expectedHash) errors.push(`textHash no coincide: ${document.id}`)
    const norm512 = Math.hypot(...(vector ?? []).slice(0, 512))
    const norm1024 = Math.hypot(...(vector ?? []).slice(0, 1024))
    if (!Number.isFinite(norm512) || norm512 === 0) errors.push(`norma 512 inválida: ${document.id}`)
    if (!Number.isFinite(norm1024) || norm1024 === 0) errors.push(`norma 1024 inválida: ${document.id}`)
  }
  if (documents.length !== chunks.length) errors.push(`matriz incompleta: ${documents.length}/${chunks.length}`)
  if (completedIds.length !== chunks.length || new Set(completedIds).size !== completedIds.length || completedIds.some(id => !expected.has(id))) errors.push('checkpoint no confirma exactamente todos los chunks')
  return { ok: errors.length === 0, errors, count: documents.length, fingerprint: matrix?.fingerprint ?? null }
}

function queryEmbeddingEvidence(reference, queryVectors) {
  const errors = []
  const queries = Array.isArray(reference?.queries) ? reference.queries : []
  if (!queryVectors || queries.length !== 50) errors.push('falta referencia de 50 consultas para validar embeddings de query')
  const expected = new Set(queries.map(query => query.queryId))
  const seen = new Set()
  for (const item of queryVectors ?? []) {
    if (!item?.queryId || seen.has(item.queryId) || !expected.has(item.queryId)) { errors.push(`embedding de query inválido: ${item?.queryId ?? 'sin id'}`); continue }
    seen.add(item.queryId)
    if (item.inputType !== 'query') errors.push(`input_type de query inválido: ${item.queryId}`)
    const vector = item.vector2048
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) errors.push(`vector de query inválido: ${item.queryId}`)
    if (!Number.isFinite(Math.hypot(...(vector ?? []).slice(0, 512))) || !Math.hypot(...(vector ?? []).slice(0, 512))) errors.push(`norma query 512 inválida: ${item.queryId}`)
    if (!Number.isFinite(Math.hypot(...(vector ?? []).slice(0, 1024))) || !Math.hypot(...(vector ?? []).slice(0, 1024))) errors.push(`norma query 1024 inválida: ${item.queryId}`)
  }
  if (seen.size !== expected.size || seen.size !== 50) errors.push(`embeddings de query incompletos: ${seen.size}/50`)
  return { ok: errors.length === 0, errors, count: seen.size }
}

export function uploadEvidence(manifest, checkpoint, remote, now = Date.now()) {
  const errors = []
  if (!checkpoint || checkpoint.corpusVersion !== manifest?.corpusVersion) errors.push('falta upload-checkpoint compatible')
  if (checkpoint && (checkpoint.completedIds?.length !== EXPECTED_CHUNK_COUNT || new Set(checkpoint.completedIds).size !== EXPECTED_CHUNK_COUNT)) errors.push('checkpoint de carga incompleto')
  if (!remote) errors.push('falta remote-verification.json')
  const expected = { sources: EXPECTED_SOURCE_COUNT, chunks: EXPECTED_CHUNK_COUNT, vectors512: EXPECTED_CHUNK_COUNT, vectors1024: EXPECTED_CHUNK_COUNT }
  for (const [key, value] of Object.entries(expected)) if (remote && asInteger(remote[key]) !== value) errors.push(`verificación remota ${key} inválida`)
  if (remote && remote.corpusVersion !== manifest?.corpusVersion) errors.push('verificación remota de otra versión')
  if (remote && !isFresh(remote.verifiedAt, now, 30 * 24 * 60 * 60 * 1000)) errors.push('la verificación remota está ausente, es futura o tiene más de 30 días')
  if (remote && remote.schema !== 'hevy-remote-verification-v2') errors.push('falta comparación remota/local con el esquema de verificación v2')
  if (remote && remote.queriesComplete !== true) errors.push('las 50 consultas no fueron verificadas remotamente')
  if (remote && remote.filtersMatchWorker !== true) errors.push('los filtros remotos no coinciden con Worker')
  if (remote && remote.idsVerified !== true) errors.push('las identidades y relaciones D1/Vectorize no fueron verificadas')
  if (remote && remote.hashesVerified !== true) errors.push('los hashes D1 y de fuentes no fueron verificados')
  if (remote && remote.legacyIndexVerified !== true) errors.push('el índice legado 768 no fue verificado y preservado')
  if (remote && asInteger(remote.identityMismatches) !== 0) errors.push('hay identidades remotas incoherentes')
  if (remote && asInteger(remote.excludedEvidence) !== 0) errors.push('la recuperación remota devolvió evidencia excluida')
  if (remote && remote.namespaces?.primary !== remote.expectedNamespaces?.primary) errors.push('namespace primario no verificado')
  if (remote && remote.namespaces?.evaluation1024 !== remote.expectedNamespaces?.evaluation1024) errors.push('namespace 1024 no verificado')
  if (remote && (Number(remote.dimensions?.primary) !== 512 || Number(remote.dimensions?.evaluation1024) !== 1024 || Number(remote.dimensions?.legacy768) !== 768)) errors.push('dimensiones remotas 512/1024/768 no verificadas')
  if (remote && (!Array.isArray(remote.queryComparisons) || remote.queryComparisons.length !== 50 || remote.queryComparisons.some(comparison => typeof comparison?.queryId !== 'string' || typeof comparison?.localRemoteMatch512 !== 'boolean' || typeof comparison?.localRemoteMatch1024 !== 'boolean' || !Array.isArray(comparison?.local512) || !Array.isArray(comparison?.local1024) || !Array.isArray(comparison?.remote512) || comparison.remote512.length < 5 || !Array.isArray(comparison?.remote1024) || comparison.remote1024.length < 5))) errors.push('las comparaciones top-5 local/remoto no tienen cobertura o recuperación remota suficiente')
  if (remote && manifest?.corpusVersion && Array.isArray(remote.queryComparisons) && remote.queryComparisons.some(comparison => comparison?.filter?.corpusKey !== corpusMetadataKey(manifest.corpusVersion))) errors.push('las consultas remotas no usan la clave compacta de corpus')
  return { ok: errors.length === 0, errors, remoteVerifiedAt: remote?.verifiedAt ?? null }
}

export function benchmarkEvidence(manifest, reference, result, reviewReport, checkpoint, reviews, selectionErrors = [], now = Date.now()) {
  const errors = [...selectionErrors]
  if (!reference || reference.corpusVersion !== manifest?.corpusVersion || reference.status !== 'approved' || reference.queries?.length !== 50) errors.push('benchmark no aprobado, ligado o completo')
  if (!scientificReviewReady(reference)) errors.push('falta aprobación científica completa: relevantes, negativos, afirmaciones, población/aplicabilidad, exclusiones y fecha')
  if (reference && !isFresh(reference.scientificReview?.reviewedAt, now, 30 * 24 * 60 * 60 * 1000)) errors.push('la revisión científica de las consultas está ausente, es futura o tiene más de 30 días')
  const resultWithoutFingerprint = result ? structuredClone(result) : null
  if (resultWithoutFingerprint) delete resultWithoutFingerprint.fingerprints
  const calculatedResultFingerprint = resultWithoutFingerprint ? sha256Hex(canonicalJson(resultWithoutFingerprint)) : null
  if (!result || result.corpusVersion !== manifest?.corpusVersion || result.execution !== 'remote-gemini-complete' || result.generationModel !== GEMINI_MODEL || result.model !== EMBEDDING_MODEL) errors.push('evaluación Gemini remota completa ausente o con modelos incompatibles')
  if (result?.execution === 'remote-gemini-complete' && (result.authorization?.provider !== 'google-ai-studio' || result.authorization?.accessVerified !== true || result.authorization?.budgetVerified !== true || result.authorization?.maxAdditionalCost !== 0 || result.authorization?.model !== GEMINI_MODEL || result.authorization?.embeddingModel !== EMBEDDING_MODEL || result.provider?.calls !== 300 || result.provider?.uncertainCalls !== 0 || result.formalRemoteResponsesRequired !== 300 || result.formalRemoteResponsesComplete !== 300)) errors.push('el benchmark Gemini no conserva autorización de coste cero, 300 respuestas medidas o consumo incierto cero')
  if (result && result.fingerprints?.results !== calculatedResultFingerprint) errors.push('la huella del benchmark Gemini no coincide con sus resultados')
  if (result && result.repetitions !== 3) errors.push('evaluación no ejecutada con tres repeticiones')
  if (result && (result.retrievalVerification?.schema !== 'hevy-remote-verification-v2' || result.retrievalVerification.filtersVerified !== true || result.retrievalVerification.queryComparisons?.length !== 50)) errors.push('las respuestas no están ligadas a recuperación remota verificada')
  const responseRows = (result?.runs ?? []).flatMap(run => [512, 1024].flatMap(dimensions => (run?.citations?.[dimensions] ?? []).map(item => ({ item, dimensions, repetition: run?.repetition }))))
  const expectedReviewKeys = new Set(responseRows.map(({ item, dimensions, repetition }) => `${dimensions}:${repetition}:${item?.queryId}:${item && typeof item === 'object' ? responseFingerprint(item, dimensions, result?.corpusVersion, result?.benchmarkVersion) : 'invalid-response'}`))
  const actualReviewKeys = new Set((reviews?.responses ?? []).map(item => `${item?.dimensions}:${item?.repetition}:${item?.queryId}:${item?.responseFingerprint}`))
  const reviewerIdentityMatches = Boolean(reviews && reviewReport && reviews.schema === 'hevy-response-reviews-v1' && ['human', 'agent'].includes(reviews.reviewerType) && reviewReport.reviewerType === reviews.reviewerType && reviews.independent === true && reviews.reviewerId === reviewReport.reviewerId && reviews.reviewerId !== GEMINI_MODEL && reviews.generatorId === GEMINI_MODEL && Array.isArray(reviews.responses) && reviews.responses.length === 300 && expectedReviewKeys.size === 300 && actualReviewKeys.size === 300 && [...expectedReviewKeys].every(key => actualReviewKeys.has(key)) && reviews.responses.every(item => item?.reviewerId === reviews.reviewerId && item?.generatorId === GEMINI_MODEL && item?.justification?.trim() && item?.notes?.trim() && item.contextFaithful === true && item.sportsCoherent === true && item.applicable === true && item.uncertaintyHandled === true && item.allNewClaimsReviewed === true && Array.isArray(item.claims)))
  if (!reviewReport || reviewReport.schema !== 'hevy-independent-review-v1' || reviewReport.complete !== true || !['human', 'agent'].includes(reviewReport.reviewerType) || reviewReport.independentReviewer !== true || reviewReport.responses !== 300 || reviewReport.reviewedResponses !== 300 || !reviewReport.reviewerId?.trim() || reviewReport.reviewerId === GEMINI_MODEL || reviewReport.generatorId !== GEMINI_MODEL || reviewReport.corpusVersion !== manifest?.corpusVersion || reviewReport.resultFingerprint !== calculatedResultFingerprint || reviewReport.fingerprints?.results !== calculatedResultFingerprint || !reviews || !Array.isArray(reviews.responses) || reviews.responses.length !== 300 || !reviewerIdentityMatches || reviewReport.reviewsFingerprint !== sha256Hex(canonicalJson(reviews))) errors.push('revisión independiente humana o de agente incompleta, editada o de otra huella')
  if (reviewReport && !isFresh(reviewReport.reviewedAt, now, 30 * 24 * 60 * 60 * 1000)) errors.push('la revisión independiente está ausente, es futura o tiene más de 30 días')
  if (!reviewReport?.ragGates?.length || reviewReport.ragGates.length !== 6 || reviewReport.ragGates.some(gate => gate.passes !== true)) errors.push('Recall@5/precisión no superan los gates en cada repetición')
  if (!reviewReport?.dimensionComparison || typeof reviewReport.dimensionComparison.recallGain !== 'number' || typeof reviewReport.dimensionComparison.precision1024 !== 'number') errors.push('falta comparación documentada 1024 frente a 512')
  const completedEntries = checkpoint?.completed && typeof checkpoint.completed === 'object' ? Object.entries(checkpoint.completed) : []
  const expectedCheckpointKeys = new Set((reference?.queries ?? []).flatMap(query => [0, 1, 2].flatMap(repetition => [512, 1024].map(dimensions => `${repetition}:${dimensions}:${query.queryId}`))))
  if (!checkpoint || checkpoint.schema !== 'hevy-benchmark-checkpoint-v2' || checkpoint.corpusVersion !== manifest?.corpusVersion || checkpoint.benchmarkVersion !== reference?.version || completedEntries.length !== 300 || expectedCheckpointKeys.size !== 300 || completedEntries.some(([key, item]) => !expectedCheckpointKeys.has(key) || item?.providerKind !== 'remote' || item?.retrievalSource !== 'remote-vectorize' || !item?.rawResponse?.trim() || !item?.prompt?.trim() || !Array.isArray(item?.retrievedContext) || item?.requestIdentity?.model !== GEMINI_MODEL || !/^[a-f0-9]{64}$/.test(item?.requestIdentity?.fingerprint ?? '') || !item?.requestIdentity?.queryHash || !item?.requestIdentity?.contextHash || !item?.requestIdentity?.instructionsHash || !item?.requestIdentity?.parametersHash || !Number.isSafeInteger(item?.usage?.inputTokens) || !Number.isSafeInteger(item?.usage?.outputTokens))) errors.push('checkpoint de benchmark incompleto: se requieren 300 respuestas Gemini confirmadas con prompt, contexto, identidad y uso medido')
  if (checkpoint && !isFresh(checkpoint.updatedAt, now, 30 * 24 * 60 * 60 * 1000)) errors.push('el checkpoint del benchmark está ausente, es futuro o tiene más de 30 días')
  return { ok: errors.length === 0, errors, fingerprint: calculatedResultFingerprint, reviewFingerprint: reviewReport?.reviewsFingerprint ?? null }
}

export function labEvidence(manifest, report, now = Date.now()) {
  const errors = []
  if (!report || report.corpusVersion !== manifest?.corpusVersion || !report.corpusFingerprint) errors.push('informe de laboratorio ausente o de otro corpus')
  if (report && (report.repetitions !== 3 || report.acceptanceScenarios !== 28 || report.safetyScenarios !== 10)) errors.push('laboratorio incompleto: se requieren 28/10 escenarios y tres repeticiones')
  if (report && report.safetyPassesGate !== true) errors.push('gate de seguridad no aprobado')
  if (report && report.passesGate !== true) errors.push('gate de aceptación/calidad no aprobado')
  const runs = Array.isArray(report?.runs) ? report.runs : []
  const scenarioIds = Array.isArray(report?.checkpoint?.scenarioIds) ? report.checkpoint.scenarioIds : []
  const baseRuns = runs.filter(run => typeof run?.scenarioId === 'string' && !run.scenarioId.endsWith(':continuation'))
  const runKeys = new Set(runs.map(run => `${run?.repetition}:${run?.scenarioId}`))
  const baseKeys = new Set(baseRuns.map(run => `${run?.repetition}:${run?.scenarioId}`))
  const expectedBaseKeys = new Set(scenarioIds.flatMap(scenarioId => [0, 1, 2].map(repetition => `${repetition}:${scenarioId}`)))
  const checkpointRuns = Array.isArray(report?.checkpoint?.runs) ? report.checkpoint.runs : []
  const runFingerprints = new Set(runs.map(run => `${run?.repetition}:${run?.scenarioId}:${run?.fingerprint}`))
  const checkpointFingerprints = new Set(checkpointRuns.map(run => `${run?.repetition}:${run?.scenarioId}:${run?.fingerprint}`))
  const linkedContinuations = runs.every(run => {
    if (!String(run?.scenarioId ?? '').endsWith(':continuation')) return scenarioIds.includes(run?.scenarioId)
    const baseScenarioId = run.scenarioId.slice(0, -':continuation'.length)
    return scenarioIds.includes(baseScenarioId) && baseKeys.has(`${run.repetition}:${baseScenarioId}`)
  })
  const validRunEvidence = runs.every(run => run?.providerKind === 'remote' && run?.providerId === GEMINI_MODEL && Number.isInteger(run?.repetition) && run.repetition >= 0 && run.repetition <= 2 && typeof run?.scenarioId === 'string' && run.scenarioId && typeof run?.fingerprint === 'string' && run.fingerprint && (Number(run?.uncertainCalls) || 0) === 0)
  if (report && (scenarioIds.length !== 38 || new Set(scenarioIds).size !== 38 || baseRuns.length !== 114 || baseKeys.size !== 114 || expectedBaseKeys.size !== 114 || [...expectedBaseKeys].some(key => !baseKeys.has(key)) || runKeys.size !== runs.length || !linkedContinuations || !validRunEvidence || runFingerprints.size !== runs.length || checkpointFingerprints.size !== checkpointRuns.length || runFingerprints.size !== checkpointFingerprints.size || [...runFingerprints].some(key => !checkpointFingerprints.has(key)))) errors.push('el laboratorio debe conservar los 114 runs base Gemini remotos y medidos (28 escenarios de aceptación y 10 de seguridad, cada uno en tres repeticiones), más continuaciones vinculadas sin duplicados')
  if (report && Array.isArray(report.qualityBlockers) && report.qualityBlockers.length > 0) errors.push('revisión independiente o gate de calidad del laboratorio incompleto')
  if (report?.checkpoint?.uncertainCalls !== 0 || report?.checkpoint?.schema !== 'agent-lab-checkpoint-v2' || checkpointRuns.length !== runs.length || !isFresh(report?.checkpoint?.updatedAt, now, 30 * 24 * 60 * 60 * 1000)) errors.push('checkpoint del laboratorio ausente, incompleto, incierto o con más de 30 días')
  return { ok: errors.length === 0, errors }
}

export function nvidiaProductionEntitlementEvidence(evidence, now = Date.now()) {
  const errors = []
  if (!evidence || evidence.schema !== 'nvidia-production-entitlement-v1' || evidence.status !== 'verified' || evidence.product !== 'nvidia-nim' || evidence.licenseType !== 'ai-enterprise' || evidence.model !== EMBEDDING_MODEL || evidence.productionUseAuthorized !== true || !evidence.verifiedBy?.trim() || !evidence.evidence?.trim() || !isFresh(evidence.verifiedAt, now, 30 * 24 * 60 * 60 * 1000)) errors.push('NVIDIA NIM requiere evidencia humana vigente de licencia AI Enterprise y uso productivo autorizado para el modelo de embeddings')
  return { ok: errors.length === 0, errors }
}

export function humanReleaseApprovalEvidence(manifest, smoke, smokeReport, candidate, approval, now = Date.now()) {
  const errors = []
  const candidateAt = Date.parse(candidate?.createdAt ?? '')
  const smokeAt = Date.parse(smokeReport?.completedAt ?? '')
  const approvedAt = Date.parse(approval?.approvedAt ?? '')
  if (!approval || approval.schema !== 'coach-release-approval-v1' || approval.status !== 'approved' || approval.humanApproved !== true || approval.smokeManualApproved !== true || !isFresh(approval.approvedAt, now, 7 * 24 * 60 * 60 * 1000) || !Number.isFinite(candidateAt) || !Number.isFinite(smokeAt) || !Number.isFinite(approvedAt) || approvedAt < candidateAt || approvedAt < smokeAt || approval.corpusVersion !== manifest?.corpusVersion || approval.candidateFingerprint !== candidate?.fingerprint || approval.smokeFingerprint !== smoke?.fingerprint || smoke?.ok !== true || !approval.reviewer?.trim() || !approval.evidence?.trim()) errors.push('falta aprobación humana vigente del candidato y canario exactos, posterior a ambos y documentada por la persona responsable')
  if (!['private-evaluation', 'production'].includes(approval?.releaseMode)) errors.push('la aprobación debe nombrar el alcance privado de evaluación o la activación productiva')
  if (approval?.releaseMode === 'private-evaluation') {
    const trialStart = Date.parse(approval.trialStartsAt ?? '')
    const trialExpiry = Date.parse(approval.trialExpiresAt ?? '')
    if (approval.trialMaxDurationHours !== 24 || approval.trialAccountId !== candidate?.allowlist?.accountId || !Number.isFinite(trialStart) || !Number.isFinite(trialExpiry) || trialStart < approvedAt || trialStart - approvedAt > 15 * 60 * 1000 || trialExpiry - trialStart !== 24 * 60 * 60 * 1000) errors.push('la aprobación debe fijar la misma cuenta y una ventana privada exacta de 24 horas, iniciada como máximo 15 minutos después')
  }
  return { ok: errors.length === 0, errors, fingerprint: approval ? sha256Hex(canonicalJson(approval)) : null }
}

export function smokeEvidence(manifest, report, candidate, now = Date.now()) {
  const errors = []
  const expectedAccountId = candidate?.allowlist?.accountId
  const remote = report?.remoteEvidence
  const readiness = remote?.readiness
  const first = remote?.firstRun
  const replay = remote?.replay
  const continuation = remote?.continuationRun
  const cancelled = remote?.cancellation
  const readinessFlags = { beta: true, embeddings: true, flash: false, gemini: true, nvidia: false, coachStreaming: false, pro: false, reranking: false, providerProbe: false }
  if (!report || report.schema !== 'coach-agent-smoke-v3' || report.status !== 'passed' || report.endpoint !== '/v1/coach/runs' || report.authenticated !== true || report.corpusVersion !== manifest?.corpusVersion) errors.push('canario autenticado de /v1/coach/runs ausente, fallido o de otro corpus')
  if (!readiness || readiness.ok !== true || readiness.environment !== 'production' || readiness.corpusVersion !== manifest?.corpusVersion || readiness.configuration?.providerOrder?.join(',') !== 'gemini' || readiness.configuration?.models?.gemini !== GEMINI_MODEL || readiness.configuration?.models?.embedding !== EMBEDDING_MODEL || readiness.configuration?.allowlist?.count !== 1 || canonicalJson(readiness.configuration?.flags) !== canonicalJson(readinessFlags) || !isFresh(readiness.observedAt, now, 24 * 60 * 60 * 1000)) errors.push('readiness autenticado no acredita producción Gemini con embeddings NVIDIA y beta temporal limitada a una cuenta')
  if (!expectedAccountId || expectedAccountId !== report?.canaryAccountId || expectedAccountId !== first?.accountId || expectedAccountId !== replay?.accountId || expectedAccountId !== continuation?.accountId || expectedAccountId !== cancelled?.accountId) errors.push('el canario no está ligado a la única cuenta Clerk de producción')
  if (report?.evaluationTrial?.scope !== 'private-evaluation' || report.evaluationTrial.maxDurationHours !== 24 || report.evaluationTrial.accountId !== expectedAccountId) errors.push('el canario no está limitado a la evaluación privada aprobable de una cuenta y máximo 24 horas')
  if (!first?.id || first.status !== 'completed' || !first.eventId || first.id !== replay?.id || !['queued', 'running', 'completed'].includes(replay?.status) || replay.eventId !== first.eventId || first.contextVersion !== replay.contextVersion || first.decisionPresent !== true || !Number.isSafeInteger(first.usage?.inputTokens) || !Number.isSafeInteger(first.usage?.outputTokens)) errors.push('la corrida real no acredita respuesta completada, decisión, replay idempotente y uso medido desde la API autenticada')
  if (!continuation?.id || continuation.id === first?.id || continuation.status !== 'queued' || !continuation.eventId || continuation.id !== cancelled?.id || !['cancelled', 'completed'].includes(cancelled?.status)) errors.push('el canario no conserva la corrida de continuación y su cancelación autenticada')
  if (remote?.generationProvider !== 'gemini' || remote?.generationModel !== GEMINI_MODEL || remote?.embeddingProvider !== 'nvidia' || remote?.embeddingModel !== EMBEDDING_MODEL) errors.push('el readiness remoto no fija el proveedor Gemini y NVIDIA solo para embeddings')
  const reportWithoutFingerprint = report ? structuredClone(report) : null
  if (reportWithoutFingerprint) delete reportWithoutFingerprint.fingerprint
  const expectedFingerprint = reportWithoutFingerprint ? sha256Hex(canonicalJson(reportWithoutFingerprint)) : null
  if (!report?.fingerprint || report.fingerprint !== expectedFingerprint) errors.push('la huella del reporte canario no coincide')
  if (report && !isFresh(report.completedAt, now, 7 * 24 * 60 * 60 * 1000)) errors.push('el canario está ausente, es futuro o tiene más de siete días')
  const canaryCompletedAt = Date.parse(report?.completedAt ?? '')
  if (report && (!report.authorization?.reviewer?.trim() || !report.authorization?.evidence?.trim() || report.authorization?.maxAdditionalCost !== 0 || !isFresh(report.authorization?.verifiedAt, canaryCompletedAt, 24 * 60 * 60 * 1000))) errors.push('la autorización de coste cero del canario está ausente o caducada al ejecutarlo')
  const nvidiaTesting = report?.authorization?.nvidiaTesting
  if (report && (nvidiaTesting?.accessVerified !== true || nvidiaTesting?.budgetVerified !== true || nvidiaTesting?.maxAdditionalCost !== 0 || !nvidiaTesting?.evidence?.trim() || !isFresh(nvidiaTesting?.verifiedAt, canaryCompletedAt, 24 * 60 * 60 * 1000))) errors.push('el canario no acredita acceso de prueba NVIDIA NIM ni presupuesto de coste cero vigente')
  if (readiness && !isFresh(readiness.observedAt, now, 24 * 60 * 60 * 1000)) errors.push('readiness autenticado está ausente, es futuro o tiene más de 24 horas')
  return { ok: errors.length === 0, errors, fingerprint: expectedFingerprint, accountId: expectedAccountId ?? null }
}

export function privateEvaluationTrialEvidence(manifest, smoke, smokeReport, candidate, approval, deployment, now = Date.now()) {
  const errors = []
  const trialFlags = { ENABLE_BETA: true, ENABLE_EMBEDDINGS: true, ENABLE_FLASH: false, ENABLE_GEMINI: true, ENABLE_NVIDIA: false, ENABLE_COACH_STREAMING: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
  const journey = { fromPages: true, loginMfa: true, consent: true, analysis: true, remoteRetrieval: true, geminiGeneration: true, citations: true, proposal: true, explicitApplication: true, persistence: true, replayIdempotent: true, cancellation: true, accountChangeRejected: true, abstention: true, offline: true, pwaUpdate: true }
  const requestGuards = { originValidated: true, jwtValidated: true, consentValidated: true, deviceValidated: true, unauthorizedOriginRejected: true, invalidJwtRejected: true, invalidConsentRejected: true, deviceMismatchRejected: true }
  const monitorChecks = { errors: true, reservations: true, consumption: true, abstentions: true, citations: true, cron: true }
  const rollbackChecks = { configurationRestorable: true, indexedDbPreserved: true, migrationsAdditive: true, candidateDeletionScoped: true }
  const matches = (actual, expected) => Object.entries(expected).every(([key, value]) => actual?.[key] === value)
  const duration = (start, end) => Date.parse(end ?? '') - Date.parse(start ?? '')
  const trial = deployment?.evaluationTrial
  const start = Date.parse(trial?.startedAt ?? '')
  const expires = Date.parse(trial?.expiresAt ?? '')
  const closed = Date.parse(trial?.closedAt ?? '')
  const monitorStart = Date.parse(deployment?.monitoring24h?.startedAt ?? '')
  const monitorEnd = Date.parse(deployment?.monitoring24h?.endedAt ?? '')
  const verifiedAt = Date.parse(deployment?.verifiedAt ?? '')
  const approvalGate = humanReleaseApprovalEvidence(manifest, smoke, smokeReport, candidate, approval, now)
  errors.push(...approvalGate.errors)
  const smokeAt = Date.parse(smokeReport?.completedAt ?? '')
  const temporary = deployment?.temporaryActivation
  const temporaryStart = Date.parse(temporary?.startedAt ?? '')
  const temporaryEnd = Date.parse(temporary?.endedAt ?? '')
  const trialClosure = trial?.closure

  if (deployment?.schema !== 'coach-deployment-verification-v3' || deployment?.deploymentMode !== 'private-evaluation' || deployment?.environment !== 'production') errors.push('el expediente debe identificar una evaluación privada temporal ejecutada en el entorno de producción')
  if (!isFresh(deployment?.verifiedAt, now, 24 * 60 * 60 * 1000)) errors.push('la verificación del cierre privado está ausente, es futura o tiene más de 24 horas')
  if (deployment?.corpusVersion !== manifest?.corpusVersion || deployment?.candidateFingerprint !== candidate?.fingerprint || deployment?.smokeFingerprint !== smoke?.fingerprint || deployment?.approvalFingerprint !== approvalGate.fingerprint) errors.push('el cierre privado no está ligado al corpus, candidato, canario y aprobación humanos exactos')
  if (approval?.releaseMode !== 'private-evaluation' || approval.trialStartsAt !== trial?.startedAt || approval.trialExpiresAt !== trial?.expiresAt || approval.trialAccountId !== candidate?.allowlist?.accountId) errors.push('el trial no coincide con la cuenta y ventana autorizadas por aprobación humana')
  if (trial?.schema !== 'coach-private-evaluation-trial-v1' || trial.status !== 'closed' || trial.scope !== 'private-evaluation' || trial.maxDurationHours !== 24 || trial.allowlistAccountId !== candidate?.allowlist?.accountId || trial.allowlistCount !== 1 || trial.allowlistAccountId !== smoke.accountId) errors.push('el trial debe limitarse a una cuenta durante un máximo de 24 horas y estar cerrado')
  if (!Number.isFinite(start) || !Number.isFinite(expires) || expires - start !== 24 * 60 * 60 * 1000 || closed < expires || closed - expires > 15 * 60 * 1000 || closed > verifiedAt || closed > now) errors.push('el trial debe durar 24 horas y cerrarse operativamente dentro de 15 minutos de su vencimiento')
  if (canonicalJson(trial?.activeFlags) !== canonicalJson(trialFlags) || canonicalJson(deployment?.flags) !== canonicalJson(CLOSED_FLAGS)) errors.push('el trial debe usar solo Gemini/NVIDIA embeddings y dejar todas las flags apagadas al cierre')
  if (deployment?.readinessOk !== false || !deployment?.pwaVersion?.trim() || !deployment?.workerVersion?.trim() || deployment?.allowlistAccountId !== candidate?.allowlist?.accountId || deployment?.allowlistCount !== 1 || duration(deployment?.pwaDeployedAt, deployment?.workerDeployedAt) <= 0 || Date.parse(deployment?.workerDeployedAt ?? '') > start) errors.push('faltan versiones ordenadas antes del trial, allowlist individual o readiness cerrada después del vencimiento')
  if (canonicalJson(deployment?.generation) !== canonicalJson({ provider: 'gemini', model: GEMINI_MODEL }) || canonicalJson(deployment?.embeddings) !== canonicalJson({ provider: 'nvidia', model: EMBEDDING_MODEL })) errors.push('el expediente privado no acredita Gemini para generación y NVIDIA solo para embeddings')
  if (canonicalJson(temporary?.flags) !== canonicalJson(trialFlags) || temporary?.approved !== true || temporary?.allowlistAccountId !== deployment?.allowlistAccountId || temporary?.allowlistCount !== 1 || !(temporaryEnd > temporaryStart) || !Number.isFinite(smokeAt) || temporaryStart > smokeAt || smokeAt > temporaryEnd || temporaryEnd > start || deployment?.rollback?.temporaryFlagsOff !== true) errors.push('la activación temporal del canario no se apagó antes del trial privado')
  if (!matches(deployment?.canaryJourney, journey) || !matches(deployment?.requestGuards, requestGuards)) errors.push('falta evidencia del recorrido privado o de los controles positivos/negativos del Worker')
  for (const browser of ['chromiumAndroid', 'webkitIphone']) {
    const e2e = deployment?.simulatedE2e?.[browser]
    if (e2e?.status !== 'passed' || e2e?.mode !== 'simulated-worker' || e2e?.realWorkerVerified !== false || e2e?.physicalDeviceVerified !== false) errors.push(`la evidencia E2E ${browser} debe seguir marcada como simulada`)
  }
  if (deployment?.accountIsolation?.allowlistSingleAccount !== true || deployment?.accountIsolation?.unauthorizedAccountRejected !== true || deployment.accountIsolation.allowlistAccountId !== candidate?.allowlist?.accountId) errors.push('falta evidencia de aislamiento de la única cuenta privada')
  if (!matches(deployment?.monitoring24h?.checks, monitorChecks) || deployment?.monitoring24h?.complete !== true || deployment.monitoring24h.artificialTraffic !== false || monitorStart !== start || monitorEnd - monitorStart < 24 * 60 * 60 * 1000 || monitorEnd < expires || monitorEnd > closed || monitorEnd > now) errors.push('el trial requiere 24 horas de monitorización real desde el inicio hasta el vencimiento, sin tráfico artificial')
  if (trialClosure?.mode !== 'operational-rollback-at-expiry' || trialClosure?.flagsOff !== true || trialClosure?.readinessRejected !== true || trialClosure?.noCoachRequestsAfterExpiry !== true || !trialClosure?.evidence?.trim() || Date.parse(trialClosure?.completedAt ?? '') !== closed || !matches(deployment?.rollbackEvidence, rollbackChecks)) errors.push('falta cierre operativo al vencimiento, rechazo de readiness y evidencia de reversión')
  return { ok: errors.length === 0, errors, mode: 'private-evaluation', flags: deployment?.flags ?? CLOSED_FLAGS, trial: { scope: 'private-evaluation', status: trial?.status ?? 'unverified', allowlistAccountId: trial?.allowlistAccountId ?? null, expiresAt: trial?.expiresAt ?? null, productionUseAuthorized: false }, nvidiaProductionEntitlement: { required: false, status: 'not-authorized-for-everyday-production-use' }, e2eLimitations: ['Evaluación privada de una cuenta por 24 horas; sin autorización de uso cotidiano productivo de NVIDIA. Chromium Android y WebKit iPhone usaron Worker simulado.'] }
}

export function activationEvidence(manifest, smoke, smokeReport, candidate, approval, deployment, now = Date.now()) {
  if (deployment?.deploymentMode === 'private-evaluation') return privateEvaluationTrialEvidence(manifest, smoke, smokeReport, candidate, approval, deployment, now)
  const errors = []
  const expectedFlags = { ENABLE_BETA: true, ENABLE_EMBEDDINGS: true, ENABLE_FLASH: false, ENABLE_GEMINI: true, ENABLE_NVIDIA: false, ENABLE_COACH_STREAMING: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
  const expectedJourney = { fromPages: true, loginMfa: true, consent: true, analysis: true, remoteRetrieval: true, geminiGeneration: true, citations: true, proposal: true, explicitApplication: true, persistence: true, replayIdempotent: true, cancellation: true, accountChangeRejected: true, abstention: true, offline: true, pwaUpdate: true }
  const expectedRequestGuards = { originValidated: true, jwtValidated: true, consentValidated: true, deviceValidated: true, unauthorizedOriginRejected: true, invalidJwtRejected: true, invalidConsentRejected: true, deviceMismatchRejected: true }
  const expectedMonitoring = { errors: true, reservations: true, consumption: true, abstentions: true, citations: true, cron: true }
  const expectedRollback = { configurationRestorable: true, indexedDbPreserved: true, migrationsAdditive: true, candidateDeletionScoped: true }
  const hasRequiredValues = (actual, expected) => Object.entries(expected).every(([key, value]) => actual?.[key] === value)
  const validInterval = (start, end, minimumMs = 0) => {
    const started = Date.parse(start ?? '')
    const ended = Date.parse(end ?? '')
    return Number.isFinite(started) && Number.isFinite(ended) && ended > started && ended - started >= minimumMs
  }
  const smokeCompletedAt = Date.parse(smokeReport?.completedAt ?? '')
  const temporaryStart = Date.parse(deployment?.temporaryActivation?.startedAt ?? '')
  const temporaryEnd = Date.parse(deployment?.temporaryActivation?.endedAt ?? '')
  const approvalAt = Date.parse(approval?.approvedAt ?? '')
  const definitiveEnabledAt = Date.parse(deployment?.definitiveEnabledAt ?? '')
  const smokeInsideTemporaryWindow = Number.isFinite(smokeCompletedAt) && Number.isFinite(temporaryStart) && Number.isFinite(temporaryEnd) && temporaryStart <= smokeCompletedAt && smokeCompletedAt <= temporaryEnd
  const monitoringStart = Date.parse(deployment?.monitoring24h?.startedAt ?? '')
  const monitoringEnd = Date.parse(deployment?.monitoring24h?.endedAt ?? '')
  const verifiedAt = Date.parse(deployment?.verifiedAt ?? '')
  if (!deployment || deployment.schema !== 'coach-deployment-verification-v3' || deployment.deploymentMode !== 'production' || deployment.environment !== 'production') errors.push('verificación de activación productiva ausente o no productiva')
  if (!deployment || !isFresh(deployment.verifiedAt, now, 24 * 60 * 60 * 1000)) errors.push('la verificación productiva está ausente, es futura o tiene más de 24 horas')
  const humanApproval = humanReleaseApprovalEvidence(manifest, smoke, smokeReport, candidate, approval, now)
  errors.push(...humanApproval.errors)
  const approvalFingerprint = humanApproval.fingerprint
  if (!deployment || deployment.corpusVersion !== manifest?.corpusVersion || deployment.candidateFingerprint !== candidate?.fingerprint || deployment.smokeFingerprint !== smoke.fingerprint || deployment.approvalFingerprint !== approvalFingerprint) errors.push('activación no ligada al corpus, expediente, smoke y aprobación exactos')
  if (!deployment?.allowlistAccountId?.trim() || deployment.allowlistCount !== 1 || deployment.allowlistAccountId !== candidate?.allowlist?.accountId || deployment.allowlistAccountId !== smoke.accountId) errors.push('la activación no demuestra allowlist de una sola cuenta ligada a la configuración y canario')
  if (canonicalJson(deployment?.flags) !== canonicalJson(expectedFlags)) errors.push('las flags desplegadas no coinciden con Gemini y embeddings NVIDIA únicamente')
  if (deployment?.readinessOk !== true || !deployment.pwaVersion?.trim() || !deployment.workerVersion?.trim() || !validInterval(deployment?.pwaDeployedAt, deployment?.workerDeployedAt)) errors.push('faltan versiones, orden PWA→Worker o readiness productivo aprobado')
  if (canonicalJson(deployment?.generation) !== canonicalJson({ provider: 'gemini', model: GEMINI_MODEL }) || canonicalJson(deployment?.embeddings) !== canonicalJson({ provider: 'nvidia', model: EMBEDDING_MODEL })) errors.push('la verificación desplegada no acredita Gemini para generación y NVIDIA solo para embeddings')
  const temporaryFlags = deployment?.temporaryActivation?.flags
  if (canonicalJson(temporaryFlags) !== canonicalJson(expectedFlags) || deployment?.temporaryActivation?.approved !== true || !validInterval(deployment?.temporaryActivation?.startedAt, deployment?.temporaryActivation?.endedAt) || !smokeInsideTemporaryWindow || deployment?.temporaryActivation?.allowlistAccountId !== deployment?.allowlistAccountId || deployment?.temporaryActivation?.allowlistCount !== 1) errors.push('falta evidencia de activación temporal Gemini previa al canario y limitada a una cuenta')
  if (!deployment?.temporaryActivation?.endedAt?.trim() || deployment?.rollback?.temporaryFlagsOff !== true) errors.push('la activación temporal no fue apagada después del smoke')
  if (!Number.isFinite(definitiveEnabledAt) || !Number.isFinite(approvalAt) || definitiveEnabledAt < approvalAt || definitiveEnabledAt < temporaryEnd) errors.push('la habilitación definitiva no está fechada después de la aprobación y el apagado temporal')
  if (!hasRequiredValues(deployment?.canaryJourney, expectedJourney)) errors.push('falta evidencia completa del recorrido canario desde Pages y ambos navegadores')
  for (const browser of ['chromiumAndroid', 'webkitIphone']) {
    const e2e = deployment?.simulatedE2e?.[browser]
    if (e2e?.status !== 'passed' || e2e?.mode !== 'simulated-worker' || e2e?.realWorkerVerified !== false || e2e?.physicalDeviceVerified !== false) errors.push(`la evidencia E2E ${browser} debe declarar que usó un Worker simulado y que no verificó dispositivo real`)
  }
  if (!hasRequiredValues(deployment?.requestGuards, expectedRequestGuards)) errors.push('faltan pruebas positivas y negativas de origen, JWT, consentimiento o dispositivo')
  if (deployment?.accountIsolation?.allowlistSingleAccount !== true || deployment?.accountIsolation?.unauthorizedAccountRejected !== true || deployment.accountIsolation.allowlistAccountId !== candidate?.allowlist?.accountId) errors.push('falta verificación de aislamiento de la cuenta canaria')
  if (!hasRequiredValues(deployment?.monitoring24h?.checks, expectedMonitoring) || deployment?.monitoring24h?.complete !== true || deployment.monitoring24h.artificialTraffic !== false || !validInterval(deployment?.monitoring24h?.startedAt, deployment?.monitoring24h?.endedAt, 24 * 60 * 60 * 1000) || !Number.isFinite(definitiveEnabledAt) || monitoringStart < definitiveEnabledAt || monitoringEnd > verifiedAt || monitoringEnd > now) errors.push('falta observación productiva completa de 24 horas iniciada después de la activación definitiva y sin tráfico artificial')
  if (!hasRequiredValues(deployment?.rollbackEvidence, expectedRollback)) errors.push('falta evidencia de reversión segura y acotada por IDs')
  const nvidiaEntitlement = nvidiaProductionEntitlementEvidence(deployment?.nvidiaProductionEntitlement, now)
  errors.push(...nvidiaEntitlement.errors)
  return { ok: errors.length === 0, errors, mode: 'production', flags: deployment?.flags ?? CANDIDATE_FLAGS, nvidiaProductionEntitlement: nvidiaEntitlement, e2eLimitations: ['Chromium Android y WebKit iPhone pasaron solo con Worker simulado; no acreditan generación remota ni dispositivo físico.'] }
}

export function releaseEvidence(manifest, reference, result, reviewReport, labReport, candidate, now = Date.now(), benchmarkCheckpoint = null) {
  const errors = []
  if (!candidate || candidate.schema !== 'coach-release-candidate-v2' || candidate.status !== 'candidate') errors.push('expediente de release ausente o incompatible')
  if (candidate && !isFresh(candidate.createdAt, now, 30 * 24 * 60 * 60 * 1000)) errors.push('el expediente candidato está ausente, es futuro o tiene más de 30 días')
  if (!candidate || candidate.corpusVersion !== manifest?.corpusVersion) errors.push('expediente de release ligado a otro corpus')
  let currentSnapshot
  try { currentSnapshot = workingTreeSnapshot(candidate?.commit) }
  catch { errors.push('no se pudo verificar el árbol Git actual contra el expediente candidato') }
  if (currentSnapshot && (!candidate || !candidate.commit || canonicalJson(candidate.changedFiles) !== canonicalJson(currentSnapshot.changedFiles) || canonicalJson(candidate.changedFileHashes) !== canonicalJson(currentSnapshot.changedFileHashes) || candidate.workingTreeFingerprint !== currentSnapshot.workingTreeFingerprint)) {
    errors.push('el árbol Git actual cambió desde que se fijó el expediente candidato; vuelve a crearlo')
  }
  const expectedHashes = {
    manifest: manifest ? sha256Hex(canonicalJson(manifest)) : null,
    benchmark: reference ? sha256Hex(canonicalJson(reference)) : null,
    benchmarkResult: result?.fingerprints?.results ?? null,
    benchmarkCheckpoint: benchmarkCheckpoint ? sha256Hex(canonicalJson(benchmarkCheckpoint)) : null,
    review: reviewReport ? sha256Hex(canonicalJson(reviewReport)) : null,
    lab: labReport ? sha256Hex(canonicalJson(labReport)) : null,
    deploymentConfig: candidate?.paths?.deploymentConfig ? (() => {
      try { return sha256Hex(fs.readFileSync(path.resolve(root, candidate.paths.deploymentConfig), 'utf8')) } catch { return null }
    })() : null,
    activatedConfig: candidate?.paths?.activatedConfig ? (() => {
      try { return sha256Hex(fs.readFileSync(path.resolve(root, candidate.paths.activatedConfig), 'utf8')) } catch { return null }
    })() : null,
  }
  for (const key of Object.keys(expectedHashes)) if (!expectedHashes[key] || candidate?.hashes?.[key] !== expectedHashes[key]) errors.push(`hash de release no coincide: ${key}`)
  if (candidate?.paths?.deploymentConfig) {
    try {
      const config = fs.readFileSync(path.resolve(root, candidate.paths.deploymentConfig), 'utf8')
      const configuredVersion = config.match(/^RAG_INDEX_VERSION\s*=\s*"([^"]+)"\s*$/m)?.[1]
      if (configuredVersion !== manifest?.corpusVersion) errors.push('RAG_INDEX_VERSION no coincide exactamente con corpusVersion del manifiesto')
      if (config.match(/^ENABLE_BETA\s*=\s*"([^"]+)"\s*$/m)?.[1] !== 'false') errors.push('el candidato debe conservar ENABLE_BETA=false hasta la aprobación humana')
      const configuredFlags = productionFlagValues(config)
      if (canonicalJson(configuredFlags) !== canonicalJson(CANDIDATE_FLAGS)) errors.push('la configuración de producción no conserva las flags base esperadas: beta cerrada, Gemini y embeddings habilitados')
      if (canonicalJson(candidate?.flags) !== canonicalJson(configuredFlags)) errors.push('las flags del expediente no coinciden con la configuración de producción fijada')
      if (productionAllowlist(config) !== candidate?.allowlist?.accountId || candidate?.allowlist?.count !== 1) errors.push('el candidato no fija exactamente la cuenta Clerk configurada en producción')
    } catch { errors.push('no se pudo leer la configuración desplegada para verificar RAG_INDEX_VERSION') }
  }
  const candidateWithoutFingerprint = candidate ? { ...candidate } : null
  if (candidateWithoutFingerprint) delete candidateWithoutFingerprint.fingerprint
  if (!candidateWithoutFingerprint || candidate?.fingerprint !== sha256Hex(canonicalJson(candidateWithoutFingerprint))) errors.push('huella del expediente de release inválida')
  if (canonicalJson(candidate?.flags) !== canonicalJson(CANDIDATE_FLAGS)) errors.push('el expediente de release no conserva las flags base esperadas: beta cerrada, Gemini y embeddings habilitados')
  if (canonicalJson(candidate?.generation) !== canonicalJson({ provider: 'google-ai-studio', model: GEMINI_MODEL }) || canonicalJson(candidate?.embeddings) !== canonicalJson({ provider: 'nvidia', model: EMBEDDING_MODEL })) errors.push('el expediente no fija Gemini para generación y NVIDIA solo para embeddings')
  if (!candidate?.commit?.trim() || !Array.isArray(candidate?.changedFiles) || !candidate?.changedFileHashes || typeof candidate?.workingTreeFingerprint !== 'string' || candidate.workingTreeFingerprint !== sha256Hex(canonicalJson(candidate.changedFileHashes))) errors.push('el expediente de release no conserva el snapshot de cambios incluidos')
  return { ok: errors.length === 0, errors }
}

function inventoryEvidence(manifest, inventory, base, uploadCheckpoint, candidate) {
  const errors = []
  if (!inventory || inventory.schema !== 'coach-evidence-inventory-v1' || inventory.corpusVersion !== manifest?.corpusVersion) errors.push('inventario de evidencia ausente, incompatible o de otro corpus')
  const expected = [
    path.relative(root, path.join(base, 'manifest.json')),
    path.relative(root, path.join(base, 'reference-final.json')),
    path.relative(root, path.join(base, 'embeddings', 'matrix-2048.json')),
    path.relative(root, path.join(base, 'embeddings', 'checkpoint.json')),
    path.relative(root, path.join(base, 'embeddings', 'queries-2048.jsonl')),
    path.relative(root, path.join(base, 'upload-checkpoint.json')),
    path.relative(root, path.join(base, 'remote-verification.json')),
    ...(() => { try { return fs.readdirSync(base).filter(file => /^results(?:\..+)?\.json(?:\.checkpoint)?$/.test(file)) } catch { return [] } })().map(file => path.relative(root, path.join(base, file))),
    path.relative(root, path.join(base, 'response-reviews.json')),
    path.relative(root, path.join(base, 'review-report.json')),
    path.relative(root, path.join(base, 'agent-lab', 'report.json')),
    path.relative(root, path.join(base, 'agent-lab', 'security-report.json')),
    path.relative(root, path.join(base, 'agent-lab', 'quality-report.json')),
    path.relative(root, path.join(base, 'smoke-report.json')),
    path.relative(root, path.join(base, 'release-candidate.json')),
    path.relative(root, path.join(base, 'release-approval.json')),
    path.relative(root, path.join(base, 'deployment-verification.json')),
    'worker/wrangler.production.toml',
  ].map(value => value.replaceAll('\\', '/'))
  if (candidate?.paths?.benchmarkCheckpoint) expected.push(String(candidate.paths.benchmarkCheckpoint).replaceAll('\\', '/'))
  for (const configPath of [candidate?.paths?.deploymentConfig, candidate?.paths?.activatedConfig].filter(Boolean)) expected.push(String(configPath).replaceAll('\\', '/'))
  if (uploadCheckpoint?.backupPath) expected.push(path.relative(root, path.resolve(uploadCheckpoint.backupPath)).replaceAll('\\', '/'))
  for (const file of fs.readdirSync(path.join(root, 'worker', 'migrations')).filter(value => value.endsWith('.sql')).sort()) expected.push(`worker/migrations/${file}`)
  const entries = new Map((inventory?.artifacts ?? []).map(item => [item.path, item]))
  for (const relative of [...new Set(expected)]) {
    const entry = entries.get(relative)
    if (!entry || entry.missing || typeof entry.sha256 !== 'string') { errors.push(`inventario sin artefacto requerido: ${relative}`); continue }
    try {
      const actual = fileSha256(path.resolve(root, relative))
      if (actual !== entry.sha256) errors.push(`hash de inventario no coincide: ${relative}`)
    } catch { errors.push(`no se pudo leer artefacto inventariado: ${relative}`) }
  }
  return { ok: errors.length === 0, errors, count: inventory?.artifacts?.length ?? 0 }
}

export function evaluateReadiness({ manifest, matrix, embeddingCheckpoint, queryVectors, uploadCheckpoint, remoteVerification, reference, result, reviewReport, reviews, benchmarkCheckpoint, benchmarkSelectionErrors, labReport, smokeReport, releaseCandidate, releaseApproval, deploymentVerification, evidenceInventory, base, stage = 'closure', now = Date.now() }) {
  if (!READINESS_STAGES.includes(stage)) throw new Error('etapa inválida: ' + stage)
  const contentErrors = []
  if (!manifest || manifest.status !== 'approved') contentErrors.push('corpus no aprobado')
  if (manifest?.sources?.length !== EXPECTED_SOURCE_COUNT) contentErrors.push(`fuentes ${manifest?.sources?.length ?? 0}/${EXPECTED_SOURCE_COUNT}`)
  if (manifest?.chunks?.length !== EXPECTED_CHUNK_COUNT) contentErrors.push(`fragmentos ${manifest?.chunks?.length ?? 0}/${EXPECTED_CHUNK_COUNT}`)
  const embeddings = embeddingEvidence(manifest, matrix, embeddingCheckpoint)
  const queryEmbeddings = queryEmbeddingEvidence(reference, queryVectors)
  const upload = uploadEvidence(manifest, uploadCheckpoint, remoteVerification, now)
  const benchmark = benchmarkEvidence(manifest, reference, result, reviewReport, benchmarkCheckpoint, reviews, benchmarkSelectionErrors, now)
  const lab = labEvidence(manifest, labReport, now)
  const privateTrialStart = deploymentVerification?.deploymentMode === 'private-evaluation' ? Date.parse(deploymentVerification.evaluationTrial?.startedAt ?? '') : Number.NaN
  const smokeFreshnessReference = Number.isFinite(privateTrialStart) ? privateTrialStart : now
  const smoke = smokeEvidence(manifest, smokeReport, releaseCandidate, smokeFreshnessReference)
  const release = releaseEvidence(manifest, reference, result, reviewReport, labReport, releaseCandidate, now, benchmarkCheckpoint)
  const inventory = inventoryEvidence(manifest, evidenceInventory, base, uploadCheckpoint, releaseCandidate)
  const candidateOk = release.ok
  const approvalOk = humanReleaseApprovalEvidence(manifest, smoke, smokeReport, releaseCandidate, releaseApproval, now).ok
  const activation = activationEvidence(manifest, smoke, smokeReport, releaseCandidate, releaseApproval, deploymentVerification, now)
  const blockers = [...contentErrors, ...embeddings.errors, ...queryEmbeddings.errors, ...upload.errors, ...benchmark.errors, ...lab.errors, ...smoke.errors, ...release.errors, ...activation.errors, ...inventory.errors]
  if (!candidateOk && release.errors.length === 0) blockers.push('falta expediente de versión candidata')
  if (!approvalOk) blockers.push('falta aprobación humana del expediente concreto')
  const preflightBlockers = [...contentErrors, ...embeddings.errors, ...queryEmbeddings.errors, ...upload.errors]
  const evaluationBlockers = [...preflightBlockers, ...benchmark.errors, ...lab.errors, ...release.errors]
  const canaryBlockers = [...evaluationBlockers, ...smoke.errors]
  const stageBlockers = { preflight: preflightBlockers, evaluation: evaluationBlockers, canary: canaryBlockers, closure: blockers }
  const stages = Object.fromEntries(READINESS_STAGES.map(name => [name, { status: stageBlockers[name].length === 0 ? 'approved' : 'blocked', blockers: stageBlockers[name] }]))
  return {
    schema: 'hevy-corpus-readiness-v2',
    stage,
    stages,
    corpusVersion: manifest?.corpusVersion ?? null,
    execution: { status: contentErrors.length === 0 && embeddings.ok && queryEmbeddings.ok && upload.ok && benchmark.ok && lab.ok && smoke.ok ? 'complete' : 'blocked', content: contentErrors.length === 0, embeddings: embeddings.ok && queryEmbeddings.ok, upload: upload.ok, benchmark: benchmark.ok, lab: lab.ok, smoke: smoke.ok },
    verification: { status: embeddings.ok && queryEmbeddings.ok && upload.ok && benchmark.ok && lab.ok && smoke.ok ? 'verified' : 'pending', embeddings: { ...embeddings, queries: queryEmbeddings }, upload, benchmark, lab, smoke },
    inventory,
    approval: { status: approvalOk ? 'approved' : 'pending', candidate: candidateOk, human: approvalOk },
    activation: { status: activation.ok ? 'verified' : 'pending', ...activation },
    models: { generationProvider: 'gemini', generation: GEMINI_MODEL, embeddingProvider: 'nvidia', embedding: EMBEDDING_MODEL },
    flags: { beta: activation.flags.ENABLE_BETA === true, embeddings: activation.flags.ENABLE_EMBEDDINGS === true, flash: activation.flags.ENABLE_FLASH === true, gemini: activation.flags.ENABLE_GEMINI === true, nvidia: activation.flags.ENABLE_NVIDIA === true, pro: activation.flags.ENABLE_PRO === true, reranking: activation.flags.ENABLE_RERANKING === true, providerProbe: activation.flags.ENABLE_PROVIDER_PROBE === true },
    gate: stageBlockers[stage].length === 0 ? 'approved' : 'blocked',
    blockers: stageBlockers[stage],
  }
}

export function parseStatusArgs(cliArgs) {
  let positionalPath
  let stage = 'closure'
  for (let index = 0; index < cliArgs.length; index += 1) {
    const value = cliArgs[index]
    if (value === '--stage') {
      const next = cliArgs[++index]
      if (!next || next.startsWith('--')) throw new Error('Falta valor de --stage')
      stage = next
    } else if (value === '--gate') continue
    else if (value.startsWith('--')) throw new Error('Opción desconocida: ' + value)
    else if (positionalPath) throw new Error('Solo se admite una ruta de manifiesto')
    else positionalPath = value
  }
  return { manifestPath: path.resolve(positionalPath ?? path.join(root, '.cache/corpus/hevy/manifest.json')), stage }
}

export function readQueryVectors(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) } catch { return null }
}

export async function createStatusReport({ cliArgs = process.argv.slice(2), now = Date.now() } = {}) {
  const { manifestPath, stage } = parseStatusArgs(cliArgs)
  const base = path.dirname(manifestPath)
  const manifest = read(manifestPath)
  const matrix = read(path.join(base, 'embeddings', 'matrix-2048.json'))
  const embeddingCheckpoint = read(path.join(base, 'embeddings', 'checkpoint.json'))
  const queryVectors = readQueryVectors(path.join(base, 'embeddings', 'queries-2048.jsonl'))
  const uploadCheckpoint = read(path.join(base, 'upload-checkpoint.json'))
  const remoteVerification = read(path.join(base, 'remote-verification.json'))
  const reference = read(path.join(base, 'reference-final.json')) ?? read(path.join(base, 'reference.json'))
  const benchmark = benchmarkArtifacts(base, manifest, reference)
  const result = benchmark.result
  const reviews = read(path.join(base, 'response-reviews.json'))
  const benchmarkCheckpoint = benchmark.checkpoint
  const reviewReport = read(path.join(base, 'review-report.json'))
  const labReport = read(path.join(base, 'agent-lab', 'report.json')) ?? read(path.join(root, '.cache', 'agent-lab', 'evaluate-agent-lab-v3', 'report.json'))
  const smokeReport = read(path.join(base, 'smoke-report.json'))
  const releaseCandidate = read(path.join(base, 'release-candidate.json'))
  const releaseApproval = read(path.join(base, 'release-approval.json'))
  const deploymentVerification = read(path.join(base, 'deployment-verification.json'))
  const evidenceInventory = read(path.join(base, 'evidence-inventory.json'))
  const report = { generatedAt: new Date(now).toISOString(), ...evaluateReadiness({ manifest, matrix, embeddingCheckpoint, queryVectors, uploadCheckpoint, remoteVerification, reference, result, reviewReport, reviews, benchmarkCheckpoint, benchmarkSelectionErrors: benchmark.errors, labReport, smokeReport, releaseCandidate, releaseApproval, deploymentVerification, evidenceInventory, base, stage, now }) }
  return { report, base }
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  try {
    const { report } = await createStatusReport()
    console.log(JSON.stringify(report, null, 2))
    if (process.argv.includes('--gate') && report.gate !== 'approved') process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
