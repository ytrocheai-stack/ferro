import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBenchmark, BENCHMARK_FORMAL_REMOTE_RESPONSES, BENCHMARK_INVALID_RETRY_TARGET } from '../../../scripts/corpus-benchmark'
import { EMBEDDING_MODEL } from '../../corpus-pipeline/src/runtime.ts'
import { GEMINI_GENERATION_MODEL, GEMINI_PROJECT_LEDGER_DIRECTORY, GEMINI_PROJECT_NAME, GEMINI_PROJECT_QUOTA, type GeminiAuthorization, type GeminiGenerationOptions } from '../../corpus-pipeline/src/gemini-session.ts'

const temporaryDirectories: string[] = []
let originalGeminiApiKey: string | undefined
type FixtureQuery = { queryId: string; text: string; relevantChunkIds: string[]; hardNegativeChunkIds: string[] }
type ReferenceFixture = { corpusVersion?: string | null; version: string; status: string; queries: FixtureQuery[]; [key: string]: unknown }
type MockGeneration = {
  content: string
  usage: { inputTokens: number; outputTokens: number }
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; thoughtsTokenCount: number; totalTokenCount: number }
}
type BenchmarkRunResult = {
  status: string
  result: {
    execution: string
    generationModel: string
    formalRemoteResponsesRequired: number
    formalRemoteResponsesComplete: number | null
    authorization: { projectNumber: string; model: string; embeddingModel: string } | null
    provider: { calls: number; inputTokens: number; outputTokens: number; uncertainCalls: number } | null
    providerLedger: { allocation: string; calls: number; allocationCalls: number; measuredCalls: number; uncertainCalls: number } | null
    runs: Array<{ repetition: number; citations: Record<'512' | '1024', Array<{ queryId: string; repetition: number; prompt: string; retrievedContext: Array<{ id: string }>; requestIdentity: { fingerprint: string }; responseText: string; rawResponse?: string; parseError?: boolean; retryProvenance?: { schema: string; reason: string; priorAttempt: { rawResponse: string; requestIdentity: { fingerprint: string }; parseError: boolean } }; usageMetadata?: MockGeneration['usageMetadata'] }>> }>
  }
}
type SavedCitation = {
  queryId: string
  repetition: number
  responseText: string
  parseError: boolean
  claims: Array<unknown>
  requestIdentity: { fingerprint: string; model: string }
  usage: MockGeneration['usage']
  usageMetadata: MockGeneration['usageMetadata']
  rawResponse: string
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'benchmark-gemini-adapter-'))
  temporaryDirectories.push(root)
  const corpusVersion = 'synthetic-gemini-benchmark-v1'
  const reference = JSON.parse(readFileSync(path.resolve('worker/corpus/evaluation-queries.json'), 'utf8')) as ReferenceFixture
  reference.corpusVersion = corpusVersion
  reference.scientificReview = {
    approved: true,
    reviewer: 'synthetic benchmark reviewer',
    notes: 'Fixture used only for mocked adapter integration.',
    queryCount: 50,
    relevantReviewed: true,
    hardNegativesReviewed: true,
    claimsReviewed: true,
    populationApplicabilityReviewed: true,
    exclusionsCertified: true,
    reviewedAt: new Date().toISOString(),
  }
  const ids = [...new Set(reference.queries.flatMap((query) => [...query.relevantChunkIds, ...query.hardNegativeChunkIds]))]
  while (ids.length < 5) ids.push(`synthetic-extra-${ids.length}`)
  const manifest = {
    corpusVersion,
    status: 'approved',
    sources: [{ id: 'synthetic-source', author: 'Test', title: 'Synthetic evidence', url: 'https://example.test/evidence', license: 'test', approved: true }],
    chunks: ids.map((id) => ({ id, sourceId: 'synthetic-source', text: `Evidence passage ${id}`, location: 'Abstract', retrievalClass: 'evidence' })),
  }
  const vector = Array(2048).fill(0) as number[]
  vector[0] = 1
  const matrix = { corpusVersion, model: EMBEDDING_MODEL, dimensions: 2048, documents: ids.map((id) => ({ id, inputType: 'passage', vector2048: vector })) }
  const remoteResults = {
    schema: 'hevy-remote-verification-v2',
    corpusVersion,
    queriesComplete: true,
    identityMismatches: 0,
    excludedEvidence: 0,
    filtersMatchWorker: true,
    queryComparisons: reference.queries.map((query) => ({
      queryId: query.queryId,
      remote512: ids.slice(0, 5).map((id, index) => ({ id, score: 0.99 - index / 100 })),
      remote1024: ids.slice(0, 5).map((id, index) => ({ id, score: 0.99 - index / 100 })),
    })),
  }
  const authorization = {
    provider: 'google-ai-studio',
    projectName: GEMINI_PROJECT_NAME,
    projectNumber: '233255822266',
    accessVerified: true,
    budgetVerified: true,
    maxAdditionalCost: 0,
    verifiedAt: new Date().toISOString(),
    reviewer: 'synthetic benchmark reviewer',
    evidence: 'synthetic free-tier fixture',
    projectQuota: { ...GEMINI_PROJECT_QUOTA },
    model: GEMINI_GENERATION_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    requestsPerMinute: GEMINI_PROJECT_QUOTA.requestsPerMinute,
    tokensPerMinute: GEMINI_PROJECT_QUOTA.tokensPerMinute,
    requestsPerDay: GEMINI_PROJECT_QUOTA.requestsPerDay,
    maxInputTokens: 30_000,
    maxOutputTokens: 4_000,
    timeoutMs: 1_000,
    maxTotalCalls: 500,
    maxTotalInputTokens: 10_000_000,
    maxTotalOutputTokens: 2_000_000,
    allocations: {
      benchmark: { calls: 300, inputTokens: 8_000_000, outputTokens: 1_200_000 },
      lab: { calls: 100, inputTokens: 1_000_000, outputTokens: 400_000 },
      smoke: { calls: 100, inputTokens: 1_000_000, outputTokens: 400_000 },
    },
  } as GeminiAuthorization
  const queriesPath = path.join(root, 'queries-2048.jsonl')
  writeFileSync(queriesPath, reference.queries.map((query) => JSON.stringify({ queryId: query.queryId, inputType: 'query', vector2048: vector })).join('\n') + '\n')
  const manifestPath = path.join(root, 'manifest.json')
  const referencePath = path.join(root, 'reference.json')
  const matrixPath = path.join(root, 'matrix.json')
  const remoteResultsPath = path.join(root, 'remote-verification.json')
  const authorizationPath = path.join(root, 'authorization.json')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  writeFileSync(referencePath, JSON.stringify(reference))
  writeFileSync(matrixPath, JSON.stringify(matrix))
  writeFileSync(remoteResultsPath, JSON.stringify(remoteResults))
  writeFileSync(authorizationPath, JSON.stringify(authorization))
  return { root, manifestPath, referencePath, matrixPath, queriesPath, remoteResultsPath, authorizationPath }
}

