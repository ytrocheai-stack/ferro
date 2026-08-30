import { describe, expect, it } from 'vitest'
import { handleRequest, normalizeEmbedding, validateModelDecision, IsolateCircuitBreaker, routeGeneration, ProviderError, type Env } from './index'
import { evaluateRecallAt5, SYNTHETIC_FIXTURES } from './evaluation'

const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1' }
const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 }
const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json' }

describe('adaptation worker', () => {
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

  it('returns deterministic candidates with auth and does not require D1', async () => {
    const input = { workoutId: 'w0', startedAt: 3, exerciseId: 'squat', role: 'strength', repRangeMin: 5, repRangeMax: 8, loadIncrementKg: 2.5, plannedSets: 3, sets: [{ type: 'normal', weightKg: 100, reps: 5, completed: true }], previousExposures: [] }
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, deps)
    expect(response.status).toBe(200)
    const body = await response.json() as { decisions: { candidates: { kind: string }[] }[] }
    expect(body.decisions[0].candidates[0].kind).toBe('maintain')
  })

  it('validates embedding dimensions and strict model decisions', () => {
    expect(() => normalizeEmbedding([1, 2])).toThrow(/2048/)
    expect(() => validateModelDecision({ exerciseId: 'x', candidateId: 'unknown', explanation: '', citationIds: [], warnings: [], confidence: 'low', requiresEscalation: false }, new Set(), new Set())).toThrow(/Candidato/)
    expect(() => validateModelDecision({ exerciseId: 'x', candidateId: null, explanation: '', citationIds: [], warnings: [], confidence: 'low', requiresEscalation: false, extra: 1 }, new Set(), new Set())).toThrow()
  })

  it('uses the isolate circuit breaker and never escalates a Flash 429', async () => {
    const breaker = new IsolateCircuitBreaker(60_000, 3, () => 100)
    breaker.failure(); breaker.failure(); breaker.failure()
    expect(() => breaker.beforeRequest()).toThrow(/abierto/)
    const result = await routeGeneration({ prompt: '{}', deterministic: '{"candidateId":null}' }, { generate: async () => { throw new ProviderError('rate limit', 429) } }, { flash: 'flash', pro: 'pro' }, { flash: true, pro: true })
    expect(result.model).toBe('deterministic')
  })

  it('keeps a reproducible synthetic evaluation for both dimensions', () => {
    expect(evaluateRecallAt5(SYNTHETIC_FIXTURES, 768)).toBe(1)
    expect(evaluateRecallAt5(SYNTHETIC_FIXTURES, 1024)).toBe(1)
  })
})
