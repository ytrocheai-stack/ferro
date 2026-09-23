import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonicalJson, sha256Hex } from '../packages/corpus-identity/src/index.mjs'
import { responseFingerprint } from '../packages/corpus-evaluation/src/index.mjs'
import { createReleaseCandidate } from './corpus-release.mjs'
import { activationEvidence, benchmarkEvidence, evaluateReadiness, humanReleaseApprovalEvidence, labEvidence, releaseEvidence, smokeEvidence } from './corpus-status.mjs'
import { createCanaryReport, option as smokeOption, validateAuthorization } from './coach-agent-smoke.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GEMINI = 'gemini-3.5-flash-lite'
const NVIDIA = 'nvidia/nemotron-3-embed-1b'
const ACCOUNT = 'user_test_single'
const CORPUS = 'approved-fixture-corpus'
const BENCHMARK = 'approved-fixture-benchmark'
const now = Date.parse('2026-09-23T12:00:00.000Z')
const tempDirectories = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    const resolved = path.resolve(directory)
    const cacheRoot = path.resolve(root, '.cache') + path.sep
    if (!resolved.startsWith(cacheRoot)) throw new Error('test cleanup target escaped .cache')
    rmSync(resolved, { recursive: true, force: true })
  }
})

function fixture({ reviewerType = 'human', artifactTime = now - 3_600_000 } = {}) {
  const reviewerId = reviewerType === 'agent' ? 'independent-review-agent' : 'independent-human'
  const manifest = { status: 'approved', corpusVersion: CORPUS, sources: Array.from({ length: 88 }, (_, i) => ({ id: `source-${i}` })), chunks: Array.from({ length: 2708 }, (_, i) => ({ id: `chunk-${i}` })) }
  const reference = {
    status: 'approved', version: BENCHMARK, corpusVersion: CORPUS,
    queries: Array.from({ length: 50 }, (_, i) => ({ queryId: `q-${i}` })),
    scientificReview: { approved: true, reviewer: 'responsable', notes: 'Revisado', queryCount: 50, relevantReviewed: true, hardNegativesReviewed: true, claimsReviewed: true, populationApplicabilityReviewed: true, exclusionsCertified: true, reviewedAt: new Date(artifactTime).toISOString() },
  }
  const result = {
    schema: 'generated-benchmark-v4', responseSchemaVersion: 4, corpusVersion: CORPUS, benchmarkVersion: BENCHMARK,
    execution: 'remote-gemini-complete', generationModel: GEMINI, model: NVIDIA, repetitions: 3,
    formalRemoteResponsesRequired: 300, formalRemoteResponsesComplete: 300,
    authorization: { provider: 'google-ai-studio', accessVerified: true, budgetVerified: true, maxAdditionalCost: 0, model: GEMINI, embeddingModel: NVIDIA },
    provider: { calls: 300, uncertainCalls: 0 },
    retrievalVerification: { schema: 'hevy-remote-verification-v2', filtersVerified: true, queryComparisons: Array.from({ length: 50 }, (_, i) => ({ queryId: `q-${i}` })) },
    runs: [],
  }
  result.runs = Array.from({ length: 3 }, (_, repetition) => ({
    repetition,
    citations: Object.fromEntries([512, 1024].map(dimensions => [dimensions, Array.from({ length: 50 }, (_, i) => ({
      queryId: `q-${i}`, repetition, providerKind: 'remote', retrievalSource: 'remote-vectorize', parseError: false,
      rawResponse: `raw Gemini response ${repetition}-${dimensions}-${i}`, responseText: `respuesta ${repetition}-${dimensions}-${i}`,
      requestIdentity: { model: GEMINI, fingerprint: 'a'.repeat(64) },
      usage: { inputTokens: 20, outputTokens: 10 }, usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
      retrievedChunkIds: [], retrievedContext: [], vectorRetrievedChunkIds: [], citations: [], claims: [],
    }))])),
  }))
  result.citations = result.runs[0].citations
  result.fingerprints = { results: sha256Hex(canonicalJson(result)) }
  const reviews = {
    schema: 'hevy-response-reviews-v1', reviewerId, generatorId: GEMINI, reviewerType, independent: true,
    fingerprints: { corpus: 'corpus-fp', benchmark: 'benchmark-fp', results: result.fingerprints.results },
    responses: result.runs.flatMap(run => [512, 1024].flatMap(dimensions => run.citations[dimensions].map(item => ({
      dimensions, repetition: run.repetition, queryId: item.queryId,
      responseFingerprint: responseFingerprint(item, dimensions, CORPUS, BENCHMARK),
      reviewerId, generatorId: GEMINI, justification: 'La respuesta se cotejó con el contexto.', notes: 'Revisión independiente completada.',
      contextFaithful: true, sportsCoherent: true, applicable: true, uncertaintyHandled: true, allNewClaimsReviewed: true, claims: [],
    })))),
  }
  const reviewReport = {
    schema: 'hevy-independent-review-v1', complete: true, independentReviewer: true,
    reviewerId, generatorId: GEMINI, reviewerType, corpusVersion: CORPUS, responses: 300, reviewedResponses: 300,
    resultFingerprint: result.fingerprints.results, fingerprints: { results: result.fingerprints.results },
    reviewsFingerprint: sha256Hex(canonicalJson(reviews)), reviewedAt: new Date(artifactTime).toISOString(),
    ragGates: Array.from({ length: 6 }, () => ({ passes: true })), dimensionComparison: { recallGain: 0.04, precision1024: 0.95 },
  }
  const completed = {}
  for (const run of result.runs) for (const dimensions of [512, 1024]) for (const item of run.citations[dimensions]) {
    completed[`${run.repetition}:${dimensions}:${item.queryId}`] = {
      ...item, prompt: 'prompt', requestIdentity: { ...item.requestIdentity, queryHash: 'query-hash', contextHash: 'context-hash', instructionsHash: 'instructions-hash', parametersHash: 'parameters-hash' },
    }
  }
  const benchmarkCheckpoint = { schema: 'hevy-benchmark-checkpoint-v5', corpusVersion: CORPUS, benchmarkVersion: BENCHMARK, completed, updatedAt: new Date(artifactTime).toISOString() }
  const labScenarioIds = Array.from({ length: 38 }, (_, scenario) => `scenario-${scenario}`)
  const labRuns = Array.from({ length: 3 }, (_, repetition) => Array.from({ length: 38 }, (_, scenario) => ({
    repetition, scenarioId: `scenario-${scenario}`, providerKind: 'remote', providerId: GEMINI, fingerprint: `${repetition}-${scenario}`, uncertainCalls: 0,
  }))).flat()
  labRuns.push({ ...labRuns[0], scenarioId: 'scenario-0:continuation', fingerprint: '0-continuation' })
  const labReport = {
    corpusVersion: CORPUS, corpusFingerprint: 'corpus-fp', repetitions: 3, acceptanceScenarios: 28, safetyScenarios: 10,
    passesGate: true, safetyPassesGate: true, qualityBlockers: [], runs: labRuns,
    checkpoint: { schema: 'agent-lab-checkpoint-v2', uncertainCalls: 0, scenarioIds: labScenarioIds, runs: labRuns, updatedAt: new Date(artifactTime).toISOString() },
  }
  return { manifest, reference, result, reviews, reviewReport, benchmarkCheckpoint, labReport }
}

