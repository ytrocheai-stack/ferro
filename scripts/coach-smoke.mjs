#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { canonicalJson, sha256Base64url } from '../packages/corpus-identity/src/index.mjs'
import { scientificReviewReady } from '../packages/corpus-evaluation/src/scientific-review.mjs'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const has = name => args.includes(name)
function option(name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Falta valor de ${name}`)
  return value
}
function fail(message) { throw new Error(`coach:smoke: ${message}`) }
async function readJson(file) { return JSON.parse(await fs.readFile(path.resolve(root, file), 'utf8')) }
async function writeJson(file, value) {
  const target = path.resolve(root, file)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8')
  return target
}
function decodeSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.sub === 'string' ? payload.sub : undefined
  } catch { return undefined }
}
function assertFresh(value) {
  const age = Date.now() - Date.parse(value)
  if (!Number.isFinite(age) || age < 0 || age >= 86400000) fail('la autorización de smoke está ausente o caducada')
}
function comparableExposure(seed, index) {
  return {
    workoutId: 'canary-smoke-' + seed + '-previous-' + index,
    startedAt: Date.now() - ((index + 2) * 24 * 60 * 60 * 1000),
    exerciseId: 'squat',
    occurrenceId: 'canary-squat-1',
    role: 'strength',
    repRangeMin: 5,
    repRangeMax: 8,
    targetRpeMin: 7,
    targetRpeMax: 9,
    loadIncrementKg: 2.5,
    plannedSets: 3,
    plannedRepsMin: 5,
    plannedRepsMax: 8,
    sets: [1, 2, 3].map(() => ({ type: 'normal', weightKg: 80, reps: 8, completed: true, rpe: 8 })),
    feedback: { completed: true, energy: 4, difficulty: 3 },
  }
}
function sampleInput(seed, previousExposures = [0, 1, 2].map(index => comparableExposure(seed, index))) {
  return {
    workoutId: `canary-smoke-${seed}`,
    startedAt: Date.now() - 3600000,
    exerciseId: 'squat',
    occurrenceId: 'canary-squat-1',
    role: 'strength',
    repRangeMin: 5,
    repRangeMax: 8,
    targetRpeMin: 7,
    targetRpeMax: 9,
    loadIncrementKg: 2.5,
    plannedSets: 3,
    plannedRepsMin: 5,
    plannedRepsMax: 8,
    sets: [1, 2, 3].map(() => ({ type: 'normal', weightKg: 80, reps: 8, completed: true, rpe: 8 })),
    feedback: { completed: true, energy: 4, difficulty: 3 },
    previousExposures,
  }
}
function validateAuthorization(value) {
  if (!value || value.accessVerified !== true || value.budgetVerified !== true || value.maxAdditionalCost !== 0) fail('la autorización no demuestra acceso y coste adicional cero')
  for (const key of ['reviewer', 'evidence', 'canaryAccountId', 'expectedCorpusVersion', 'expectedConsentVersion']) if (typeof value[key] !== 'string' || !value[key].trim()) fail(`autorización sin ${key}`)
  if (value.expectedConsentVersion !== 'coach-beta-v1') fail('el consentimiento de smoke debe ser coach-beta-v1')
  const flags = value.temporaryFlags
  if (!flags || flags.ENABLE_BETA !== true || flags.ENABLE_EMBEDDINGS !== true || flags.ENABLE_FLASH !== true || flags.ENABLE_PRO !== false || flags.ENABLE_RERANKING !== false || flags.ENABLE_PROVIDER_PROBE !== false) fail('la activación temporal no está restringida a beta, embeddings y Flash')
  if (!Number.isInteger(value.maxRequests) || value.maxRequests < 4 || value.maxRequests > 4) fail('el smoke canario debe limitarse exactamente a cuatro requests')
  for (const key of ['maxInputTokens', 'maxOutputTokens', 'estimatedInputTokens', 'estimatedOutputTokens']) if (!Number.isSafeInteger(value[key]) || value[key] <= 0) fail(`autorización sin presupuesto entero positivo de smoke: ${key}`)
  if (value.estimatedInputTokens > value.maxInputTokens || value.estimatedOutputTokens > value.maxOutputTokens) fail('la estimación de tokens del smoke excede el presupuesto autorizado')
  if (!value.allocations?.smoke || value.allocations.smoke.calls !== 4 || value.allocations.smoke.inputTokens < value.estimatedInputTokens || value.allocations.smoke.outputTokens < value.estimatedOutputTokens) fail('el subpresupuesto smoke debe reservar exactamente cuatro requests y cubrir la estimación')
  assertFresh(value.verifiedAt)
}
async function validateGatePreflight(paths, expectedCorpusVersion) {
  const [reference, remote, review, lab, candidate] = await Promise.all(Object.values(paths).map(readJson))
  if (reference.status !== 'approved' || reference.corpusVersion !== expectedCorpusVersion || reference.queries?.length !== 50 || !scientificReviewReady(reference)) fail('el smoke requiere referencia científica aprobada para las 50 consultas')
  if (remote.schema !== 'hevy-remote-verification-v2' || remote.corpusVersion !== expectedCorpusVersion || remote.sources !== 88 || remote.chunks !== 2708 || remote.vectors512 !== 2708 || remote.vectors1024 !== 2708 || remote.queriesComplete !== true || remote.filtersMatchWorker !== true || remote.identityMismatches !== 0 || remote.excludedEvidence !== 0 || remote.legacyIndexVerified !== true) fail('el smoke requiere verificación remota completa del corpus candidato')
  if (review.schema !== 'hevy-independent-review-v1' || review.corpusVersion !== expectedCorpusVersion || review.responses !== 300 || review.reviewedResponses !== 300 || review.complete !== true || !Array.isArray(review.ragGates) || review.ragGates.length !== 6 || review.ragGates.some(gate => gate.passes !== true)) fail('el smoke requiere revisión independiente y gates RAG completos')
  if (lab.corpusVersion !== expectedCorpusVersion || lab.repetitions !== 3 || lab.acceptanceScenarios !== 28 || lab.safetyScenarios !== 10 || lab.passesGate !== true || lab.safetyPassesGate !== true) fail('el smoke requiere gates de aceptación y seguridad del laboratorio')
  const disabled = { ENABLE_BETA: false, ENABLE_EMBEDDINGS: false, ENABLE_FLASH: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
  if (candidate.schema !== 'coach-release-candidate-v2' || candidate.status !== 'candidate' || candidate.corpusVersion !== expectedCorpusVersion || JSON.stringify(candidate.flags) !== JSON.stringify(disabled)) fail('el smoke requiere expediente de release candidato con todas las flags apagadas')
}

async function main() {
  const output = option('--output', '.cache/corpus/hevy/smoke-report.json')
  if (!has('--execute')) {
    const report = { schema: 'coach-smoke-v1', status: 'blocked', reason: 'Añade --execute --confirm-canary, autorización fresca, token de archivo y URL de Pages/Worker; no se hicieron requests.' }
    console.log(JSON.stringify({ ...report, output: await writeJson(output, report) }, null, 2))
    return
  }
  if (!has('--confirm-canary')) fail('falta --confirm-canary; el smoke real puede consumir la cuota del canario')
  const baseUrl = option('--base-url')?.replace(/\/$/, '')
  const tokenPath = option('--token-file')
  const authorizationPath = option('--authorization')
  if (!baseUrl || !tokenPath || !authorizationPath) fail('requiere --base-url, --token-file y --authorization')
  const authorization = await readJson(authorizationPath)
  validateAuthorization(authorization)
  await validateGatePreflight({
    reference: option('--reference', '.cache/corpus/hevy/reference-final.json'),
    remote: option('--remote-verification', '.cache/corpus/hevy/remote-verification.json'),
    review: option('--review-report', '.cache/corpus/hevy/review-report.json'),
    lab: option('--lab-report', '.cache/corpus/hevy/agent-lab/report.json'),
    candidate: option('--release-candidate', '.cache/corpus/hevy/release-candidate.json'),
  }, authorization.expectedCorpusVersion)
  const token = (await fs.readFile(path.resolve(root, tokenPath), 'utf8')).trim()
  if (!token) fail('el archivo de token está vacío')
  const subject = decodeSubject(token)
  if (subject && subject !== authorization.canaryAccountId) fail('el subject del JWT no coincide con la cuenta canaria autorizada')
  const origin = option('--origin', 'https://ytrocheai-stack.github.io')
  const deviceId = option('--device-id')
  if (!deviceId?.trim()) fail('requiere --device-id del dispositivo canario')
  const headers = { Authorization: `Bearer ${token}`, Origin: origin, 'X-NextRep-Consent-Version': authorization.expectedConsentVersion, 'X-NextRep-Device-Id': deviceId, 'Content-Type': 'application/json' }
  let requests = 0
  async function call(method, pathname, body, extra = {}) {
    requests += 1
    if (requests > authorization.maxRequests) fail('se alcanzó el límite de requests del smoke')
    const response = await fetch(`${baseUrl}${pathname}`, { method, headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const payload = await response.json().catch(() => null)
    if (!response.ok) fail(`${method} ${pathname} devolvió HTTP ${response.status}: ${JSON.stringify(payload)}`)
    return payload
  }
  const readiness = await call('GET', '/readiness')
  if (readiness?.ok !== true || readiness?.corpusVersion !== authorization.expectedCorpusVersion || Object.values(readiness.checks ?? {}).some(value => value !== true)) fail('readiness no confirma el corpus candidato completo')
  const smokeSeed = authorization.expectedCorpusVersion.slice(-12)
  const requestBody = { inputs: [sampleInput(smokeSeed), sampleInput(smokeSeed + '-maintenance', [])], consentVersion: authorization.expectedConsentVersion, deviceId }
  const idempotencyKey = `coach-smoke-${Date.now().toString(36)}`
  const first = await call('POST', '/v1/adaptations/analyze', requestBody, { 'Idempotency-Key': idempotencyKey })
  const actionableDecision = first.decisions?.find(decision => decision.exerciseId === 'squat')
  const maintenanceDecision = first.decisions?.find(decision => decision.exerciseId === 'squat' && decision.comparableWorkoutIds?.length === 0)
  if (!actionableDecision?.candidates?.some(candidate => candidate.kind !== 'maintain')) fail('el caso con tres exposiciones comparables no produjo una propuesta accionable')
  if (!maintenanceDecision || maintenanceDecision.candidates.some(candidate => candidate.kind !== 'maintain')) fail('el caso sin historial no conservó exclusivamente maintain')
  const citationCount = (first.decisions ?? []).flatMap(decision => decision.candidates ?? []).reduce((total, candidate) => total + (Array.isArray(candidate.citations) ? candidate.citations.length : 0), 0)
  if (first?.provider !== 'flash' || first?.pendingExplanation === true || first?.corpusVersion !== authorization.expectedCorpusVersion || !Array.isArray(first?.sources) || first.sources.length === 0 || citationCount === 0) fail('la primera generación no confirma Flash, corpus y citas reales')
  const replay = await call('POST', '/v1/adaptations/analyze', requestBody, { 'Idempotency-Key': idempotencyKey })
  if (replay?.idempotent !== true || replay.analysisId !== first.analysisId || JSON.stringify(replay.decisions) !== JSON.stringify(first.decisions)) fail('el replay no fue idempotente o cambió la decisión')
  const decision = first.decisions?.[0]
  const selected = decision?.selectedCandidateId ?? decision?.fallbackCandidateId ?? null
  await call('POST', '/v1/adaptations/events', { analysisId: first.analysisId, exerciseId: decision?.exerciseId ?? 'squat', candidateId: selected, event: 'accepted' })
  const reportWithoutFingerprint = { schema: 'coach-smoke-v1', status: 'passed', completedAt: new Date().toISOString(), baseUrl, origin, canaryAccountId: authorization.canaryAccountId, corpusVersion: first.corpusVersion, readiness, requests, analysisId: first.analysisId, provider: first.provider, sourceCount: first.sources.length, citationCount, replayIdempotent: true, manualFollowUps: ['confirmar desde Pages login, consentimiento, aplicación explícita y persistencia visual', 'probar cancelación, cambio de cuenta, abstención y offline', 'apagar la activación temporal y obtener aprobación humana antes de consolidar flags'] }
  const report = { ...reportWithoutFingerprint, fingerprint: sha256Base64url(canonicalJson(reportWithoutFingerprint)) }
  console.log(JSON.stringify({ ...report, output: await writeJson(output, report) }, null, 2))
}

try { await main() } catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const output = option('--output', '.cache/corpus/hevy/smoke-report.json')
  try { await writeJson(output, { schema: 'coach-smoke-v1', status: 'failed', failedAt: new Date().toISOString(), error: message }) } catch { /* conserva el error principal */ }
  console.error(message)
  process.exitCode = 1
}
