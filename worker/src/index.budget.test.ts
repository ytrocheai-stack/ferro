import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { handleRequest, NvidiaGenerationProvider, providerRequestGate, reserveProviderRequest, type D1Database, type Env } from './index'

function sqliteD1(): { sqlite: DatabaseSync; database: D1Database } {
  const sqlite = new DatabaseSync(':memory:')
  const migrations = existsSync('worker/migrations') ? 'worker/migrations' : 'migrations'
  for (const name of readdirSync(migrations).sort()) sqlite.exec(readFileSync(`${migrations}/${name}`, 'utf8'))
  const database = {
    prepare: (sql: string) => {
      let values: unknown[] = []
      const statement = {
        bind: (...args: unknown[]) => { values = args; return statement },
        first: async <T = Record<string, unknown>>() => sqlite.prepare(sql).get(...values as SQLInputValue[]) as T | undefined ?? null,
        all: async <T = Record<string, unknown>>() => ({ results: sqlite.prepare(sql).all(...values as SQLInputValue[]) as T[] }),
        run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values as SQLInputValue[]).changes) } }),
        execute: () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values as SQLInputValue[]).changes) } }),
      }
      return statement
    },
    batch: async (statements: { execute(): unknown }[]) => statements.map((statement) => statement.execute()),
  } as unknown as D1Database
  return { sqlite, database }
}

function analysisInput() {
  const previousExposures = [1, 2, 3].map((startedAt) => ({
    workoutId: `previous-${startedAt}`,
    startedAt,
    exerciseId: 'squat',
    occurrenceId: 'routine:0:squat',
    role: 'strength' as const,
    repRangeMin: 5,
    repRangeMax: 8,
    loadIncrementKg: 2.5,
    plannedSets: 3,
    sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 6, completed: true })),
  }))
  return { workoutId: 'current', startedAt: 4, exerciseId: 'squat', occurrenceId: 'routine:0:squat', role: 'strength' as const, repRangeMin: 5, repRangeMax: 8, loadIncrementKg: 2.5, plannedSets: 3, sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 6, completed: true })), previousExposures }
}

