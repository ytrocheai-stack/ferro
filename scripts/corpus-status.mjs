#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { canonicalJson, corpusMetadataKey, sha256Hex } from '../packages/corpus-identity/src/index.mjs'
import { scientificReviewReady } from '../packages/corpus-evaluation/src/scientific-review.mjs'

const root = path.resolve(import.meta.dirname, '..')
const EXPECTED_SOURCE_COUNT = 88
const EXPECTED_CHUNK_COUNT = 2708
const EMBEDDING_DIMENSIONS = 2048
const EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b'
const READINESS_STAGES = ['preflight', 'evaluation', 'canary', 'closure']
const KIMI_MODEL = 'moonshotai/kimi-k3'

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function fileSha256(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }

function benchmarkArtifacts(base, manifest, reference) {
  const files = fs.readdirSync(base).filter(file => /^results(?:\..+)?\.json(?:\.checkpoint)?$/.test(file))
  const resultCandidates = files.filter(file => !file.endsWith('.checkpoint.json')).map(file => ({ file, value: read(path.join(base, file)) })).filter(item => item.value?.schema === 'generated-benchmark-v1' && item.value.corpusVersion === manifest?.corpusVersion && item.value.benchmarkVersion === reference?.version && item.value.execution === 'remote-flash' && item.value.authorization?.model === KIMI_MODEL && item.value.repetitions === 3 && item.value.provider?.calls === 300)
  const errors = []
  if (resultCandidates.length > 1) errors.push('hay varios resultados benchmark Kimi compatibles; seleccionar explícitamente uno')
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

function uploadEvidence(manifest, checkpoint, remote) {
  const errors = []
  if (!checkpoint || checkpoint.corpusVersion !== manifest?.corpusVersion) errors.push('falta upload-checkpoint compatible')
  if (checkpoint && (checkpoint.completedIds?.length !== EXPECTED_CHUNK_COUNT || new Set(checkpoint.completedIds).size !== EXPECTED_CHUNK_COUNT)) errors.push('checkpoint de carga incompleto')
  if (!remote) errors.push('falta remote-verification.json')
  const expected = { sources: EXPECTED_SOURCE_COUNT, chunks: EXPECTED_CHUNK_COUNT, vectors512: EXPECTED_CHUNK_COUNT, vectors1024: EXPECTED_CHUNK_COUNT }
  for (const [key, value] of Object.entries(expected)) if (remote && asInteger(remote[key]) !== value) errors.push(`verificación remota ${key} inválida`)
  if (remote && remote.corpusVersion !== manifest?.corpusVersion) errors.push('verificación remota de otra versión')
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

function benchmarkEvidence(manifest, reference, result, reviewReport, checkpoint, reviews, selectionErrors = []) {
  const errors = [...selectionErrors]
  if (!reference || reference.corpusVersion !== manifest?.corpusVersion || reference.status !== 'approved' || reference.queries?.length !== 50) errors.push('benchmark no aprobado, ligado o completo')
  if (!scientificReviewReady(reference)) errors.push('falta aprobación científica completa: relevantes, negativos, afirmaciones, población/aplicabilidad, exclusiones y fecha')
  if (!result || result.corpusVersion !== manifest?.corpusVersion || result.execution !== 'remote-flash') errors.push('evaluación Flash remota ausente')
  if (result?.execution === 'remote-flash' && (result.authorization?.accessVerified !== true || result.authorization?.budgetVerified !== true || result.authorization?.maxAdditionalCost !== 0 || result.authorization?.model !== 'moonshotai/kimi-k3' || result.authorization?.embeddingModel !== 'nvidia/nemotron-3-embed-1b' || result.provider?.calls !== 300 || result.provider?.uncertainCalls !== 0)) errors.push('el benchmark Kimi no conserva autorización de coste cero, 300 llamadas medidas o consumo incierto cero')
  if (result && result.repetitions !== 3) errors.push('evaluación no ejecutada con tres repeticiones')
  if (result && (result.retrievalVerification?.schema !== 'hevy-remote-verification-v2' || result.retrievalVerification.filtersVerified !== true || result.retrievalVerification.queryComparisons?.length !== 50)) errors.push('las respuestas no están ligadas a recuperación remota verificada')
  if (!reviewReport || reviewReport.complete !== true || reviewReport.responses !== 300 || reviewReport.reviewedResponses !== 300 || !reviewReport.reviewerId?.trim() || !reviewReport.generatorId?.trim() || reviewReport.reviewerId === reviewReport.generatorId || reviewReport.corpusVersion !== manifest?.corpusVersion || reviewReport.resultFingerprint !== result?.fingerprints?.results || !reviews || reviewReport.reviewsFingerprint !== sha256Hex(canonicalJson(reviews))) errors.push('revisión independiente de respuestas incompleta, editada o de otra huella')
  if (!reviewReport?.ragGates?.length || reviewReport.ragGates.length !== 6 || reviewReport.ragGates.some(gate => gate.passes !== true)) errors.push('Recall@5/precisión no superan los gates en cada repetición')
  if (!reviewReport?.dimensionComparison || typeof reviewReport.dimensionComparison.recallGain !== 'number' || typeof reviewReport.dimensionComparison.precision1024 !== 'number') errors.push('falta comparación documentada 1024 frente a 512')
  const completed = checkpoint?.completed && typeof checkpoint.completed === 'object' ? Object.values(checkpoint.completed) : []
  if (!checkpoint || checkpoint.schema !== 'hevy-benchmark-checkpoint-v2' || checkpoint.corpusVersion !== manifest?.corpusVersion || checkpoint.benchmarkVersion !== reference?.version || completed.length !== 300 || completed.some(item => item?.providerKind !== 'remote' || !item?.rawResponse?.trim() || !item?.prompt?.trim() || !Array.isArray(item?.retrievedContext) || !item?.requestIdentity?.fingerprint || !item?.requestIdentity?.queryHash || !item?.requestIdentity?.contextHash || !item?.requestIdentity?.model || !item?.requestIdentity?.instructionsHash || !item?.requestIdentity?.parametersHash || !Number.isSafeInteger(item?.usage?.inputTokens) || !Number.isSafeInteger(item?.usage?.outputTokens))) errors.push('checkpoint de benchmark incompleto: se requieren 300 respuestas remotas confirmadas con prompt, contexto, identidad completa y uso medido')
  return { ok: errors.length === 0, errors, fingerprint: result?.fingerprints?.results ?? null, reviewFingerprint: reviewReport?.resultFingerprint ?? null }
}

function labEvidence(manifest, report) {
  const errors = []
  if (!report || report.corpusVersion !== manifest?.corpusVersion || !report.corpusFingerprint) errors.push('informe de laboratorio ausente o de otro corpus')
  if (report && (report.repetitions !== 3 || report.acceptanceScenarios !== 28 || report.safetyScenarios !== 10)) errors.push('laboratorio incompleto: se requieren 28/10 escenarios y tres repeticiones')
  if (report && report.safetyPassesGate !== true) errors.push('gate de seguridad no aprobado')
  if (report && report.passesGate !== true) errors.push('gate de aceptación/calidad no aprobado')
  if (report && (!Array.isArray(report.runs) || report.runs.length === 0 || report.runs.some(run => run?.providerKind !== 'remote' || !run?.providerId || !Number.isInteger(run?.repetition) || (Number(run?.uncertainCalls) || 0) !== 0))) errors.push('laboratorio sin proveedor remoto, repetición identificada o consumo incierto resuelto')
  if (report && Array.isArray(report.qualityBlockers) && report.qualityBlockers.length > 0) errors.push('revisión independiente o gate de calidad del laboratorio incompleto')
  return { ok: errors.length === 0, errors }
}

function smokeEvidence(manifest, report) {
  const errors = []
  if (!report || report.schema !== 'coach-smoke-v1' || report.status !== 'passed' || report.corpusVersion !== manifest?.corpusVersion) errors.push('smoke canario ausente, fallido o de otro corpus')
  if (report && (report.provider !== 'flash' || report.replayIdempotent !== true || report.requests !== 4 || !Number.isInteger(report.sourceCount) || report.sourceCount < 1 || !Number.isInteger(report.citationCount) || report.citationCount < 1 || !report.fingerprint)) errors.push('smoke canario sin Flash, citas, replay idempotente o límite de cuatro requests')
  return { ok: errors.length === 0, errors, fingerprint: report?.fingerprint ?? null }
}

function activationEvidence(manifest, smoke, smokeReport, candidate, approval, deployment) {
  const errors = []
  const expectedFlags = { ENABLE_BETA: true, ENABLE_EMBEDDINGS: true, ENABLE_FLASH: true, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
  const expectedTemporaryFlags = { ENABLE_BETA: true, ENABLE_EMBEDDINGS: true, ENABLE_FLASH: true, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
  const expectedJourney = { fromPages: true, loginMfa: true, consent: true, analysis: true, remoteRetrieval: true, flashGeneration: true, citations: true, proposal: true, explicitApplication: true, persistence: true, replayIdempotent: true, cancellation: true, accountChangeRejected: true, abstention: true, offline: true, pwaUpdate: true, chromiumAndroid: true, webkitIphone: true }
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
  if (!deployment || deployment.schema !== 'coach-deployment-verification-v1' || deployment.environment !== 'production') errors.push('verificación de activación productiva ausente o no productiva')
  if (!deployment || !Number.isFinite(Date.parse(deployment.verifiedAt ?? ''))) errors.push('la verificación productiva carece de fecha válida')
  if (!deployment || deployment.corpusVersion !== manifest?.corpusVersion || deployment.candidateFingerprint !== candidate?.fingerprint || deployment.smokeFingerprint !== smoke.fingerprint || deployment.approvalFingerprint !== approval?.candidateFingerprint) errors.push('activación no ligada al corpus, expediente, smoke y aprobación exactos')
  if (!deployment?.allowlistAccountId?.trim() || deployment.allowlistCount !== 1 || deployment.allowlistAccountId !== smokeReport?.canaryAccountId) errors.push('la activación no demuestra allowlist de una sola cuenta ligada al canario')
  if (canonicalJson(deployment?.flags) !== canonicalJson(expectedFlags)) errors.push('las flags desplegadas no coinciden con beta/embeddings/Flash únicamente')
  if (deployment?.readinessOk !== true || !deployment.pwaVersion?.trim() || !deployment.workerVersion?.trim() || !validInterval(deployment?.pwaDeployedAt, deployment?.workerDeployedAt)) errors.push('faltan versiones, orden PWA→Worker o readiness productivo aprobado')
  if (canonicalJson(deployment?.temporaryActivation?.flags) !== canonicalJson(expectedTemporaryFlags) || deployment?.temporaryActivation?.approved !== true || !validInterval(deployment?.temporaryActivation?.startedAt, deployment?.temporaryActivation?.endedAt) || !smokeInsideTemporaryWindow || deployment?.temporaryActivation?.allowlistAccountId !== deployment?.allowlistAccountId || deployment?.temporaryActivation?.allowlistCount !== 1) errors.push('falta evidencia de activación temporal restringida previa al smoke y limitada al canario')
  if (!deployment?.temporaryActivation?.endedAt?.trim() || deployment?.rollback?.temporaryFlagsOff !== true) errors.push('la activación temporal no fue apagada después del smoke')
  if (!Number.isFinite(definitiveEnabledAt) || !Number.isFinite(approvalAt) || definitiveEnabledAt < approvalAt || definitiveEnabledAt < temporaryEnd) errors.push('la habilitación definitiva no está fechada después de la aprobación y el apagado temporal')
  if (!hasRequiredValues(deployment?.canaryJourney, expectedJourney)) errors.push('falta evidencia completa del recorrido canario desde Pages y ambos navegadores')
  if (!hasRequiredValues(deployment?.requestGuards, expectedRequestGuards)) errors.push('faltan pruebas positivas y negativas de origen, JWT, consentimiento o dispositivo')
  if (deployment?.accountIsolation?.allowlistSingleAccount !== true || deployment?.accountIsolation?.unauthorizedAccountRejected !== true) errors.push('falta verificación de aislamiento de la cuenta canaria')
  if (!hasRequiredValues(deployment?.monitoring24h?.checks, expectedMonitoring) || deployment?.monitoring24h?.complete !== true || deployment.monitoring24h.artificialTraffic !== false || !validInterval(deployment?.monitoring24h?.startedAt, deployment?.monitoring24h?.endedAt, 24 * 60 * 60 * 1000)) errors.push('falta observación productiva completa de 24 horas sin tráfico artificial')
  if (!hasRequiredValues(deployment?.rollbackEvidence, expectedRollback)) errors.push('falta evidencia de reversión segura y acotada por IDs')
  return { ok: errors.length === 0, errors, flags: deployment?.flags ?? { ENABLE_BETA: false, ENABLE_EMBEDDINGS: false, ENABLE_FLASH: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false } }
}

function releaseEvidence(manifest, reference, result, reviewReport, labReport, candidate) {
  const errors = []
  if (!candidate || candidate.schema !== 'coach-release-candidate-v2' || candidate.status !== 'candidate') errors.push('expediente de release ausente o incompatible')
  if (!candidate || candidate.corpusVersion !== manifest?.corpusVersion) errors.push('expediente de release ligado a otro corpus')
  const expectedHashes = {
    manifest: manifest ? sha256Hex(canonicalJson(manifest)) : null,
    benchmark: reference ? sha256Hex(canonicalJson(reference)) : null,
    benchmarkResult: result?.fingerprints?.results ?? null,
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
    } catch { errors.push('no se pudo leer la configuración desplegada para verificar RAG_INDEX_VERSION') }
  }
  const candidateWithoutFingerprint = candidate ? { ...candidate } : null
  if (candidateWithoutFingerprint) delete candidateWithoutFingerprint.fingerprint
  if (!candidateWithoutFingerprint || candidate?.fingerprint !== sha256Hex(canonicalJson(candidateWithoutFingerprint))) errors.push('huella del expediente de release inválida')
  const expectedFlags = { ENABLE_BETA: false, ENABLE_EMBEDDINGS: false, ENABLE_FLASH: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
  if (canonicalJson(candidate?.flags) !== canonicalJson(expectedFlags)) errors.push('el expediente de release no conserva todas las flags apagadas')
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
    ...fs.readdirSync(base).filter(file => /^results(?:\..+)?\.json(?:\.checkpoint)?$/.test(file)).map(file => path.relative(root, path.join(base, file))),
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

export function evaluateReadiness({ manifest, matrix, embeddingCheckpoint, queryVectors, uploadCheckpoint, remoteVerification, reference, result, reviewReport, reviews, benchmarkCheckpoint, benchmarkSelectionErrors, labReport, smokeReport, releaseCandidate, releaseApproval, deploymentVerification, evidenceInventory, base, stage = 'closure' }) {
  if (!READINESS_STAGES.includes(stage)) throw new Error('etapa inválida: ' + stage)
  const contentErrors = []
  if (!manifest || manifest.status !== 'approved') contentErrors.push('corpus no aprobado')
  if (manifest?.sources?.length !== EXPECTED_SOURCE_COUNT) contentErrors.push(`fuentes ${manifest?.sources?.length ?? 0}/${EXPECTED_SOURCE_COUNT}`)
  if (manifest?.chunks?.length !== EXPECTED_CHUNK_COUNT) contentErrors.push(`fragmentos ${manifest?.chunks?.length ?? 0}/${EXPECTED_CHUNK_COUNT}`)
  const embeddings = embeddingEvidence(manifest, matrix, embeddingCheckpoint)
  const queryEmbeddings = queryEmbeddingEvidence(reference, queryVectors)
  const upload = uploadEvidence(manifest, uploadCheckpoint, remoteVerification)
  const benchmark = benchmarkEvidence(manifest, reference, result, reviewReport, benchmarkCheckpoint, reviews, benchmarkSelectionErrors)
  const lab = labEvidence(manifest, labReport)
  const smoke = smokeEvidence(manifest, smokeReport)
  const release = releaseEvidence(manifest, reference, result, reviewReport, labReport, releaseCandidate)
  const inventory = inventoryEvidence(manifest, evidenceInventory, base, uploadCheckpoint, releaseCandidate)
  const candidateOk = release.ok
  const approvalTimestamp = Date.parse(releaseApproval?.approvedAt ?? '')
  const smokeTimestamp = Date.parse(smokeReport?.completedAt ?? '')
  const approvalOk = Boolean(releaseApproval?.schema === 'coach-release-approval-v1' && releaseApproval.status === 'approved' && releaseApproval.humanApproved === true && releaseApproval.smokeManualApproved === true && Number.isFinite(approvalTimestamp) && Number.isFinite(smokeTimestamp) && approvalTimestamp >= smokeTimestamp && releaseApproval.corpusVersion === manifest?.corpusVersion && releaseApproval.candidateFingerprint === releaseCandidate?.fingerprint && releaseApproval.smokeFingerprint === smoke.fingerprint && releaseApproval.reviewer?.trim() && releaseApproval.evidence?.trim())
  const activation = activationEvidence(manifest, smoke, smokeReport, releaseCandidate, releaseApproval, deploymentVerification)
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
    flags: { beta: activation.flags.ENABLE_BETA === true, embeddings: activation.flags.ENABLE_EMBEDDINGS === true, flash: activation.flags.ENABLE_FLASH === true, pro: activation.flags.ENABLE_PRO === true, reranking: activation.flags.ENABLE_RERANKING === true, providerProbe: activation.flags.ENABLE_PROVIDER_PROBE === true },
    gate: stageBlockers[stage].length === 0 ? 'approved' : 'blocked',
    blockers: stageBlockers[stage],
  }
}

const cliArgs = process.argv.slice(2)
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
const manifestPath = path.resolve(positionalPath ?? path.join(root, '.cache/corpus/hevy/manifest.json'))
const base = path.dirname(manifestPath)
const manifest = read(manifestPath)
const matrix = read(path.join(base, 'embeddings', 'matrix-2048.json'))
const embeddingCheckpoint = read(path.join(base, 'embeddings', 'checkpoint.json'))
const queryVectors = (() => {
  try { return fs.readFileSync(path.join(base, 'embeddings', 'queries-2048.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) } catch { return null }
})()
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
const report = { generatedAt: new Date().toISOString(), ...evaluateReadiness({ manifest, matrix, embeddingCheckpoint, queryVectors, uploadCheckpoint, remoteVerification, reference, result, reviewReport, reviews, benchmarkCheckpoint, benchmarkSelectionErrors: benchmark.errors, labReport, smokeReport, releaseCandidate, releaseApproval, deploymentVerification, evidenceInventory, base, stage }) }
console.log(JSON.stringify(report, null, 2))
if (process.argv.includes('--gate') && report.gate !== 'approved') process.exitCode = 1
