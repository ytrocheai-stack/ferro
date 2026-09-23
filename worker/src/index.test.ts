import { describe, expect, it } from 'vitest'
import { corpusMetadataKey, vectorPhysicalId } from '../../packages/corpus-identity/src/index.mjs'
import { accountGenerationAttempts, budgetUsageWithinLimit, coachReadinessConfiguration, COACH_CONSENT_VERSION, handleRequest, mergeModelDecisions, normalizeEmbedding, normalizeGenerationUsage, reserveIdempotency, validateModelDecision, validateModelDecisionList, IsolateCircuitBreaker, routeGeneration, ProviderError, shouldStreamGeneration, withDeadline, VectorizeRetriever, type Env } from './index'
import { evaluateCitationPrecision, evaluateRecallAt5, passesDimensionGate, SYNTHETIC_FIXTURES } from './evaluation'

const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1' }
const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 }
const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json' }

describe('adaptation worker', () => {
  it('valida Gemini como único generador y NVIDIA solo para embeddings RAG', () => {
    const production: Env = {
      CLERK_JWT_KEY: 'fake-clerk', ENVIRONMENT: 'production', COACH_PROVIDER_ORDER: 'gemini',
      GEMINI_MODEL: 'gemini-3.5-flash-lite', NVIDIA_MODEL: 'z-ai/glm-5.3-flash', FLASH_MODEL: 'z-ai/glm-5.3-flash',
      NVIDIA_REQUESTS_PER_MINUTE: '40', GEMINI_REQUESTS_PER_MINUTE: '15', GEMINI_INPUT_TOKENS_PER_MINUTE: '250000', GEMINI_REQUESTS_PER_DAY: '500',
      EMBEDDING_MODEL: 'nvidia/nemotron-3-embed-1b',
      ENABLE_BETA: 'false', ENABLE_EMBEDDINGS: 'true', ENABLE_FLASH: 'false', ENABLE_GEMINI: 'true', ENABLE_NVIDIA: 'false',
      ENABLE_COACH_STREAMING: 'false', ENABLE_PRO: 'false', ENABLE_RERANKING: 'false', ENABLE_PROVIDER_PROBE: 'false',
      REQUIRED_CONSENT_VERSION: COACH_CONSENT_VERSION,
      ALLOWED_CLERK_IDS: 'user_only',
      GEMINI_API_KEY: 'fake-gemini', NVIDIA_API_KEY: 'fake-nvidia',
    }
    expect(coachReadinessConfiguration(production)).toMatchObject({ complete: true, providerOrder: ['gemini'], flags: { beta: false, embeddings: true, flash: false, gemini: true, nvidia: false, coachStreaming: false, pro: false, reranking: false, providerProbe: false }, allowlist: { count: 1, userIds: ['user_only'] }, credentialsConfigured: { gemini: true, nvidia: true } })
    expect(coachReadinessConfiguration({ ...production, ALLOWED_CLERK_IDS: 'user_one,user_two' }).complete).toBe(false)
    for (const invalid of [
      { COACH_PROVIDER_ORDER: 'gemini,nvidia' },
      { ENABLE_NVIDIA: 'true' },
      { ENABLE_FLASH: 'true' },
      { ENABLE_BETA: 'true' },
      { ENABLE_COACH_STREAMING: 'true' },
      { ENABLE_PRO: 'true' },
      { ENABLE_RERANKING: 'true' },
      { ENABLE_PROVIDER_PROBE: 'true' },
      { EMBEDDING_MODEL: 'other/embed-model' },
    ]) expect(coachReadinessConfiguration({ ...production, ...invalid }).complete).toBe(false)
    expect(coachReadinessConfiguration({ ...production, NVIDIA_API_KEY: undefined }).complete).toBe(false)
  })

  it('autoriza una sola cuenta en la allowlist privada', async () => {
    const allowedId = 'user_only'
    const production: Env = {
      CLERK_JWT_KEY: 'fake-clerk', ENVIRONMENT: 'production', COACH_PROVIDER_ORDER: 'gemini', ALLOWED_CLERK_IDS: allowedId,
      GEMINI_MODEL: 'gemini-3.5-flash-lite', NVIDIA_REQUESTS_PER_MINUTE: '40', GEMINI_REQUESTS_PER_MINUTE: '15',
      GEMINI_INPUT_TOKENS_PER_MINUTE: '250000', GEMINI_REQUESTS_PER_DAY: '500', REQUIRED_CONSENT_VERSION: COACH_CONSENT_VERSION,
      ENABLE_BETA: 'false', ENABLE_EMBEDDINGS: 'true', ENABLE_FLASH: 'false', ENABLE_GEMINI: 'true', ENABLE_NVIDIA: 'false',
      ENABLE_COACH_STREAMING: 'false', ENABLE_PRO: 'false', ENABLE_RERANKING: 'false', ENABLE_PROVIDER_PROBE: 'false',
      GEMINI_API_KEY: 'fake-gemini', NVIDIA_API_KEY: 'fake-nvidia',
    }
    const allowed = await handleRequest(new Request('https://worker.test/readiness', { headers }), production, { ...deps, verify: async () => ({ sub: allowedId }) })
    expect(allowed.status).toBe(503) // autenticado; las dependencias reales de readiness faltan en este fixture.
    expect(await allowed.json()).toMatchObject({ configuration: { complete: true, allowlist: { count: 1, userIds: [allowedId] } } })
    const denied = await handleRequest(new Request('https://worker.test/readiness', { headers }), production, { ...deps, verify: async () => ({ sub: 'user_second' }) })
    expect(denied.status).toBe(403)
  })

  it('acepta beta privada en readiness y productionConfigError cuando ya existe Workflow', async () => {
    const workflow = { create: async () => ({ id: 'run' }), get: () => ({ terminate: async () => undefined }) }
    const production: Env = {
      CLERK_JWT_KEY: 'fake-clerk', PSEUDONYMIZATION_KEY: 'fake-pseudonym', CLERK_AUTHORIZED_PARTIES: 'https://ytrocheai-stack.github.io',
      ENVIRONMENT: 'production', DB: {} as never, COACH_WORKFLOW: workflow,
      COACH_PROVIDER_ORDER: 'gemini', ALLOWED_CLERK_IDS: 'user_only',
      RAG_EXPECTED_SOURCE_COUNT: '88', RAG_EXPECTED_CHUNK_COUNT: '2708',
      GEMINI_MODEL: 'gemini-3.5-flash-lite', NVIDIA_REQUESTS_PER_MINUTE: '40', GEMINI_REQUESTS_PER_MINUTE: '15',
      GEMINI_INPUT_TOKENS_PER_MINUTE: '250000', GEMINI_REQUESTS_PER_DAY: '500', REQUIRED_CONSENT_VERSION: COACH_CONSENT_VERSION,
      ENABLE_BETA: 'true', ENABLE_EMBEDDINGS: 'true', ENABLE_FLASH: 'false', ENABLE_GEMINI: 'true', ENABLE_NVIDIA: 'false',
      ENABLE_COACH_STREAMING: 'false', ENABLE_PRO: 'false', ENABLE_RERANKING: 'false', ENABLE_PROVIDER_PROBE: 'false',
      GEMINI_API_KEY: 'fake-gemini', NVIDIA_API_KEY: 'fake-nvidia',
    }
    expect(coachReadinessConfiguration(production)).toMatchObject({ complete: true, flags: { beta: true } })
    expect(coachReadinessConfiguration({ ...production, COACH_WORKFLOW: undefined }).complete).toBe(false)
    const response = await handleRequest(new Request('https://worker.test/v1/providers/probe', {
      method: 'POST',
      headers: { ...headers, 'X-NextRep-Consent-Version': COACH_CONSENT_VERSION, 'X-NextRep-Device-Id': 'device-1' },
    }), production, { ...deps, verify: async () => ({ sub: 'user_only' }) })
    // 404 es la respuesta del probe apagado; 503 indicaría que productionConfigError rechazó beta=true.
    expect(response.status).toBe(404)
  })

  it('mantiene apagado el streaming del coach si la bandera no está explícita', () => {
    const provider = { generateStream: async () => ({ content: '{}' }) }
    expect(shouldStreamGeneration({}, 'moonshotai/kimi-k3', provider)).toBe(false)
    expect(shouldStreamGeneration({ ENABLE_COACH_STREAMING: 'false' }, 'moonshotai/kimi-k3', provider)).toBe(false)
    expect(shouldStreamGeneration({ ENABLE_COACH_STREAMING: 'true' }, 'moonshotai/kimi-k3', provider)).toBe(true)
  })
  it('aplica al índice remoto los mismos filtros de evidencia y población', async () => {
    let receivedFilter: unknown
    const retriever = new VectorizeRetriever({ query: async (_vector, options) => { receivedFilter = options?.filter; return { matches: [
      { id: vectorPhysicalId('v1', 'excluded'), score: 0.99, metadata: { chunkId: 'excluded', sourceId: 'source-1', corpusKey: corpusMetadataKey('v1'), corpusVersion: 'v1', retrievalClass: 'evidence', populationReviewed: 'false' } },
      { id: vectorPhysicalId('v1', 'allowed'), score: 0.8, metadata: { chunkId: 'allowed', sourceId: 'source-1', corpusKey: corpusMetadataKey('v1'), corpusVersion: 'v1', retrievalClass: 'evidence', populationReviewed: 'true' } },
      { id: vectorPhysicalId('v1', 'admin'), score: 1, metadata: { chunkId: 'admin', sourceId: 'source-1', corpusKey: corpusMetadataKey('v1'), corpusVersion: 'v1', retrievalClass: 'administrative', populationReviewed: 'true' } },
    ] } } }, 'v1')
    expect(await retriever.retrieve([1], 20)).toEqual([{ id: vectorPhysicalId('v1', 'allowed'), score: 0.8, metadata: { chunkId: 'allowed', sourceId: 'source-1', corpusKey: corpusMetadataKey('v1'), corpusVersion: 'v1', retrievalClass: 'evidence', populationReviewed: 'true' } }])
    expect(receivedFilter).toEqual({ corpusKey: corpusMetadataKey('v1'), retrievalClass: 'evidence', populationReviewed: 'true' })
    expect(await retriever.retrieve([1], 20, { mode: 'research' })).toHaveLength(2)
  })

  it('keeps health cheap and unauthenticated', async () => {
    const response = await handleRequest(new Request('https://worker.test/health'), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, policyVersion: 'v1' })
  })

  it('enforces exact origin, JWT and allowlist before analysis', async () => {
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' }), env, deps)
    expect(response.status).toBe(403)
    const missing = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers: { Origin: headers.Origin }, body: '{}' }), env, deps)
    expect(missing.status).toBe(401)
  })

  it('rejects unauthorized preflight and fails closed in production', async () => {
    const preflight = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } }), env)
    expect(preflight.status).toBe(403)
    const production = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers }), { ...env, ENVIRONMENT: 'production', PSEUDONYMIZATION_KEY: 'pseudo' }, deps)
    expect(production.status).toBe(503)
  })

  it('permite en CORS las cabeceras de consentimiento y dispositivo de la PWA', async () => {
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization,idempotency-key,x-nextrep-consent-version,x-nextrep-device-id' } }), env)
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('x-nextrep-consent-version')
    expect(response.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('x-nextrep-device-id')
  })

  it('returns deterministic candidates with auth and does not require D1', async () => {
    const input = { workoutId: 'w0', startedAt: 3, exerciseId: 'squat', role: 'strength', repRangeMin: 5, repRangeMax: 8, loadIncrementKg: 2.5, plannedSets: 3, sets: [{ type: 'normal', weightKg: 100, reps: 5, completed: true }], previousExposures: [] }
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, deps)
    expect(response.status).toBe(200)
    const body = await response.json() as { decisions: { candidates: { kind: string }[] }[] }
    expect(body.decisions[0].candidates[0].kind).toBe('maintain')
  })

  it('mantiene adaptations/analyze determinista aunque haya providers configurados', async () => {
    const previous = [1, 2, 3].map((startedAt) => ({ workoutId: `previous-${startedAt}`, startedAt, exerciseId: 'squat', occurrenceId: 'routine:0:squat', role: 'strength' as const, repRangeMin: 5, repRangeMax: 8, loadIncrementKg: 2.5, plannedSets: 3, sets: [{ type: 'normal' as const, weightKg: 100, reps: 6, completed: true }, { type: 'normal' as const, weightKg: 100, reps: 6, completed: true }, { type: 'normal' as const, weightKg: 100, reps: 6, completed: true }] }))
    const input = { workoutId: 'current', startedAt: 4, exerciseId: 'squat', occurrenceId: 'routine:0:squat', role: 'strength' as const, repRangeMin: 5, repRangeMax: 8, loadIncrementKg: 2.5, plannedSets: 3, sets: previous[0].sets, previousExposures: previous }
    let calls = 0
    const generation = { generate: async () => { calls += 1; throw new Error('adaptations/analyze no debe generar') } }
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), { ...env, NVIDIA_API_KEY: 'configured', ENABLE_FLASH: 'true', ENABLE_PRO: 'true' }, { ...deps, generation })
    expect(response.status).toBe(200)
    expect(calls).toBe(0)
    expect(await response.json()).toMatchObject({ provider: 'deterministic', pendingExplanation: true })
  })

  it('validates embedding dimensions and strict model decisions', () => {
    expect(() => normalizeEmbedding([1, 2])).toThrow(/2048/)
    expect(normalizeEmbedding(new Array(2048).fill(1)).length).toBe(512)
    expect(() => validateModelDecision({ exerciseId: 'x', candidateId: 'unknown', explanation: '', citationIds: [], warnings: [], confidence: 'low', requiresEscalation: false }, new Set(), new Set())).toThrow(/Candidato/)
    expect(() => validateModelDecision({ exerciseId: 'x', candidateId: null, explanation: '', citationIds: [], warnings: [], confidence: 'low', requiresEscalation: false, extra: 1 }, new Set(), new Set())).toThrow()
    expect(() => validateModelDecisionList([], new Set(), new Set(), [{ exerciseId: 'x', candidateIds: new Set(['candidate']) }])).toThrow(/cubre exactamente/)
  })

  it('uses the isolate circuit breaker and never escalates a Flash 429', async () => {
    const breaker = new IsolateCircuitBreaker(60_000, 3, () => 100)
    breaker.failure(); breaker.failure(); breaker.failure()
    expect(() => breaker.beforeRequest()).toThrow(/abierto/)
    const result = await routeGeneration({ prompt: '{}', deterministic: '{"candidateId":null}' }, { generate: async () => { throw new ProviderError('rate limit', 429) } }, { flash: 'flash', pro: 'pro' }, { flash: true, pro: true })
    expect(result.model).toBe('deterministic')
    expect(result.attempts).toMatchObject([{ model: 'flash', sent: true, error: { status: 429 } }])
  })

  it('conserva cero explícito y no marca como enviado un circuito abierto', async () => {
    const measured = await routeGeneration({ prompt: '{}', deterministic: 'fallback' }, { generate: async () => ({ content: 'valid', usage: { inputTokens: 0, outputTokens: 0 } }) }, { flash: 'flash', pro: 'pro' }, { flash: true, pro: false })
    expect(measured.attempts).toMatchObject([{ model: 'flash', sent: true, usage: { inputTokens: 0, outputTokens: 0 }, content: 'valid' }])
    const blocked = await routeGeneration({ prompt: '{}', deterministic: 'fallback' }, { generate: async () => { throw new ProviderError('open', undefined, 'circuit-open') } }, { flash: 'flash', pro: 'pro' }, { flash: true, pro: false })
    expect(blocked.attempts).toMatchObject([{ model: 'flash', sent: false, error: { code: 'circuit-open' } }])
  })

  it('keeps a reproducible synthetic evaluation for both dimensions', () => {
    expect(evaluateRecallAt5(SYNTHETIC_FIXTURES, 768)).toBe(1)
    expect(evaluateRecallAt5(SYNTHETIC_FIXTURES, 1024)).toBe(1)
  })

  it('requires the beta flag and matching consent when explicitly enabled', async () => {
    const betaEnv = { ...env, ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-beta-v1' }
    const input = { workoutId: 'w0', startedAt: 3, exerciseId: 'squat', role: 'strength', repRangeMin: 5, repRangeMax: 8, loadIncrementKg: 2.5, plannedSets: 3, sets: [{ type: 'normal', weightKg: 100, reps: 5, completed: true }], previousExposures: [] }
    const missing = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), betaEnv, deps)
    expect(missing.status).toBe(403)
    const authorized = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers: { ...headers, 'X-NextRep-Consent-Version': 'coach-beta-v1', 'X-NextRep-Device-Id': 'device-1' }, body: JSON.stringify({ inputs: [input], consentVersion: 'coach-beta-v1', deviceId: 'device-1' }) }), betaEnv, deps)
    expect(authorized.status).toBe(200)
  })

  it('aplica consentimiento y dispositivo también a eventos y provider probe durante la beta', async () => {
    const betaEnv = { ...env, ENABLE_BETA: 'true', ENABLE_PROVIDER_PROBE: 'true', REQUIRED_CONSENT_VERSION: 'coach-beta-v1' }
    const event = new Request('https://worker.test/v1/adaptations/events', { method: 'POST', headers, body: JSON.stringify({ analysisId: 'a', exerciseId: 'squat', candidateId: null, event: 'accepted' }) })
    expect((await handleRequest(event, betaEnv, deps)).status).toBe(403)
    const guardedHeaders = { ...headers, 'X-NextRep-Consent-Version': 'coach-beta-v1', 'X-NextRep-Device-Id': 'device-1' }
    const guardedEvent = new Request('https://worker.test/v1/adaptations/events', { method: 'POST', headers: guardedHeaders, body: JSON.stringify({ analysisId: 'a', exerciseId: 'squat', candidateId: null, event: 'accepted' }) })
    expect((await handleRequest(guardedEvent, betaEnv, deps)).status).toBe(200)
    const probe = await handleRequest(new Request('https://worker.test/v1/providers/probe', { method: 'POST', headers: guardedHeaders }), betaEnv, deps)
    expect(probe.status).toBe(200)
  })

  it('exposes authenticated readiness without calling a provider', async () => {
    const response = await handleRequest(new Request('https://worker.test/readiness', { headers }), env, deps)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, checks: { d1: false, index: false, corpus: false } })
  })

  it('does not expose readiness configuration without authentication', async () => {
    const response = await handleRequest(new Request('https://worker.test/readiness', { headers: { Origin: headers.Origin } }), env, deps)
    expect(response.status).toBe(401)
  })

  it('marca D1 y Vectorize no disponibles cuando las consultas reales fallan', async () => {
    const broken = { prepare: () => ({ first: async () => { throw new Error('D1 unavailable') } }) }
    const response = await handleRequest(new Request('https://worker.test/readiness', { headers }), { ...env, DB: broken as never, VECTORIZE: { query: async () => { throw new Error('index unavailable') } } }, deps)
    expect(await response.json()).toMatchObject({ checks: { d1: false, index: false, corpus: false } })
  })

  it('no declara listo un índice que responde sin ningún fragmento', async () => {
    let probeVector: number[] = []
    let probeMetadata: string | undefined
    const readyDb = {
      prepare(sql: string) {
        return {
          bind() { return this },
          async first() { return sql.includes('SELECT 1') ? { ok: 1 } : { count: 1 } },
        }
      },
      async batch() { return [] },
    }
    const response = await handleRequest(new Request('https://worker.test/readiness', { headers }), { ...env, DB: readyDb as never, VECTORIZE: { query: async (vector, options) => { probeVector = vector; probeMetadata = options?.returnMetadata; return { matches: [] } } }, RAG_INDEX_VERSION: 'v1' }, deps)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ checks: { d1: true, corpus: true, index: false } })
    expect(probeVector).toHaveLength(512)
    expect(probeVector[0]).toBe(1)
    expect(probeMetadata).toBe('none')
  })

  it('readiness exige los conteos exactos del corpus cuando producción los configura', async () => {
    const readyDb = {
      prepare(sql: string) {
        return {
          bind() { return this },
          async first() { return sql.includes('SELECT 1') ? { ok: 1 } : { count: 2708, source_count: 88, unapproved: 0 } },
        }
      },
      async batch() { return [] },
    }
    const response = await handleRequest(new Request('https://worker.test/readiness', { headers }), { ...env, DB: readyDb as never, VECTORIZE: { query: async () => ({ matches: [{ id: 'candidate' }] }) }, RAG_INDEX_VERSION: 'v1', RAG_EXPECTED_SOURCE_COUNT: '88', RAG_EXPECTED_CHUNK_COUNT: '2708' }, deps)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, checks: { d1: true, index: true, corpus: true } })
  })

  it('readiness expone y falla el error de configuración de producción aunque D1, corpus e índice respondan', async () => {
    const readyDb = {
      prepare(sql: string) {
        return {
          bind() { return this },
          async first() { return sql.includes('SELECT 1') ? { ok: 1 } : { count: 2708, source_count: 88, unapproved: 0 } },
        }
      },
      async batch() { return [] },
    }
    const production: Env = {
      CLERK_JWT_KEY: 'fake-clerk', CLERK_AUTHORIZED_PARTIES: 'https://ytrocheai-stack.github.io',
      ENVIRONMENT: 'production', DB: readyDb as never,
      COACH_PROVIDER_ORDER: 'gemini', ALLOWED_CLERK_IDS: 'user_1', RAG_INDEX_VERSION: 'v1',
      RAG_EXPECTED_SOURCE_COUNT: '88', RAG_EXPECTED_CHUNK_COUNT: '2708',
      NVIDIA_REQUESTS_PER_MINUTE: '40', GEMINI_REQUESTS_PER_MINUTE: '15', GEMINI_INPUT_TOKENS_PER_MINUTE: '250000', GEMINI_REQUESTS_PER_DAY: '500',
      ENABLE_BETA: 'false', ENABLE_EMBEDDINGS: 'true', ENABLE_FLASH: 'false', ENABLE_GEMINI: 'true', ENABLE_NVIDIA: 'false',
      ENABLE_COACH_STREAMING: 'false', ENABLE_PRO: 'false', ENABLE_RERANKING: 'false', ENABLE_PROVIDER_PROBE: 'false',
      REQUIRED_CONSENT_VERSION: COACH_CONSENT_VERSION, GEMINI_API_KEY: 'fake-gemini', NVIDIA_API_KEY: 'fake-nvidia',
    }
    const withIndex = { ...production, VECTORIZE: { query: async () => ({ matches: [{ id: 'candidate' }] }) } }
    const readyResponse = await handleRequest(new Request('https://worker.test/readiness', { headers }), withIndex, deps)
    expect(readyResponse.status).toBe(503)
    expect(await readyResponse.json()).toMatchObject({
      ok: false,
      checks: { config: true, d1: true, index: true, corpus: true, productionConfig: false },
      configurationError: 'PSEUDONYMIZATION_KEY no configurada',
    })
    const regularRequest = await handleRequest(new Request('https://worker.test/v1/providers/probe', { method: 'POST', headers }), withIndex, deps)
    expect(regularRequest.status).toBe(503)
    expect(await regularRequest.json()).toMatchObject({ error: 'PSEUDONYMIZATION_KEY no configurada' })
  })

  it('escalates a validated invalid Flash response only to Pro', async () => {
    const calls: string[] = []
    const result = await routeGeneration({ prompt: '{}', deterministic: 'fallback', escalationEnabled: true, validateFlash: () => ({ valid: false, requiresEscalation: false }) }, { generate: async (_prompt, model) => { calls.push(model); return model === 'flash' ? '{bad' : 'pro-json' } }, { flash: 'flash', pro: 'pro' }, { flash: true, pro: true })
    expect(result.model).toBe('pro')
    expect(calls).toEqual(['flash', 'pro'])
  })

  it('no acepta una salida vacía de Pro como análisis terminado', async () => {
    const previous = [1, 2, 3].map((startedAt) => ({ workoutId: `previous-${startedAt}`, startedAt, exerciseId: 'squat', occurrenceId: 'routine:0:squat', role: 'strength' as const, repRangeMin: 5, repRangeMax: 8, loadIncrementKg: 2.5, plannedSets: 3, sets: [{ type: 'normal' as const, weightKg: 100, reps: 6, completed: true }, { type: 'normal' as const, weightKg: 100, reps: 6, completed: true }, { type: 'normal' as const, weightKg: 100, reps: 6, completed: true }] }))
    const input = { workoutId: 'current', startedAt: 4, exerciseId: 'squat', occurrenceId: 'routine:0:squat', role: 'strength' as const, repRangeMin: 5, repRangeMax: 8, loadIncrementKg: 2.5, plannedSets: 3, sets: previous[0].sets, previousExposures: previous }
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), { ...env, NVIDIA_API_KEY: 'fake-only', ENABLE_FLASH: 'true', ENABLE_PRO: 'true' }, { ...deps, generation: { generate: async (_prompt, model) => model.includes('flash') ? 'invalid JSON' : '[]' } })
    expect(await response.json()).toMatchObject({ provider: 'deterministic', pendingExplanation: true })
  })

  it('conserva las decisiones maintain cuando el modelo solo explica las accionables', () => {
    const actionable = { exerciseId: 'squat', fallbackCandidateId: 'keep-squat', candidates: [{ candidateId: 'increase-squat', kind: 'increase-reps' as const, exerciseId: 'squat', previous: { plannedSets: 3, repsMin: 5, repsMax: 8 }, next: { plannedSets: 3, repsMin: 6, repsMax: 8 }, rule: 'v1:test' as const, evidence: { comparableWorkoutIds: [], comparableCount: 0, completedUpperBoundCount: 0, discreteIncreaseCount: 0 }, confidence: 'medium' as const, warnings: [], explanation: 'local' }], comparableWorkoutIds: [], warnings: [] }
    const maintain = { exerciseId: 'bench', fallbackCandidateId: 'keep-bench', candidates: [{ candidateId: 'keep-bench', kind: 'maintain' as const, exerciseId: 'bench', previous: { plannedSets: 3, repsMin: 5, repsMax: 8 }, next: { plannedSets: 3, repsMin: 5, repsMax: 8 }, rule: 'v1:test' as const, evidence: { comparableWorkoutIds: [], comparableCount: 0, completedUpperBoundCount: 0, discreteIncreaseCount: 0 }, confidence: 'low' as const, warnings: [], explanation: 'Mantén.' }], comparableWorkoutIds: [], warnings: [] }
    const merged = mergeModelDecisions([actionable, maintain], [{ exerciseId: 'squat', candidateId: 'increase-squat', explanation: 'Explicación respaldada', citationIds: ['chunk-1'], warnings: [], confidence: 'medium', requiresEscalation: false }], [{ id: 'chunk-1', source: 'Evidence', evidenceLevel: 3, text: 'support' }])
    expect(merged[0].candidates[0].explanation).toBe('Explicación respaldada')
    expect(merged[1]).toEqual(maintain)
  })

  it('no adquiere dos veces una clave de idempotencia expirada concurrente', async () => {
    const state: { record?: Record<string, unknown> } = {}
    const fakeDb = {
      prepare(sql: string) {
        let values: unknown[] = []
        return {
          bind(...bound: unknown[]) { values = bound; return this },
          async run() {
            if (sql.includes('INSERT INTO adaptation_idempotency')) {
              const [userHash, key, requestHash, analysisId, expiresAt, status, now] = values
              const current = state.record
              if (!current || Number(current.expires_at) <= Number(now)) {
                state.record = { user_hash: userHash, idem_key: key, request_hash: requestHash, analysis_id: analysisId, expires_at: expiresAt, status }
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 0 } }
            }
            return { meta: { changes: 0 } }
          },
          async first() { return state.record ?? null },
          async all() { return { results: [] } },
        }
      },
      async batch() { return [] },
    } as never
    const [first, second] = await Promise.all([
      reserveIdempotency(fakeDb, 'user', 'key', 'hash', 'analysis-a', 100),
      reserveIdempotency(fakeDb, 'user', 'key', 'hash', 'analysis-b', 100),
    ])
    expect([first?.owner, second?.owner].filter(Boolean)).toHaveLength(1)
  })

  it('rechaza el consumo real que supera el presupuesto anunciado', () => {
    expect(budgetUsageWithinLimit(2_000, 5_000, { inputTokens: 100_000, outputTokens: 5_000, concurrent: 2 })).toBe(true)
    expect(budgetUsageWithinLimit(2_000, 6_000, { inputTokens: 100_000, outputTokens: 5_000, concurrent: 2 })).toBe(false)
  })

  it('distingue cero medido de contadores ausentes o inválidos', () => {
    expect(normalizeGenerationUsage({ inputTokens: 0, outputTokens: 0, bad: 1 })).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(normalizeGenerationUsage({ inputTokens: -1, outputTokens: Number.NaN })).toEqual({})
    expect(accountGenerationAttempts([{ model: 'flash', sent: true, usage: { inputTokens: 0 } }], 123, 4_000)).toMatchObject({ inputTokens: 0, outputTokens: 4_000, inputMeasuredTokens: 0, outputEstimatedTokens: 4_000, usageIncomplete: true })
  })

  it('counts complete Recall@5 and never approves an uncited evaluation', () => {
    const fixtures = [{ query: [1, 0], relevantIds: ['a', 'b'], documents: [{ id: 'a', vector: [1, 0] }, { id: 'noise', vector: [0, 1] }, { id: 'b', vector: [0.9, 0.1] }] }]
    expect(evaluateRecallAt5(fixtures, 768)).toBe(1)
    expect(evaluateCitationPrecision([{ citedIds: [], validIds: ['a'] }])).toBe(0)
    expect(evaluateCitationPrecision([{ citedIds: ['a'], validIds: [], claims: [{ citedIds: ['a'], supportedIds: [] }] }])).toBe(0)
  })

  it('aplica el gate de 1024 contra la base 512', () => {
    expect(passesDimensionGate(SYNTHETIC_FIXTURES, 1, 1)).toBe(false)
  })

  it('cubre timeout de la lectura de respuesta y cancelación externa', async () => {
    await expect(withDeadline(async (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('body abortado')))), 10)).rejects.toMatchObject({ code: 'timeout' })
    const controller = new AbortController()
    const pending = withDeadline(async (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('body abortado')))), 1_000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })
})