function mockedGeminiFactory(callCounter: { value: number; responses: Map<string, MockGeneration>; last?: { prompt: string; generation: GeminiGenerationOptions }; history?: Array<{ prompt: string; generation: GeminiGenerationOptions }> }) {
  return (options: { directory: string; allocation: string; authorization: GeminiAuthorization }) => {
    expect(options.directory).toBe(GEMINI_PROJECT_LEDGER_DIRECTORY)
    expect(options.allocation).toBe('benchmark')
    expect(options.authorization.model).toBe(GEMINI_GENERATION_MODEL)
    return {
      async generate(prompt: string, generation: GeminiGenerationOptions) {
        expect(generation.maxOutputTokens).toBe(4_000)
        expect(generation.attemptKey).toMatch(/^[a-f0-9]{64}$/)
        expect(generation.systemPrompt).toContain('Responde sólo JSON')
        callCounter.last = { prompt, generation: structuredClone(generation) }
        callCounter.history?.push({ prompt, generation: structuredClone(generation) })
        const cached = callCounter.responses.get(generation.attemptKey)
        if (generation.requireCached && !cached) throw new Error('No existe respuesta cacheada medida para la huella solicitada')
        if (cached) return structuredClone(cached)
        callCounter.value += 1
        const generated = {
          content: '{"responseText":"respuesta sintética","claims":[]}',
          usage: { inputTokens: 23, outputTokens: 9 },
          usageMetadata: { promptTokenCount: 23, candidatesTokenCount: 7, thoughtsTokenCount: 2, totalTokenCount: 32 },
        }
        callCounter.responses.set(generation.attemptKey, generated)
        return generated
      },
      report: () => ({ allocation: 'benchmark' as const, calls: callCounter.value, allocationCalls: callCounter.value, inputTokens: callCounter.value * 23, outputTokens: callCounter.value * 9, measuredCalls: callCounter.value, uncertainCalls: 0, rejectedCalls: 0 }),
    }
  }
}

