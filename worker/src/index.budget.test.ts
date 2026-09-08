import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handleRequest, reserveProviderRequest, type D1Database, type Env } from './index'

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
  it('el modo solicitudes no interpreta tokens históricos como saldo NVIDIA agotado', async () => {
    const { sqlite, database } = sqliteD1()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fixture', ENABLE_FLASH: 'true', NVIDIA_ACCOUNTING_MODE: 'requests', DB: database }
    let calls = 0
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async () => { calls++; return { content: '[]', usage: { inputTokens: 100, outputTokens: 10 } } } } }
    await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'request-mode-1' }, body: JSON.stringify({ inputs: [analysisInput()] }) }), env, deps)
    sqlite.exec('UPDATE adaptation_budgets SET input_tokens = 1000000, output_tokens = 1000000')
    await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'request-mode-2' }, body: JSON.stringify({ inputs: [{ ...analysisInput(), workoutId: 'next' }] }) }), env, deps)
    expect(calls).toBe(2)
    sqlite.close()
  })
  it('espacia solicitudes globales de NVIDIA atómicamente entre usuarios e instancias', async () => {
    const { sqlite, database } = sqliteD1()
    const now = 1_700_000_000_000
    const results = await Promise.all([reserveProviderRequest(database, now, 40), reserveProviderRequest(database, now, 40)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await reserveProviderRequest(database, now + 1499, 40)).toBe(false)
    expect(await reserveProviderRequest(database, now + 1500, 40)).toBe(true)
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

  it('devuelve fallback cuando el proveedor supera el límite de salida', async () => {
    const { sqlite, database } = sqliteD1()
    const input = analysisInput()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'budget-test' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fake-only', ENABLE_FLASH: 'true', MAX_WEEKLY_OUTPUT_TOKENS: '5000', DB: database }
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async () => ({ content: '[]', usage: { inputTokens: 100, outputTokens: 6_000 } }) } })
    const body = await response.json() as { provider: string; pendingExplanation: boolean }
    const budget = sqlite.prepare('SELECT output_tokens, reserved_output_tokens, active_runs FROM adaptation_budgets').get() as { output_tokens: number; reserved_output_tokens: number; active_runs: number }
    sqlite.close()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ provider: 'deterministic', pendingExplanation: true })
    expect(budget).toEqual({ output_tokens: 5_000, reserved_output_tokens: 0, active_runs: 0 })
  })

  it('cobra la estimación reservada si el proveedor termina sin usage', async () => {
    const { sqlite, database } = sqliteD1()
    const input = analysisInput()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'budget-unknown-usage' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fake-only', ENABLE_FLASH: 'true', MAX_WEEKLY_OUTPUT_TOKENS: '5000', DB: database }
    const response = await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async () => { throw new Error('timeout') } } })
    const body = await response.json() as { provider: string; pendingExplanation: boolean }
    const budget = sqlite.prepare('SELECT output_tokens, reserved_output_tokens, active_runs FROM adaptation_budgets').get() as { output_tokens: number; reserved_output_tokens: number; active_runs: number }
    sqlite.close()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ provider: 'deterministic', pendingExplanation: true })
    expect(budget).toEqual({ output_tokens: 4_000, reserved_output_tokens: 0, active_runs: 0 })
  })

  it('contabiliza ambos intentos sin usage como 8.000 tokens de salida', async () => {
    const { sqlite, database } = sqliteD1()
    const input = analysisInput()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'budget-two-unknown' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fake-only', ENABLE_FLASH: 'true', ENABLE_PRO: 'true', FLASH_MODEL: 'deepseek-ai/deepseek-v4-flash-0731', MAX_WEEKLY_OUTPUT_TOKENS: '10000', DB: database }
    await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async (_prompt, model) => model.includes('flash') ? 'not-json' : (() => { throw new Error('timeout') })() } })
    const budget = sqlite.prepare('SELECT output_tokens, reserved_output_tokens, active_runs FROM adaptation_budgets').get() as { output_tokens: number; reserved_output_tokens: number; active_runs: number }
    const telemetry = sqlite.prepare('SELECT output_tokens, output_tokens_measured, output_tokens_estimated, usage_incomplete FROM adaptation_telemetry WHERE event_type = \'analysis\'').get() as { output_tokens: number; output_tokens_measured: number | null; output_tokens_estimated: number | null; usage_incomplete: number }
    sqlite.close()
    expect(budget).toEqual({ output_tokens: 8_000, reserved_output_tokens: 0, active_runs: 0 })
    expect(telemetry).toMatchObject({ output_tokens: 8_000, output_tokens_measured: null, output_tokens_estimated: 8_000, usage_incomplete: 1 })
  })

  it('suma el uso Flash medido y estima solo el timeout de Pro', async () => {
    const { sqlite, database } = sqliteD1()
    const input = analysisInput()
    const headers = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'budget-partial' }
    const env: Env = { CLERK_JWT_KEY: 'test-key', ALLOWED_CLERK_IDS: 'user_1', NVIDIA_API_KEY: 'fake-only', ENABLE_FLASH: 'true', ENABLE_PRO: 'true', FLASH_MODEL: 'deepseek-ai/deepseek-v4-flash-0731', MAX_WEEKLY_OUTPUT_TOKENS: '10000', DB: database }
    await handleRequest(new Request('https://worker.test/v1/adaptations/analyze', { method: 'POST', headers, body: JSON.stringify({ inputs: [input] }) }), env, { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000, generation: { generate: async (_prompt, model) => model.includes('flash') ? { content: 'not-json', usage: { inputTokens: 10, outputTokens: 10 } } : (() => { throw new Error('timeout') })() } })
    const budget = sqlite.prepare('SELECT output_tokens FROM adaptation_budgets').get() as { output_tokens: number }
    const telemetry = sqlite.prepare('SELECT output_tokens, output_tokens_measured, output_tokens_estimated, usage_incomplete FROM adaptation_telemetry WHERE event_type = \'analysis\'').get() as { output_tokens: number; output_tokens_measured: number | null; output_tokens_estimated: number | null; usage_incomplete: number }
    sqlite.close()
    expect(budget.output_tokens).toBe(4_010)
    expect(telemetry).toMatchObject({ output_tokens: 4_010, output_tokens_measured: 10, output_tokens_estimated: 4_000, usage_incomplete: 1 })
  })
})