describe('presupuesto real del Worker', () => {
  it('la ruta efectiva providerRequestGate reserva tras migrar sin insert manual', async () => {
    const { sqlite, database } = sqliteD1()
    const gate = providerRequestGate({ DB: database, NVIDIA_REQUESTS_PER_MINUTE: '40' } as Env)
    await gate(new AbortController().signal)
    expect(sqlite.prepare("SELECT used_requests FROM provider_request_limits WHERE provider='nvidia'").get()).toEqual({ used_requests: 1 })
    sqlite.close()
  })

  it('conecta un 429 del fetch al defer durable de NVIDIA', async () => {
    const { sqlite, database } = sqliteD1()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls++
      return new Response('{}', { status: 429, headers: { 'Retry-After': '10' } })
    }
    try {
      const gate = providerRequestGate({ DB: database, NVIDIA_REQUESTS_PER_MINUTE: '40' } as Env)
      const provider = new NvidiaGenerationProvider('fixture', fetcher, undefined, gate)
      await expect(provider.generate('prompt', 'fixture-model')).rejects.toMatchObject({ status: 429, retryAfterMs: 10_000 })
      expect(calls).toBe(1)
      expect(await reserveProviderRequest(database, 19_999, 40)).toBe(false)
      expect(await reserveProviderRequest(database, 20_000, 40)).toBe(true)
    } finally {
      clock.mockRestore()
      sqlite.close()
    }
  })

  it('no conecta providers ni presupuestos de generación a adaptations/analyze', async () => {
    const { sqlite, database } = sqliteD1()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fixture', ENABLE_FLASH: 'true', NVIDIA_ACCOUNTING_MODE: 'requests', DB: database }
    let calls = 0
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async () => { calls++; return { content: '[]', usage: { inputTokens: 100, outputTokens: 10 } } } } }
    await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'request-mode-1' }, body: JSON.stringify({ inputs: [analysisInput()] }) }), env, deps)
    sqlite.exec('UPDATE adaptation_budgets SET input_tokens = 1000000, output_tokens = 1000000')
    await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'request-mode-2' }, body: JSON.stringify({ inputs: [{ ...analysisInput(), workoutId: 'next' }] }) }), env, deps)
    expect(calls).toBe(0)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM adaptation_budgets').get()).toEqual({ count: 0 })
    sqlite.close()
  })
  it('espacia solicitudes globales de NVIDIA atómicamente entre usuarios e instancias', async () => {
    const { sqlite, database } = sqliteD1()
    sqlite.exec("INSERT OR IGNORE INTO provider_request_limits(provider,next_allowed_at,used_requests,max_requests) VALUES ('nvidia',0,0,0)")
    sqlite.exec("UPDATE provider_request_limits SET next_allowed_at=0, used_requests=2722, max_requests=4500 WHERE provider='nvidia'")
    const now = 1_700_000_000_000
    const results = await Promise.all([reserveProviderRequest(database, now, 40), reserveProviderRequest(database, now, 40)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await reserveProviderRequest(database, now + 1499, 40)).toBe(false)
    expect(await reserveProviderRequest(database, now + 1500, 40)).toBe(true)
    sqlite.close()
  })
  it('usa la fila NVIDIA sembrada por la migración y no interpreta max_requests como autorización', async () => {
    const { sqlite, database } = sqliteD1()
    sqlite.exec("UPDATE provider_request_limits SET next_allowed_at=0, used_requests=4499, max_requests=4500 WHERE provider='nvidia'")
    expect(await reserveProviderRequest(database, 10000, 40)).toBe(true)
    const results = await Promise.all([reserveProviderRequest(database, 10000, 40), reserveProviderRequest(database, 10000, 40)])
    expect(results.filter(Boolean)).toHaveLength(0)
    expect(await reserveProviderRequest(database, 11500, 40)).toBe(true)
    expect(await reserveProviderRequest(database, 12999, 40)).toBe(false)
    expect(await reserveProviderRequest(database, 13000, 40)).toBe(true)
    expect(sqlite.prepare("SELECT used_requests, max_requests FROM provider_request_limits WHERE provider='nvidia'").get()).toEqual({ used_requests: 4502, max_requests: 4500 })
    sqlite.close()
  })
  it('rechaza replay antiguo si cambia el modelo de ejecución aunque el payload y la clave coincidan', async () => {
    const { sqlite, database } = sqliteD1()
    const input = analysisInput()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'replay-context-change' }
    const body = JSON.stringify({ inputs: [input] })
    const baseEnv: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', DB: database }
    const first = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body }), baseEnv, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 })
    const changed = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body }), { ...baseEnv, FLASH_MODEL: 'changed-model' }, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_001 })
    sqlite.close()
    expect(first.status).toBe(200)
    expect(changed.status).toBe(409)
  })

  it('devuelve sólo el resultado determinista y no reserva presupuesto de provider', async () => {
    const { sqlite, database } = sqliteD1()
    const input = analysisInput()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'budget-test' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fake-only', ENABLE_FLASH: 'true', MAX_WEEKLY_OUTPUT_TOKENS: '5000', DB: database }
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async () => ({ content: '[]', usage: { inputTokens: 100, outputTokens: 6_000 } }) } })
    const body = await response.json() as { provider: string; pendingExplanation: boolean }
    const budget = sqlite.prepare('SELECT output_tokens, reserved_output_tokens, active_runs FROM adaptation_budgets').get()
    sqlite.close()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ provider: 'deterministic', pendingExplanation: true })
    expect(budget).toBeUndefined()
  })

  it('no cobra usage de provider en adaptations/analyze determinista', async () => {
    const { sqlite, database } = sqliteD1()
    const input = analysisInput()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'budget-unknown-usage' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fake-only', ENABLE_FLASH: 'true', MAX_WEEKLY_OUTPUT_TOKENS: '5000', DB: database }
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async () => { throw new Error('timeout') } } })
    const body = await response.json() as { provider: string; pendingExplanation: boolean }
    const budget = sqlite.prepare('SELECT output_tokens, reserved_output_tokens, active_runs FROM adaptation_budgets').get()
    sqlite.close()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ provider: 'deterministic', pendingExplanation: true })
    expect(budget).toBeUndefined()
  })

  it('no contabiliza intentos de provider inexistentes en adaptations/analyze', async () => {
    const { sqlite, database } = sqliteD1()
    const input = analysisInput()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'budget-two-unknown' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fake-only', ENABLE_FLASH: 'true', ENABLE_PRO: 'true', FLASH_MODEL: 'deepseek-ai/deepseek-v4-flash-0731', MAX_WEEKLY_OUTPUT_TOKENS: '10000', DB: database }
    await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async (_prompt, model) => model.includes('flash') ? 'not-json' : (() => { throw new Error('timeout') })() } })
    const budget = sqlite.prepare('SELECT output_tokens, reserved_output_tokens, active_runs FROM adaptation_budgets').get() as { output_tokens: number; reserved_output_tokens: number; active_runs: number }
    const telemetry = sqlite.prepare('SELECT output_tokens, output_tokens_measured, output_tokens_estimated, usage_incomplete FROM adaptation_telemetry WHERE event_type = \'analysis\'').get()
    sqlite.close()
    expect(budget).toBeUndefined()
    expect(telemetry).toMatchObject({ output_tokens: null, output_tokens_measured: null, output_tokens_estimated: null, usage_incomplete: 0 })
  })

  it('no suma usage de provider en la ruta determinista', async () => {
    const { sqlite, database } = sqliteD1()
    const input = analysisInput()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'budget-partial' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fake-only', ENABLE_FLASH: 'true', ENABLE_PRO: 'true', FLASH_MODEL: 'deepseek-ai/deepseek-v4-flash-0731', MAX_WEEKLY_OUTPUT_TOKENS: '10000', DB: database }
    await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async (_prompt, model) => model.includes('flash') ? { content: 'not-json', usage: { inputTokens: 10, outputTokens: 10 } } : (() => { throw new Error('timeout') })() } })
    const budget = sqlite.prepare('SELECT output_tokens FROM adaptation_budgets').get()
    const telemetry = sqlite.prepare('SELECT output_tokens, output_tokens_measured, output_tokens_estimated, usage_incomplete FROM adaptation_telemetry WHERE event_type = \'analysis\'').get()
    sqlite.close()
    expect(budget).toBeUndefined()
    expect(telemetry).toMatchObject({ output_tokens: null, output_tokens_measured: null, output_tokens_estimated: null, usage_incomplete: 0 })
  })
})