function runOptions(paths: ReturnType<typeof fixture>, outputPath: string, geminiSessionFactory: ReturnType<typeof mockedGeminiFactory>, probe = false) {
  return {
    ...paths,
    outputPath,
    execute: true,
    probe,
    repetitions: probe ? 1 : 3,
    geminiSessionFactory,
    loadEnvironment: () => {},
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  if (originalGeminiApiKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalGeminiApiKey
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

beforeEach(() => {
  originalGeminiApiKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'synthetic-test-key'
})

describe('benchmark Gemini adapter', () => {
  it('completa exactamente 300 respuestas y requiere que cada reanudación coincida con el ledger cacheado', async () => {
    const paths = fixture()
    const outputPath = path.join(paths.root, 'generated.json')
    const calls: { value: number; responses: Map<string, MockGeneration> } = { value: 0, responses: new Map() }
    const options = runOptions(paths, outputPath, mockedGeminiFactory(calls))
    const progressSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const first = await runBenchmark(options) as unknown as BenchmarkRunResult
    expect(first.status).toBe('responses-generated-awaiting-independent-review')
    expect(first.result.execution).toBe('remote-gemini-complete')
    expect(first.result.generationModel).toBe(GEMINI_GENERATION_MODEL)
    expect(first.result.authorization).toMatchObject({ projectNumber: '233255822266', model: GEMINI_GENERATION_MODEL, embeddingModel: EMBEDDING_MODEL })
    expect(first.result.formalRemoteResponsesRequired).toBe(BENCHMARK_FORMAL_REMOTE_RESPONSES)
    expect(first.result.formalRemoteResponsesComplete).toBe(BENCHMARK_FORMAL_REMOTE_RESPONSES)
    expect(first.result.provider).toEqual({ calls: BENCHMARK_FORMAL_REMOTE_RESPONSES, inputTokens: 23 * 300, outputTokens: 9 * 300, uncertainCalls: 0 })
    expect(first.result.providerLedger).toMatchObject({ allocation: 'benchmark', calls: 300, allocationCalls: 300, measuredCalls: 300, uncertainCalls: 0 })
    expect(first.result.runs).toHaveLength(3)
    expect(first.result.runs.flatMap((run) => [...run.citations[512], ...run.citations[1024]])).toHaveLength(BENCHMARK_FORMAL_REMOTE_RESPONSES)
    expect(first.result.runs[0].citations[512][0].usageMetadata).toEqual({ promptTokenCount: 23, candidatesTokenCount: 7, thoughtsTokenCount: 2, totalTokenCount: 32 })
    expect(calls.value).toBe(BENCHMARK_FORMAL_REMOTE_RESPONSES)

    const resumed = await runBenchmark(options) as unknown as BenchmarkRunResult
    expect(resumed.status).toBe('responses-generated-awaiting-independent-review')
    expect(calls.value).toBe(BENCHMARK_FORMAL_REMOTE_RESPONSES)

    const checkpointPath = `${outputPath}.checkpoint.json`
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as { completed: Record<string, SavedCitation> }
    const firstKey = Object.keys(checkpoint.completed).find((key) => key.startsWith('0:512:'))!
    const citation = checkpoint.completed[firstKey]
    citation.requestIdentity.model = 'moonshotai/kimi-k3'
    writeFileSync(checkpointPath, JSON.stringify(checkpoint))
    await expect(runBenchmark(options)).rejects.toThrow('checkpoint Gemini incompatible')
    expect(calls.value).toBe(BENCHMARK_FORMAL_REMOTE_RESPONSES)
    citation.requestIdentity.model = GEMINI_GENERATION_MODEL

    calls.responses.delete(citation.requestIdentity.fingerprint)
    writeFileSync(checkpointPath, JSON.stringify(checkpoint))
    await expect(runBenchmark(options)).rejects.toThrow('No existe respuesta cacheada')
    expect(calls.value).toBe(BENCHMARK_FORMAL_REMOTE_RESPONSES)
    calls.responses.set(citation.requestIdentity.fingerprint, structuredClone({
      content: citation.rawResponse,
      usage: citation.usage,
      usageMetadata: citation.usageMetadata,
    }))

    checkpoint.completed[firstKey].usageMetadata.totalTokenCount += 1
    checkpoint.completed[firstKey].usage.outputTokens += 1
    writeFileSync(checkpointPath, JSON.stringify(checkpoint))
    await expect(runBenchmark(options)).rejects.toThrow('checkpoint Gemini no coincide')
    expect(calls.value).toBe(BENCHMARK_FORMAL_REMOTE_RESPONSES)
    progressSpy.mockRestore()
  }, 30_000)

  it('reintenta sólo q46 repetición 2 dimensión 1024 y conserva la respuesta fallida como procedencia', async () => {
    const paths = fixture()
    const outputPath = path.join(paths.root, 'invalid-response-retry.json')
    const calls: { value: number; responses: Map<string, MockGeneration>; history: Array<{ prompt: string; generation: GeminiGenerationOptions }> } = { value: 0, responses: new Map(), history: [] }
    const options = runOptions(paths, outputPath, mockedGeminiFactory(calls))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const initial = await runBenchmark(options) as unknown as BenchmarkRunResult
    const initialHistoryCount = calls.history.length
    const originalFingerprints = new Map<string, string>()
    for (const run of initial.result.runs) for (const dimensions of [512, 1024] as const) for (const row of run.citations[dimensions]) {
      originalFingerprints.set(`${row.repetition}:${dimensions}:${row.queryId}`, row.requestIdentity.fingerprint)
    }
    const checkpointPath = `${outputPath}.checkpoint.json`
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as { completed: Record<string, SavedCitation> }
    const targetKey = '2:1024:q46'
    const target = checkpoint.completed[targetKey]
    const malformed = '{"responseText":"","claims":[]}'
    target.responseText = malformed
    target.rawResponse = malformed
    target.parseError = true
    target.claims = []
    const cached = calls.responses.get(target.requestIdentity.fingerprint)!
    calls.responses.set(target.requestIdentity.fingerprint, { ...cached, content: malformed })
    writeFileSync(checkpointPath, JSON.stringify(checkpoint))

    const retried = await runBenchmark({ ...options, retryInvalid: BENCHMARK_INVALID_RETRY_TARGET }) as unknown as BenchmarkRunResult
    expect(retried.status).toBe('responses-generated-awaiting-independent-review')
    expect(calls.value).toBe(BENCHMARK_FORMAL_REMOTE_RESPONSES + 1)
    const retryHistory = calls.history.slice(initialHistoryCount)
    expect(retryHistory.filter((call) => call.generation.requireCached)).toHaveLength(BENCHMARK_FORMAL_REMOTE_RESPONSES)
    const retryCalls = retryHistory.filter((call) => call.generation.attemptProvenance)
    expect(retryCalls).toHaveLength(1)
    expect(retryCalls[0].prompt).not.toBe(initial.result.runs[2].citations[1024].find((row) => row.queryId === 'q46')?.prompt)
    expect(retryCalls[0].generation.attemptKey).not.toBe(target.requestIdentity.fingerprint)
    expect(retryCalls[0].generation.attemptProvenance).toMatchObject({
      kind: 'benchmark-invalid-response-retry-v1',
      priorAttemptKey: target.requestIdentity.fingerprint,
      reason: 'empty-responseText',
    })
    expect(retryCalls[0].generation.attemptProvenance?.priorResponseSha256).toMatch(/^[a-f0-9]{64}$/)

    const retriedRows = new Map<string, string>()
    for (const run of retried.result.runs) for (const dimensions of [512, 1024] as const) for (const row of run.citations[dimensions]) {
      const key = `${row.repetition}:${dimensions}:${row.queryId}`
      retriedRows.set(key, row.requestIdentity.fingerprint)
      expect(row.parseError).toBe(false)
      expect(row.responseText.trim()).not.toBe('')
      if (key !== targetKey) expect(row.requestIdentity.fingerprint).toBe(originalFingerprints.get(key))
    }
    expect(retriedRows.size).toBe(BENCHMARK_FORMAL_REMOTE_RESPONSES)
    const retriedTarget = retried.result.runs[2].citations[1024].find((row) => row.queryId === 'q46')!
    expect(retriedTarget.requestIdentity.fingerprint).not.toBe(target.requestIdentity.fingerprint)
    expect(retriedTarget.retryProvenance).toMatchObject({
      schema: 'benchmark-invalid-response-retry-v1',
      reason: 'empty-responseText',
      priorAttempt: { rawResponse: malformed, parseError: true, requestIdentity: { fingerprint: target.requestIdentity.fingerprint } },
    })
  }, 30_000)

  it('permite un probe y nunca lo etiqueta como benchmark formal completo', async () => {
    const paths = fixture()
    const calls: { value: number; responses: Map<string, MockGeneration> } = { value: 0, responses: new Map() }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await runBenchmark(runOptions(paths, path.join(paths.root, 'probe.json'), mockedGeminiFactory(calls), true)) as unknown as BenchmarkRunResult
    expect(calls.value).toBe(1)
    expect(result.status).toBe('probe-responses-generated-incomplete')
    expect(result.result.execution).toBe('remote-gemini-probe-incomplete')
    expect(result.result.formalRemoteResponsesComplete).toBeNull()
    expect(result.result.provider?.calls).toBe(1)
  })

  it('selecciona q09 para un probe y limita citas a los IDs exactos del contexto', async () => {
    const paths = fixture()
    const calls: { value: number; responses: Map<string, MockGeneration>; last?: { prompt: string; generation: GeminiGenerationOptions } } = { value: 0, responses: new Map() }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const options = { ...runOptions(paths, path.join(paths.root, 'q09-probe.json'), mockedGeminiFactory(calls), true), probeQueryId: 'q09' }
    const result = await runBenchmark(options) as unknown as BenchmarkRunResult
    const response = result.result.runs[0].citations[512][0]
    expect(calls.value).toBe(1)
    expect(response.queryId).toBe('q09')
    expect(response.prompt).toContain('chunk_id=')
    expect(response.prompt).not.toMatch(/\[\d+\]\s+chunk=/)
    const generationSchema = calls.last?.generation.responseJsonSchema as {
      properties: { claims: { items: { properties: { citedIds: { items: { enum: string[] } } } } } }
    }
    expect(generationSchema.properties.claims.items.properties.citedIds.items.enum).toEqual(response.retrievedContext.map(entry => entry.id))
  })

  it('rechaza un query selector fuera de probe mode antes de generar', async () => {
    const paths = fixture()
    const calls: { value: number; responses: Map<string, MockGeneration> } = { value: 0, responses: new Map() }
    const options = { ...runOptions(paths, path.join(paths.root, 'invalid-probe.json'), mockedGeminiFactory(calls)), probeQueryId: 'q09' }
    await expect(runBenchmark(options)).rejects.toThrow('--probe-query sólo está permitido con --probe')
    expect(calls.value).toBe(0)
  })
})