function smokeFixture(candidate, completedAt = new Date(now - 30 * 60_000).toISOString()) {
  const canaryTime = Date.parse(completedAt)
  const readiness = {
    ok: true, observedAt: new Date(canaryTime - 5 * 60_000).toISOString(), environment: 'production', corpusVersion: CORPUS,
    checks: { productionConfig: true, config: true, d1: true, index: true, corpus: true },
    configuration: {
      providerOrder: ['gemini'], models: { gemini: GEMINI, embedding: NVIDIA }, allowlist: { count: 1 },
      flags: { beta: true, embeddings: true, flash: false, gemini: true, nvidia: false, coachStreaming: false, pro: false, reranking: false, providerProbe: false },
    },
  }
  const baseRun = { id: 'run-first', status: 'completed', accountId: candidate.allowlist.accountId, eventId: 'event-first', contextVersion: 'context-v1', decisionPresent: true, decisionKind: 'maintain', usage: { inputTokens: 10, outputTokens: 5 } }
  return createCanaryReport({
    baseUrl: 'https://worker.example.test', origin: 'https://ytrocheai-stack.github.io', requests: 7,
    canaryAccountId: candidate.allowlist.accountId,
    authorization: { reviewer: 'owner', evidence: 'Gemini generation cost and allowance checked.', verifiedAt: new Date(canaryTime - 60 * 60_000).toISOString(), maxAdditionalCost: 0, evaluationTrial: { scope: 'private-evaluation', maxDurationHours: 24 }, nvidiaTesting: { accessVerified: true, budgetVerified: true, maxAdditionalCost: 0, evidence: 'NVIDIA test endpoint access and free quota verified.', verifiedAt: new Date(canaryTime - 60 * 60_000).toISOString() } },
    readiness,
    firstRun: baseRun,
    replay: { ...baseRun, status: 'running' },
    continuationRun: { id: 'run-continuation', status: 'queued', accountId: candidate.allowlist.accountId, eventId: 'event-continuation', contextVersion: 'context-v1', decisionPresent: false },
    cancellation: { id: 'run-continuation', status: 'cancelled', accountId: candidate.allowlist.accountId, eventId: 'event-continuation', contextVersion: 'context-v1', decisionPresent: false },
    completedAt,
  })
}

