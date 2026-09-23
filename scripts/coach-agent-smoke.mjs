import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, sha256Hex } from '../packages/corpus-identity/src/index.mjs'
import { createStatusReport } from './corpus-status.mjs'

const filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(filename), '..')
const args = process.argv.slice(2)
const GEMINI_MODEL = 'gemini-3.5-flash-lite'
const EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b'
const CONSENT_VERSION = 'coach-context-v4-gemini-nvidia-embeddings'
const EXPECTED_FLAGS = { ENABLE_BETA: true, ENABLE_EMBEDDINGS: true, ENABLE_FLASH: false, ENABLE_GEMINI: true, ENABLE_NVIDIA: false, ENABLE_COACH_STREAMING: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
export function option(flag, cliArgs = args) {
  const index = cliArgs.indexOf(flag)
  if (index < 0) return undefined
  const value = cliArgs[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Falta valor de ${flag}`)
  return value
}
function fail(message) { throw new Error(`coach:agent-smoke: ${message}`) }
async function readJson(file) { return JSON.parse(await fs.readFile(path.resolve(root, file), 'utf8')) }
function decodeSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.sub === 'string' ? payload.sub : undefined
  } catch { return undefined }
}
async function readProductionAccountId() {
  const config = await fs.readFile(path.join(root, 'worker/wrangler.production.toml'), 'utf8')
  const values = config.match(/^ALLOWED_CLERK_IDS\s*=\s*"([^"]*)"\s*$/m)?.[1].split(',').map(value => value.trim()).filter(Boolean) ?? []
  if (values.length !== 1) fail('worker/wrangler.production.toml debe contener exactamente una cuenta Clerk permitida')
  return values[0]
}
function readinessEvidence(readiness) {
  const configuration = readiness?.configuration
  const flags = configuration?.flags
  const models = configuration?.models
  if (readiness?.ok !== true || readiness?.checks?.productionConfig !== true || Object.values(readiness.checks ?? {}).some(value => value !== true)) fail('readiness no confirma producción completa')
  if (configuration?.environment !== 'production' || configuration?.providerOrder?.join(',') !== 'gemini' || models?.gemini !== GEMINI_MODEL || models?.embedding !== EMBEDDING_MODEL || configuration?.allowlist?.count !== 1) fail('readiness no confirma Gemini como único generador, NVIDIA para embeddings y allowlist de una cuenta')
  const expectedFlags = { beta: true, embeddings: true, flash: false, gemini: true, nvidia: false, coachStreaming: false, pro: false, reranking: false, providerProbe: false }
  if (canonicalJson(flags) !== canonicalJson(expectedFlags)) fail('readiness no confirma la activación temporal Gemini con las flags privadas esperadas')
  if (configuration?.consent?.requiredVersion !== 'coach-context-v4-gemini-nvidia-embeddings') fail('readiness devuelve una versión de consentimiento distinta de la vigente')
  if (typeof readiness.corpusVersion !== 'string' || !readiness.corpusVersion.trim()) fail('readiness no devuelve la versión de corpus activa')
  return {
    ok: readiness.ok,
    observedAt: new Date().toISOString(),
    environment: configuration.environment,
    corpusVersion: readiness.corpusVersion,
    checks: readiness.checks,
    configuration: {
      providerOrder: configuration.providerOrder,
      models: configuration.models,
      flags: configuration.flags,
      consent: configuration.consent,
      allowlist: configuration.allowlist,
    },
  }
}

export function validateAuthorization(value, productionAccountId, now = Date.now()) {
  if (!value || value.accessVerified !== true || value.budgetVerified !== true || value.maxAdditionalCost !== 0) fail('la autorización no demuestra acceso y coste adicional cero')
  if (value.canaryAccountId !== productionAccountId || !value.reviewer?.trim() || !value.evidence?.trim()) fail('la autorización no identifica la cuenta única de producción y su revisión')
  if (value.expectedConsentVersion !== CONSENT_VERSION || !value.expectedCorpusVersion?.trim()) fail('la autorización de canario no fija consentimiento y corpus vigentes')
  if (value.evaluationTrial?.scope !== 'private-evaluation' || value.evaluationTrial?.maxDurationHours !== 24) fail('el canario solo se autoriza para una evaluación privada de una cuenta y máximo 24 horas')
  const nvidia = value.nvidiaTesting
  const nvidiaVerifiedAt = Date.parse(nvidia?.verifiedAt ?? '')
  if (nvidia?.accessVerified !== true || nvidia?.budgetVerified !== true || nvidia?.maxAdditionalCost !== 0 || !nvidia?.evidence?.trim() || !Number.isFinite(nvidiaVerifiedAt) || nvidiaVerifiedAt > now || now - nvidiaVerifiedAt >= 86_400_000) fail('la autorización no demuestra acceso de prueba NVIDIA NIM y presupuesto vigente de coste cero')
  if (canonicalJson(value.temporaryFlags) !== canonicalJson(EXPECTED_FLAGS)) fail('la activación temporal debe usar Gemini como único generador y NVIDIA solo para embeddings')
  if (!Number.isInteger(value.maxRequests) || value.maxRequests < 6 || value.maxRequests > 24) fail('el smoke de /v1/coach/runs debe limitarse a entre 6 y 24 requests')
  for (const key of ['maxInputTokens', 'maxOutputTokens', 'estimatedInputTokens', 'estimatedOutputTokens']) if (!Number.isSafeInteger(value[key]) || value[key] <= 0) fail(`autorización sin presupuesto entero positivo: ${key}`)
  if (value.estimatedInputTokens > value.maxInputTokens || value.estimatedOutputTokens > value.maxOutputTokens) fail('la estimación del canario excede el presupuesto autorizado')
  if (!value.allocations?.smoke || value.allocations.smoke.calls < 4 || value.allocations.smoke.inputTokens < value.estimatedInputTokens || value.allocations.smoke.outputTokens < value.estimatedOutputTokens) fail('el subpresupuesto smoke debe reservar cuatro llamadas Gemini y cubrir la estimación')
  const timestamp = Date.parse(value.verifiedAt ?? '')
  if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp >= 86_400_000) fail('la autorización del canario está ausente, es futura o caducada')
  return { reviewer: value.reviewer, evidence: value.evidence, verifiedAt: value.verifiedAt, maxAdditionalCost: value.maxAdditionalCost, evaluationTrial: { scope: 'private-evaluation', maxDurationHours: 24 }, nvidiaTesting: { accessVerified: true, budgetVerified: true, maxAdditionalCost: 0, evidence: nvidia.evidence, verifiedAt: nvidia.verifiedAt } }
}

export function runSummary(response) {
  const run = response?.run
  return run && typeof run.id === 'string' ? {
    id: run.id,
    status: run.status,
    accountId: run.accountId,
    eventId: run.eventId,
    contextVersion: run.contextVersion,
    decisionPresent: Boolean(response?.decision),
    decisionKind: response?.decision?.kind,
    usage: run.usage,
  } : null
}

export function createCanaryReport({ baseUrl, origin, requests, canaryAccountId, authorization, readiness, firstRun, replay, continuationRun, cancellation, completedAt = new Date().toISOString() }) {
  const remoteEvidence = {
    readiness,
    generationProvider: readiness?.configuration?.providerOrder?.length === 1 && readiness.configuration.providerOrder[0] === 'gemini' ? 'gemini' : null,
    generationModel: readiness?.configuration?.models?.gemini ?? null,
    embeddingProvider: readiness?.configuration?.models?.embedding?.startsWith('nvidia/') ? 'nvidia' : null,
    embeddingModel: readiness?.configuration?.models?.embedding ?? null,
    firstRun,
    replay,
    continuationRun,
    cancellation,
  }
  const body = {
    schema: 'coach-agent-smoke-v3',
    status: 'passed',
    endpoint: '/v1/coach/runs',
    authenticated: true,
    completedAt,
    baseUrl,
    origin,
    requests,
    canaryAccountId,
    corpusVersion: readiness?.corpusVersion,
    provider: 'gemini',
    model: GEMINI_MODEL,
    evaluationTrial: { scope: authorization.evaluationTrial.scope, maxDurationHours: authorization.evaluationTrial.maxDurationHours, accountId: canaryAccountId },
    authorization: { reviewer: authorization.reviewer, evidence: authorization.evidence, verifiedAt: authorization.verifiedAt, maxAdditionalCost: 0, nvidiaTesting: authorization.nvidiaTesting },
    remoteEvidence,
    manualFollowUps: ['validar cambio de cuenta, consentimiento revocado y abstención desde Pages', 'registrar por separado el resultado E2E con Worker simulado; no acredita dispositivo físico ni proveedor remoto'],
  }
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) }
}

export async function runCanary(cliArgs = args, { fetcher = fetch, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  if (!cliArgs.includes('--execute')) return { schema: 'coach-agent-smoke-v3', status: 'blocked', reason: 'Añade --execute con autorización canaria, JWT y contexto consentido; no se hicieron requests.' }
  const baseUrl = option('--base-url', cliArgs)?.replace(/\/$/, '')
  const tokenFile = option('--token-file', cliArgs)
  const contextFile = option('--context-file', cliArgs)
  const authorizationPath = option('--authorization', cliArgs)
  const deviceId = option('--device-id', cliArgs)
  const origin = option('--origin', cliArgs) ?? 'https://ytrocheai-stack.github.io'
  const maxPolls = Number(option('--max-polls', cliArgs) ?? 15)
  if (!baseUrl || !tokenFile || !contextFile || !authorizationPath || !deviceId?.trim()) fail('requiere --base-url, --token-file, --context-file, --authorization y --device-id')
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1) fail('límites de polling inválidos')
  const productionAccountId = await readProductionAccountId()
  const authorization = await readJson(authorizationPath)
  const authorizationEvidence = validateAuthorization(authorization, productionAccountId)
  const manifestPath = option('--manifest', cliArgs) ?? '.cache/corpus/hevy/manifest.json'
  const preflight = await createStatusReport({ cliArgs: [manifestPath, '--stage', 'canary'] })
  if (preflight.report.stages.evaluation.status !== 'approved' || preflight.report.approval.candidate !== true) fail('el benchmark Gemini, revisión independiente, laboratorio y expediente candidato deben pasar antes del canario')
  if (preflight.report.corpusVersion !== authorization.expectedCorpusVersion) fail('el expediente preflight no coincide con el corpus de la autorización')
  const token = (await fs.readFile(path.resolve(root, tokenFile), 'utf8')).trim()
  if (!token) fail('el archivo JWT está vacío')
  if (decodeSubject(token) !== productionAccountId) fail('el subject del JWT no coincide con la única cuenta de producción')
  const request = await readJson(contextFile)
  if (request?.event?.type !== 'message-sent' || request.event.deviceId !== deviceId || request.event.contextVersion !== request.context?.version || request.context?.isCurrent !== true || request.context?.snapshot?.consentVersion !== CONSENT_VERSION) fail('el archivo no contiene un contexto vigente con el consentimiento actual')
  const headers = { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json', 'X-NextRep-Consent-Version': CONSENT_VERSION, 'X-NextRep-Device-Id': deviceId }
  let requests = 0
  const maxRequests = Number(option('--max-requests', cliArgs) ?? authorization.maxRequests)
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 6 || maxRequests > authorization.maxRequests) fail('el límite de requests excede la autorización o no permite completar el canario')
  async function call(method, pathname, body, extra = {}) {
    if (++requests > maxRequests) fail(`se alcanzó el límite autorizado de ${maxRequests} requests`)
    const response = await fetcher(`${baseUrl}${pathname}`, { method, headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const payload = await response.json().catch(() => null)
    if (!response.ok) fail(`${method} ${pathname} devolvió HTTP ${response.status}`)
    return payload
  }
  const readinessResponse = await call('GET', '/readiness')
  if (readinessResponse?.corpusVersion !== authorization.expectedCorpusVersion || readinessResponse?.configuration?.consent?.requiredVersion !== CONSENT_VERSION) fail('readiness devuelve otro corpus o consentimiento')
  const readiness = readinessEvidence(readinessResponse)
  const idempotencyKey = `coach-agent-smoke-${Date.now().toString(36)}`
  const firstCreated = await call('POST', '/v1/coach/runs', request, { 'Idempotency-Key': idempotencyKey })
  const firstQueued = runSummary(firstCreated)
  if (!firstQueued?.id || firstQueued.status !== 'queued' || firstQueued.accountId !== productionAccountId || firstQueued.eventId !== request.event.id || firstQueued.contextVersion !== request.context.version) fail('la creación autenticada no devolvió una corrida queued de la cuenta y evento esperados')
  const replayResponse = await call('POST', '/v1/coach/runs', request, { 'Idempotency-Key': idempotencyKey })
  const replay = runSummary(replayResponse)
  if (replay?.id !== firstQueued.id || replay.eventId !== firstQueued.eventId || replay.accountId !== productionAccountId || !['queued', 'running', 'completed'].includes(replay.status)) fail('el replay autenticado no devolvió la misma corrida y cuenta')
  let completedResponse = await call('GET', `/v1/coach/runs/${encodeURIComponent(firstQueued.id)}`)
  if (completedResponse?.run?.id !== firstQueued.id || completedResponse?.run?.accountId !== productionAccountId) fail('la lectura autenticada no devolvió la corrida y cuenta esperadas')
  for (let poll = 0; poll < maxPolls && ['queued', 'running'].includes(completedResponse?.run?.status); poll += 1) {
    await wait(2_000)
    completedResponse = await call('GET', `/v1/coach/runs/${encodeURIComponent(firstQueued.id)}`)
  }
  const completedRun = runSummary(completedResponse)
  if (completedRun?.status !== 'completed' || completedRun.accountId !== productionAccountId || completedRun.eventId !== firstQueued.eventId || !completedRun.decisionPresent || ['unavailable', 'abstain'].includes(completedRun.decisionKind) || !Number.isSafeInteger(completedRun.usage?.inputTokens) || !Number.isSafeInteger(completedRun.usage?.outputTokens)) fail('la primera corrida autenticada no terminó con decisión y uso medido')
  const continuationRequest = structuredClone(request)
  continuationRequest.event = { ...continuationRequest.event, id: `${continuationRequest.event.id}-continuation-${Date.now().toString(36)}`, causedByEventId: completedRun.eventId }
  continuationRequest.event.payload = { ...continuationRequest.event.payload, message: `${String(continuationRequest.event.payload?.message ?? '')}\nRespuesta de continuación del canario.` }
  const continuationResponse = await call('POST', '/v1/coach/runs', continuationRequest, { 'Idempotency-Key': `${idempotencyKey}-continuation` })
  const continuationRun = runSummary(continuationResponse)
  if (!continuationRun?.id || continuationRun.id === completedRun.id || continuationRun.status !== 'queued' || continuationRun.accountId !== productionAccountId || continuationRun.eventId !== continuationRequest.event.id) fail('la continuación autenticada no devolvió otra corrida queued de la cuenta permitida')
  const cancellationResponse = await call('POST', `/v1/coach/runs/${encodeURIComponent(continuationRun.id)}/cancel`, {}, { 'Idempotency-Key': `${idempotencyKey}-cancel` })
  const cancellation = runSummary(cancellationResponse)
  if (cancellation?.id !== continuationRun.id || cancellation.accountId !== productionAccountId || !['cancelled', 'completed'].includes(cancellation.status)) fail('la cancelación autenticada no devolvió un estado terminal de la corrida esperada')
  return createCanaryReport({ baseUrl, origin, requests, canaryAccountId: productionAccountId, authorization: authorizationEvidence, readiness, firstRun: completedRun, replay, continuationRun, cancellation })
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  const output = option('--output', process.argv.slice(2)) ?? '.cache/corpus/hevy/smoke-report.json'
  try {
    const report = await runCanary()
    const target = path.resolve(root, output)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(JSON.stringify({ ...report, output: target }, null, 2))
    if (report.status !== 'passed') process.exitCode = 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failed = { schema: 'coach-agent-smoke-v3', status: 'failed', failedAt: new Date().toISOString(), error: message }
    try {
      const target = path.resolve(root, output)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, JSON.stringify(failed, null, 2) + '\n', 'utf8')
    } catch { /* conserva el error principal */ }
    console.error(message)
    process.exitCode = 1
  }
}