function deploymentFixture(candidate, smoke, approval) {
  const iso = hours => new Date(now - hours * 60 * 60_000).toISOString()
  const flags = { ENABLE_BETA: true, ENABLE_EMBEDDINGS: true, ENABLE_FLASH: false, ENABLE_GEMINI: true, ENABLE_NVIDIA: false, ENABLE_COACH_STREAMING: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
  const simulated = { status: 'passed', mode: 'simulated-worker', realWorkerVerified: false, physicalDeviceVerified: false }
  return {
    schema: 'coach-deployment-verification-v3', deploymentMode: 'production', environment: 'production', verifiedAt: iso(18), corpusVersion: CORPUS,
    candidateFingerprint: candidate.fingerprint, approvalFingerprint: sha256Hex(canonicalJson(approval)), smokeFingerprint: smoke.fingerprint,
    allowlistAccountId: candidate.allowlist.accountId, allowlistCount: 1,
    pwaVersion: 'pwa-sha', workerVersion: 'worker-version', pwaDeployedAt: iso(46), workerDeployedAt: iso(45), readinessOk: true,
    generation: { provider: 'gemini', model: GEMINI }, embeddings: { provider: 'nvidia', model: NVIDIA }, definitiveEnabledAt: iso(44),
    nvidiaProductionEntitlement: { schema: 'nvidia-production-entitlement-v1', status: 'verified', product: 'nvidia-nim', licenseType: 'ai-enterprise', model: NVIDIA, productionUseAuthorized: true, verifiedBy: 'license-owner', evidence: 'AI Enterprise entitlement verified against the organization account.', verifiedAt: iso(2) },
    temporaryActivation: { approved: true, startedAt: iso(49), endedAt: iso(47), allowlistAccountId: candidate.allowlist.accountId, allowlistCount: 1, flags },
    rollback: { temporaryFlagsOff: true },
    canaryJourney: { fromPages: true, loginMfa: true, consent: true, analysis: true, remoteRetrieval: true, geminiGeneration: true, citations: true, proposal: true, explicitApplication: true, persistence: true, replayIdempotent: true, cancellation: true, accountChangeRejected: true, abstention: true, offline: true, pwaUpdate: true },
    simulatedE2e: { chromiumAndroid: structuredClone(simulated), webkitIphone: structuredClone(simulated) },
    requestGuards: { originValidated: true, jwtValidated: true, consentValidated: true, deviceValidated: true, unauthorizedOriginRejected: true, invalidJwtRejected: true, invalidConsentRejected: true, deviceMismatchRejected: true },
    accountIsolation: { allowlistSingleAccount: true, allowlistAccountId: candidate.allowlist.accountId, unauthorizedAccountRejected: true },
    flags,
    monitoring24h: { complete: true, artificialTraffic: false, startedAt: iso(43), endedAt: iso(19), checks: { errors: true, reservations: true, consumption: true, abstentions: true, citations: true, cron: true } },
    rollbackEvidence: { configurationRestorable: true, indexedDbPreserved: true, migrationsAdditive: true, candidateDeletionScoped: true },
  }
}

function privateTrialDeployment(candidate, smoke, approval) {
  const iso = hours => new Date(now - hours * 60 * 60_000).toISOString()
  const trialFlags = { ENABLE_BETA: true, ENABLE_EMBEDDINGS: true, ENABLE_FLASH: false, ENABLE_GEMINI: true, ENABLE_NVIDIA: false, ENABLE_COACH_STREAMING: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
  const closedFlags = { ENABLE_BETA: false, ENABLE_EMBEDDINGS: false, ENABLE_FLASH: false, ENABLE_GEMINI: false, ENABLE_NVIDIA: false, ENABLE_COACH_STREAMING: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false }
  const trial = { schema: 'coach-private-evaluation-trial-v1', status: 'closed', scope: 'private-evaluation', maxDurationHours: 24, startedAt: approval.trialStartsAt, expiresAt: approval.trialExpiresAt, closedAt: iso(23 + 50 / 60), allowlistAccountId: candidate.allowlist.accountId, allowlistCount: 1, activeFlags: trialFlags, closure: { mode: 'operational-rollback-at-expiry', flagsOff: true, readinessRejected: true, noCoachRequestsAfterExpiry: true, completedAt: iso(23 + 50 / 60), evidence: 'Rollback at expiry; post-expiry readiness and request checks rejected.' } }
  const deployment = deploymentFixture(candidate, smoke, approval)
  return {
    ...deployment,
    schema: 'coach-deployment-verification-v3', deploymentMode: 'private-evaluation', verifiedAt: iso(1),
    pwaDeployedAt: iso(52), workerDeployedAt: iso(51.5), readinessOk: false,
    definitiveEnabledAt: trial.startedAt,
    temporaryActivation: { approved: true, startedAt: iso(50), endedAt: iso(49), allowlistAccountId: candidate.allowlist.accountId, allowlistCount: 1, flags: trialFlags },
    rollback: { temporaryFlagsOff: true },
    flags: closedFlags,
    evaluationTrial: trial,
    monitoring24h: { complete: true, artificialTraffic: false, startedAt: trial.startedAt, endedAt: trial.expiresAt, checks: { errors: true, reservations: true, consumption: true, abstentions: true, citations: true, cron: true } },
    nvidiaProductionEntitlement: undefined,
  }
}

describe('gates de release Gemini', () => {
  it('bloquea el cierre si faltan los artefactos', () => {
    const report = evaluateReadiness({ base: path.join(root, '.cache', 'fixture-absent'), stage: 'closure', now })
    assert.equal(report.gate, 'blocked')
    assert.equal(report.approval.human, false)
    assert.equal(report.flags.beta, false)
    assert.ok(report.blockers.length > 0)
  })

  it('acepta 300 respuestas Gemini revisadas con huellas coincidentes y el laboratorio 28+10×3', () => {
    const f = fixture()
    const benchmark = benchmarkEvidence(f.manifest, f.reference, f.result, f.reviewReport, f.benchmarkCheckpoint, f.reviews, [], now)
    const lab = labEvidence(f.manifest, f.labReport, now)
    assert.equal(benchmark.ok, true, benchmark.errors.join('; '))
    assert.equal(lab.ok, true, lab.errors.join('; '))
    assert.equal(benchmark.fingerprint, f.result.fingerprints.results)
  })

  it('bloquea evidencia Gemini con checkpoint viejo o corrida Kimi', () => {
    const f = fixture()
    const oldCheckpoint = { ...f.benchmarkCheckpoint, updatedAt: new Date(now - 31 * 24 * 60 * 60_000).toISOString() }
    const stale = benchmarkEvidence(f.manifest, f.reference, f.result, f.reviewReport, oldCheckpoint, f.reviews, [], now)
    assert.equal(stale.ok, false)
    assert.match(stale.errors.join(' '), /30 días/)
    const kimi = { ...f.result, execution: 'remote-flash', generationModel: 'moonshotai/kimi-k3' }
    kimi.fingerprints = { results: sha256Hex(canonicalJson(kimi)) }
    const rejected = benchmarkEvidence(f.manifest, f.reference, kimi, f.reviewReport, f.benchmarkCheckpoint, f.reviews, [], now)
    assert.equal(rejected.ok, false)
  })

  it('rechaza resultados y checkpoints de la generación anterior aunque tengan 300 respuestas', () => {
    const f = fixture()
    const oldResult = { ...f.result, schema: 'generated-benchmark-v3', responseSchemaVersion: 3 }
    delete oldResult.fingerprints
    oldResult.fingerprints = { results: sha256Hex(canonicalJson(oldResult)) }
    const rejectedResult = benchmarkEvidence(f.manifest, f.reference, oldResult, f.reviewReport, f.benchmarkCheckpoint, f.reviews, [], now)
    assert.equal(rejectedResult.ok, false)
    assert.match(rejectedResult.errors.join(' '), /identidad de instrucciones antigua/)

    const oldCheckpoint = { ...f.benchmarkCheckpoint, schema: 'hevy-benchmark-checkpoint-v4' }
    const rejectedCheckpoint = benchmarkEvidence(f.manifest, f.reference, f.result, f.reviewReport, oldCheckpoint, f.reviews, [], now)
    assert.equal(rejectedCheckpoint.ok, false)
    assert.match(rejectedCheckpoint.errors.join(' '), /instrucciones antiguas/)
  })

  it('valida un canario autenticado y liga modelo, corpus, cuenta y run IDs a respuestas remotas', () => {
    const f = fixture()
    const candidate = { allowlist: { accountId: ACCOUNT, count: 1 } }
    const smoke = smokeFixture(candidate)
    const canary = smokeEvidence(f.manifest, smoke, candidate, now)
    assert.equal(canary.ok, true, canary.errors.join('; '))
    assert.equal(canary.accountId, ACCOUNT)
    const mismatched = structuredClone(smoke)
    mismatched.remoteEvidence.firstRun.accountId = 'user_other'
    delete mismatched.fingerprint
    mismatched.fingerprint = sha256Hex(canonicalJson(mismatched))
    assert.equal(smokeEvidence(f.manifest, mismatched, candidate, now).ok, false)
  })

  it('aprueba activación solo tras aprobación humana y 24h; marca WebKit como simulado', () => {
    const candidate = { fingerprint: 'candidate-fp', createdAt: new Date(now - 50 * 60 * 60_000).toISOString(), allowlist: { accountId: ACCOUNT, count: 1 } }
    const smokeReport = { completedAt: new Date(now - 48 * 60 * 60_000).toISOString(), canaryAccountId: ACCOUNT }
    const smoke = { ok: true, fingerprint: 'smoke-fp', accountId: ACCOUNT }
    const approval = { schema: 'coach-release-approval-v1', status: 'approved', releaseMode: 'production', humanApproved: true, smokeManualApproved: true, approvedAt: new Date(now - 46 * 60 * 60_000).toISOString(), reviewer: 'responsable-humano', evidence: 'Revisión final del release.', corpusVersion: CORPUS, candidateFingerprint: candidate.fingerprint, smokeFingerprint: smoke.fingerprint }
    const deployment = deploymentFixture(candidate, smoke, approval)
    assert.equal(activationEvidence({ corpusVersion: CORPUS }, smoke, smokeReport, candidate, approval, deployment, now).ok, true)
    assert.equal(activationEvidence({ corpusVersion: CORPUS }, smoke, smokeReport, candidate, { ...approval, humanApproved: false }, deployment, now).ok, false)
    const shortMonitoring = structuredClone(deployment)
    shortMonitoring.monitoring24h.startedAt = new Date(Date.parse(shortMonitoring.monitoring24h.endedAt) - 23 * 60 * 60_000).toISOString()
    assert.equal(activationEvidence({ corpusVersion: CORPUS }, smoke, smokeReport, candidate, approval, shortMonitoring, now).ok, false)
    const falselyReal = structuredClone(deployment)
    falselyReal.simulatedE2e.webkitIphone.physicalDeviceVerified = true
    assert.equal(activationEvidence({ corpusVersion: CORPUS }, smoke, smokeReport, candidate, approval, falselyReal, now).ok, false)
  })

  it('crea el expediente con beta cerrada y fija las flags reales de la configuración Gemini', async () => {
    const f = fixture()
    const directory = mkdtempSync(path.join(root, '.cache', 'release-gates-'))
    tempDirectories.push(directory)
    const write = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2))
    write('manifest.json', f.manifest)
    write('reference.json', f.reference)
    write('results.json', f.result)
    write('results.json.checkpoint.json', f.benchmarkCheckpoint)
    write('review.json', f.reviewReport)
    write('reviews.json', f.reviews)
    write('lab.json', f.labReport)
    const configPath = path.join(directory, 'production.toml')
    const productionConfig = `ALLOWED_CLERK_IDS = "${ACCOUNT}"\nENABLE_BETA = "false"\nENABLE_EMBEDDINGS = "true"\nENABLE_FLASH = "false"\nENABLE_GEMINI = "true"\nENABLE_NVIDIA = "false"\nENABLE_COACH_STREAMING = "false"\nENABLE_PRO = "false"\nENABLE_RERANKING = "false"\nENABLE_PROVIDER_PROBE = "false"\nCOACH_PROVIDER_ORDER = "gemini"\nGEMINI_MODEL = "${GEMINI}"\nEMBEDDING_MODEL = "${NVIDIA}"\nRAG_INDEX_VERSION = "${CORPUS}"\n`
    writeFileSync(configPath, productionConfig)
    const result = await createReleaseCandidate({
      manifestPath: path.join(directory, 'manifest.json'), referencePath: path.join(directory, 'reference.json'), resultPath: path.join(directory, 'results.json'),
      reviewPath: path.join(directory, 'review.json'), reviewsPath: path.join(directory, 'reviews.json'), labPath: path.join(directory, 'lab.json'),
      configPath, outputPath: path.join(directory, 'release-candidate.json'), now,
    })
    assert.equal(result.candidate.status, 'candidate')
    assert.deepEqual(result.candidate.generation, { provider: 'google-ai-studio', model: GEMINI })
    assert.deepEqual(result.candidate.embeddings, { provider: 'nvidia', model: NVIDIA })
    assert.deepEqual(result.candidate.allowlist, { accountId: ACCOUNT, count: 1 })
    assert.equal(result.candidate.flags.ENABLE_BETA, false)
    assert.equal(result.candidate.flags.ENABLE_EMBEDDINGS, true)
    assert.equal(result.candidate.flags.ENABLE_GEMINI, true)
    assert.equal(result.candidate.flags.ENABLE_NVIDIA, false)
    assert.equal(releaseEvidence(f.manifest, f.reference, f.result, f.reviewReport, f.labReport, result.candidate, now, f.benchmarkCheckpoint).ok, true)

    const candidateConfigPath = path.resolve(root, result.candidate.paths.deploymentConfig)
    const configSnapshot = readFileSync(candidateConfigPath, 'utf8')
    const wrongConfig = configSnapshot.replace('ENABLE_GEMINI = "true"', 'ENABLE_GEMINI = "false"')
    assert.notEqual(wrongConfig, configSnapshot)
    writeFileSync(candidateConfigPath, wrongConfig)
    const forgedCandidate = structuredClone(result.candidate)
    forgedCandidate.flags.ENABLE_GEMINI = false
    forgedCandidate.hashes.deploymentConfig = sha256Hex(wrongConfig)
    delete forgedCandidate.fingerprint
    forgedCandidate.fingerprint = sha256Hex(canonicalJson(forgedCandidate))
    try {
      const rejectedConfig = releaseEvidence(f.manifest, f.reference, f.result, f.reviewReport, f.labReport, forgedCandidate, now, f.benchmarkCheckpoint)
      assert.equal(rejectedConfig.ok, false)
      assert.ok(rejectedConfig.errors.includes('la configuración de producción no conserva las flags base esperadas: beta cerrada, Gemini y embeddings habilitados'))
    } finally {
      writeFileSync(candidateConfigPath, configSnapshot)
    }

    const sourceProbe = path.join(root, 'src', `.release-snapshot-probe-${process.pid}.ts`)
    writeFileSync(sourceProbe, 'export const changedAfterCandidate = true\n', { flag: 'wx' })
    try {
      const staleSource = releaseEvidence(f.manifest, f.reference, f.result, f.reviewReport, f.labReport, result.candidate, now, f.benchmarkCheckpoint)
      assert.equal(staleSource.ok, false)
      assert.ok(staleSource.errors.includes('el árbol Git actual cambió desde que se fijó el expediente candidato; vuelve a crearlo'))
    } finally {
      unlinkSync(sourceProbe)
    }
    assert.equal(releaseEvidence(f.manifest, f.reference, f.result, f.reviewReport, f.labReport, result.candidate, now, f.benchmarkCheckpoint).ok, true)

    const agentFixture = fixture({ reviewerType: 'agent', artifactTime: now - 51 * 60 * 60_000 })
    write('reference.json', agentFixture.reference)
    write('results.json', agentFixture.result)
    write('results.json.checkpoint.json', agentFixture.benchmarkCheckpoint)
    write('review.json', agentFixture.reviewReport)
    write('reviews.json', agentFixture.reviews)
    write('lab.json', agentFixture.labReport)
    const candidateTime = now - 50 * 60 * 60_000
    const agentBenchmark = benchmarkEvidence(agentFixture.manifest, agentFixture.reference, agentFixture.result, agentFixture.reviewReport, agentFixture.benchmarkCheckpoint, agentFixture.reviews, [], candidateTime)
    assert.equal(agentBenchmark.ok, true, agentBenchmark.errors.join('; '))
    const agentCandidate = await createReleaseCandidate({
      manifestPath: path.join(directory, 'manifest.json'), referencePath: path.join(directory, 'reference.json'), resultPath: path.join(directory, 'results.json'),
      reviewPath: path.join(directory, 'review.json'), reviewsPath: path.join(directory, 'reviews.json'), labPath: path.join(directory, 'lab.json'),
      configPath, outputPath: path.join(directory, 'release-candidate-agent.json'), now: candidateTime,
    })
    assert.equal(agentCandidate.candidate.status, 'candidate')
    assert.equal(releaseEvidence(agentFixture.manifest, agentFixture.reference, agentFixture.result, agentFixture.reviewReport, agentFixture.labReport, agentCandidate.candidate, now, agentFixture.benchmarkCheckpoint).ok, true)
    const trialStart = now - 48 * 60 * 60_000
    const agentSmokeReport = smokeFixture(agentCandidate.candidate, new Date(now - 49 * 60 * 60_000).toISOString())
    const agentSmoke = smokeEvidence(agentFixture.manifest, agentSmokeReport, agentCandidate.candidate, trialStart)
    assert.equal(agentSmoke.ok, true, agentSmoke.errors.join('; '))
    const humanApproval = { schema: 'coach-release-approval-v1', status: 'approved', releaseMode: 'private-evaluation', humanApproved: true, smokeManualApproved: true, approvedAt: new Date(trialStart).toISOString(), trialStartsAt: new Date(trialStart).toISOString(), trialExpiresAt: new Date(trialStart + 24 * 60 * 60_000).toISOString(), trialAccountId: ACCOUNT, trialMaxDurationHours: 24, reviewer: 'responsable-humano', evidence: 'Revisión final del release privado.', corpusVersion: CORPUS, candidateFingerprint: agentCandidate.candidate.fingerprint, smokeFingerprint: agentSmoke.fingerprint }
    assert.equal(humanReleaseApprovalEvidence(agentFixture.manifest, agentSmoke, agentSmokeReport, agentCandidate.candidate, humanApproval, now).ok, true)
    assert.equal(humanReleaseApprovalEvidence(agentFixture.manifest, agentSmoke, agentSmokeReport, agentCandidate.candidate, { ...humanApproval, humanApproved: false }, now).ok, false)
    const trialDeployment = privateTrialDeployment(agentCandidate.candidate, agentSmoke, humanApproval)
    const trialGate = activationEvidence(agentFixture.manifest, agentSmoke, agentSmokeReport, agentCandidate.candidate, humanApproval, trialDeployment, now)
    assert.equal(trialGate.ok, true, trialGate.errors.join('; '))
    assert.equal(trialGate.mode, 'private-evaluation')
    assert.equal(trialGate.trial.productionUseAuthorized, false)
    assert.equal(trialGate.nvidiaProductionEntitlement.required, false)
    const unclosedTrial = structuredClone(trialDeployment)
    unclosedTrial.evaluationTrial.closure.readinessRejected = false
    assert.equal(activationEvidence(agentFixture.manifest, agentSmoke, agentSmokeReport, agentCandidate.candidate, humanApproval, unclosedTrial, now).ok, false)
    const extendedTrial = structuredClone(trialDeployment)
    extendedTrial.evaluationTrial.expiresAt = new Date(Date.parse(extendedTrial.evaluationTrial.startedAt) + 24 * 60 * 60_000 + 1).toISOString()
    assert.equal(activationEvidence(agentFixture.manifest, agentSmoke, agentSmokeReport, agentCandidate.candidate, humanApproval, extendedTrial, now).ok, false)
    const wrongAccount = structuredClone(trialDeployment)
    wrongAccount.evaluationTrial.allowlistAccountId = 'user_other'
    assert.equal(activationEvidence(agentFixture.manifest, agentSmoke, agentSmokeReport, agentCandidate.candidate, humanApproval, wrongAccount, now).ok, false)
    const mismatchedRelease = structuredClone(trialDeployment)
    mismatchedRelease.candidateFingerprint = 'other-candidate'
    assert.equal(activationEvidence(agentFixture.manifest, agentSmoke, agentSmokeReport, agentCandidate.candidate, humanApproval, mismatchedRelease, now).ok, false)
    const lateClosure = structuredClone(trialDeployment)
    const expiry = Date.parse(lateClosure.evaluationTrial.expiresAt)
    lateClosure.evaluationTrial.closedAt = new Date(expiry + 16 * 60_000).toISOString()
    lateClosure.evaluationTrial.closure.completedAt = lateClosure.evaluationTrial.closedAt
    assert.equal(activationEvidence(agentFixture.manifest, agentSmoke, agentSmokeReport, agentCandidate.candidate, humanApproval, lateClosure, now).ok, false)
    const shortMonitor = structuredClone(trialDeployment)
    shortMonitor.monitoring24h.endedAt = new Date(Date.parse(shortMonitor.monitoring24h.startedAt) + 24 * 60 * 60_000 - 1).toISOString()
    assert.equal(activationEvidence(agentFixture.manifest, agentSmoke, agentSmokeReport, agentCandidate.candidate, humanApproval, shortMonitor, now).ok, false)

    await assert.rejects(createReleaseCandidate({
      manifestPath: path.join(directory, 'manifest.json'), referencePath: path.join(directory, 'reference.json'), resultPath: path.join(directory, 'results.json'),
      benchmarkCheckpointPath: path.join(directory, 'missing-checkpoint.json'), reviewPath: path.join(directory, 'review.json'), reviewsPath: path.join(directory, 'reviews.json'), labPath: path.join(directory, 'lab.json'),
      configPath, outputPath: path.join(directory, 'blocked-missing-checkpoint.json'),
    }))
    const oldKimi = { ...f.result, execution: 'remote-flash', generationModel: 'moonshotai/kimi-k3' }
    write('results-kimi.json', oldKimi)
    write('results-kimi.json.checkpoint.json', f.benchmarkCheckpoint)
    await assert.rejects(createReleaseCandidate({
      manifestPath: path.join(directory, 'manifest.json'), referencePath: path.join(directory, 'reference.json'), resultPath: path.join(directory, 'results-kimi.json'),
      reviewPath: path.join(directory, 'review.json'), reviewsPath: path.join(directory, 'reviews.json'), labPath: path.join(directory, 'lab.json'),
      configPath, outputPath: path.join(directory, 'blocked-candidate.json'),
    }), /300 respuestas Gemini/)
  })

  it('bloquea autorización de canario con cuenta o flags distintos a producción', () => {
    const authorization = {
      accessVerified: true, budgetVerified: true, maxAdditionalCost: 0, reviewer: 'owner', evidence: 'verified free quota',
      canaryAccountId: ACCOUNT, expectedCorpusVersion: CORPUS, expectedConsentVersion: 'coach-context-v4-gemini-nvidia-embeddings',
      evaluationTrial: { scope: 'private-evaluation', maxDurationHours: 24 },
      maxRequests: 8, maxInputTokens: 1000, maxOutputTokens: 1000, estimatedInputTokens: 300, estimatedOutputTokens: 300,
      allocations: { smoke: { calls: 4, inputTokens: 500, outputTokens: 500 } }, verifiedAt: new Date(now - 1_000).toISOString(),
      nvidiaTesting: { accessVerified: true, budgetVerified: true, maxAdditionalCost: 0, evidence: 'NVIDIA test endpoint access and free quota verified.', verifiedAt: new Date(now - 1_000).toISOString() },
      temporaryFlags: { ENABLE_BETA: true, ENABLE_EMBEDDINGS: true, ENABLE_FLASH: false, ENABLE_GEMINI: true, ENABLE_NVIDIA: false, ENABLE_COACH_STREAMING: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false },
    }
    assert.equal(validateAuthorization(authorization, ACCOUNT, now).maxAdditionalCost, 0)
    assert.throws(() => validateAuthorization({ ...authorization, canaryAccountId: 'other' }, ACCOUNT, now), /cuenta única/)
    assert.throws(() => validateAuthorization({ ...authorization, temporaryFlags: { ...authorization.temporaryFlags, ENABLE_NVIDIA: true } }, ACCOUNT, now), /único generador/)
    assert.throws(() => validateAuthorization({ ...authorization, nvidiaTesting: { ...authorization.nvidiaTesting, accessVerified: false } }, ACCOUNT, now), /acceso de prueba NVIDIA/)
  })

  it('lee argumentos de canario desde la lista solicitada', () => {
    assert.equal(smokeOption('--base-url', ['--base-url', 'https://worker.example.test']), 'https://worker.example.test')
  })

  it('mantiene bloqueada la activación productiva si falta licencia NVIDIA NIM AI Enterprise', () => {
    const candidate = { fingerprint: 'candidate-fp', createdAt: new Date(now - 50 * 60 * 60_000).toISOString(), allowlist: { accountId: ACCOUNT, count: 1 } }
    const smokeReport = { completedAt: new Date(now - 48 * 60 * 60_000).toISOString(), canaryAccountId: ACCOUNT }
    const smoke = { ok: true, fingerprint: 'smoke-fp', accountId: ACCOUNT }
    const approval = { schema: 'coach-release-approval-v1', status: 'approved', releaseMode: 'production', humanApproved: true, smokeManualApproved: true, approvedAt: new Date(now - 46 * 60 * 60_000).toISOString(), reviewer: 'responsable-humano', evidence: 'Revisión final del release.', corpusVersion: CORPUS, candidateFingerprint: candidate.fingerprint, smokeFingerprint: smoke.fingerprint }
    const deployment = deploymentFixture(candidate, smoke, approval)
    delete deployment.nvidiaProductionEntitlement
    const result = activationEvidence({ corpusVersion: CORPUS }, smoke, smokeReport, candidate, approval, deployment, now)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => /AI Enterprise/.test(error)))
    assert.equal(result.nvidiaProductionEntitlement.ok, false)
  })
})
