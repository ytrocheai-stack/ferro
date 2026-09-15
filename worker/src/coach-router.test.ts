import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CoachGenerationRouter, type D1Database, type D1Statement, type GenerationProvider, ProviderError } from './index'
import { recordProviderFailure } from './providers/circuit'

const wire = JSON.stringify({ type: 'decision', decision: { kind: 'maintain', explanation: 'Mantén el plan.', observations: [], evidence: [] } })

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  const migrations = fileURLToPath(new NodeURL('../migrations/', import.meta.url))
  for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`${migrations}/${name}`, 'utf8'))
  sqlite.prepare("INSERT INTO coach_runs (id, account_hash, event_id, context_version, request_hash, idempotency_key, status, request_json, created_at, updated_at) VALUES ('run', 'account', 'event', 'ctx', 'hash', 'key', 'running', '{}', 1, 1)").run()
  const db: D1Database = {
    prepare(query) {
      let args: SQLInputValue[] = []
      const statement: D1Statement = {
        bind(...values) { args = values as SQLInputValue[]; return statement },
        async first<T>() { return (sqlite.prepare(query).get(...args) ?? null) as T | null },
        async all<T>() { return { results: sqlite.prepare(query).all(...args) as T[] } },
        async run() { const result = sqlite.prepare(query).run(...args); return { success: true, meta: { changes: Number(result.changes) } } },
      }
      return statement
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())) },
  }
  return { sqlite, db }
}

function provider(result: string | Error): GenerationProvider {
  return { generate: async () => result instanceof Error ? Promise.reject(result) : result }
}

describe('CoachGenerationRouter', () => {
  it('prefiere Gemini y no llama NVIDIA cuando Gemini devuelve una respuesta válida', async () => {
    const { sqlite, db } = fixture()
    let nvidiaCalls = 0
    const router = new CoachGenerationRouter({
      db,
      runId: 'run',
      order: ['gemini', 'nvidia'],
      providers: { gemini: provider(wire), nvidia: { generate: async () => { nvidiaCalls++; return wire } } },
      models: { gemini: 'gemini-3.6-flash', nvidia: 'deepseek-ai/deepseek-v4-flash-0731' },
      enabled: { gemini: true, nvidia: true },
      now: () => 100,
    })

    await expect(router.generate('prompt', 1, undefined, content => JSON.parse(content))).resolves.toMatchObject({ content: wire, provider: 'gemini' })
    expect(nvidiaCalls).toBe(0)
    expect(sqlite.prepare('SELECT provider, model, logical_call_no, dispatch_status, status FROM coach_run_attempts').all()).toEqual([{ provider: 'gemini', model: 'gemini-3.6-flash', logical_call_no: 1, dispatch_status: 'succeeded', status: 'succeeded' }])
    sqlite.close()
  })

  it('hace failover por error del primer proveedor sin reintentar al mismo proveedor', async () => {
    const { sqlite, db } = fixture()
    let geminiCalls = 0
    let nvidiaCalls = 0
    const router = new CoachGenerationRouter({
      db,
      runId: 'run',
      order: ['gemini', 'nvidia'],
      providers: { gemini: { generate: async () => { geminiCalls++; throw new ProviderError('fallo', 503, 'server-error') } }, nvidia: { generate: async () => { nvidiaCalls++; return wire } } },
      models: { gemini: 'gemini-3.6-flash', nvidia: 'deepseek-ai/deepseek-v4-flash-0731' },
      enabled: { gemini: true, nvidia: true },
      now: () => 100,
    })

    await expect(router.generate('prompt', 1, undefined, content => JSON.parse(content))).resolves.toMatchObject({ content: wire, provider: 'nvidia' })
    expect(geminiCalls).toBe(1)
    expect(nvidiaCalls).toBe(1)
    expect(sqlite.prepare('SELECT attempt_no, provider, status FROM coach_run_attempts ORDER BY attempt_no').all()).toEqual([
      { attempt_no: 1, provider: 'gemini', status: 'failed' },
      { attempt_no: 2, provider: 'nvidia', status: 'succeeded' },
    ])
    sqlite.close()
  })

  it('hace failover y registra invalid-response ante una salida que incumple el contrato', async () => {
    const { sqlite, db } = fixture()
    const router = new CoachGenerationRouter({
      db,
      runId: 'run',
      order: ['gemini', 'nvidia'],
      providers: {
        gemini: { generate: async () => ({ content: 42 } as never) },
        nvidia: provider(wire),
      },
      models: { gemini: 'gemini-3.6-flash', nvidia: 'deepseek-ai/deepseek-v4-flash-0731' },
      enabled: { gemini: true, nvidia: true },
      now: () => 100,
    })

    await expect(router.generate('prompt', 1, undefined, content => JSON.parse(content))).resolves.toMatchObject({ provider: 'nvidia' })
    expect(sqlite.prepare("SELECT provider, error_code, status FROM coach_run_attempts WHERE provider = 'gemini'").all()).toEqual([{ provider: 'gemini', error_code: 'invalid-response', status: 'failed' }])
    sqlite.close()
  })

  it('permite NVIDIA a Gemini únicamente con una prueba half-open', async () => {
    const { sqlite, db } = fixture()
    await recordProviderFailure(db, 'gemini', 1)
    await recordProviderFailure(db, 'gemini', 2)
    await recordProviderFailure(db, 'gemini', 3)
    let geminiCalls = 0
    const router = new CoachGenerationRouter({
      db,
      runId: 'run',
      order: ['nvidia', 'gemini'],
      providers: { nvidia: provider(new ProviderError('fallo', 503, 'server-error')), gemini: { generate: async () => { geminiCalls++; return wire } } },
      models: { gemini: 'gemini-3.6-flash', nvidia: 'deepseek-ai/deepseek-v4-flash-0731' },
      enabled: { gemini: true, nvidia: true },
      now: () => 61_001,
    })

    await expect(router.generate('prompt', 1, undefined, content => JSON.parse(content))).resolves.toMatchObject({ provider: 'gemini' })
    expect(geminiCalls).toBe(1)
    sqlite.close()
  })

  it('no hace fallback tras cancelación y nunca supera dos solicitudes', async () => {
    const { sqlite, db } = fixture()
    let nvidiaCalls = 0
    const router = new CoachGenerationRouter({
      db,
      runId: 'run',
      order: ['gemini', 'nvidia'],
      providers: { gemini: provider(new ProviderError('cancelado', undefined, 'cancelled')), nvidia: { generate: async () => { nvidiaCalls++; return wire } } },
      models: { gemini: 'gemini-3.6-flash', nvidia: 'deepseek-ai/deepseek-v4-flash-0731' },
      enabled: { gemini: true, nvidia: true },
      now: () => 100,
    })

    await expect(router.generate('prompt', 1, undefined, content => JSON.parse(content))).rejects.toMatchObject({ code: 'cancelled' })
    expect(nvidiaCalls).toBe(0)
    sqlite.close()
  })

  it('no despacha ni hace fallback si la señal ya está cancelada', async () => {
    const { sqlite, db } = fixture()
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const router = new CoachGenerationRouter({
      db,
      runId: 'run',
      order: ['gemini', 'nvidia'],
      providers: {
        gemini: { generate: async () => { calls++; return wire } },
        nvidia: { generate: async () => { calls++; return wire } },
      },
      models: { gemini: 'gemini-3.6-flash', nvidia: 'deepseek-ai/deepseek-v4-flash-0731' },
      enabled: { gemini: true, nvidia: true },
      now: () => 100,
    })

    await expect(router.generate('prompt', 1, controller.signal, content => JSON.parse(content))).rejects.toMatchObject({ code: 'cancelled' })
    expect(calls).toBe(0)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM coach_run_attempts').get()).toEqual({ count: 0 })
    sqlite.close()
  })

  it('no reenvía un intento sent después de reiniciar', async () => {
    const { sqlite, db } = fixture()
    sqlite.prepare("INSERT INTO coach_run_attempts (id, run_id, attempt_no, fingerprint, model, provider, logical_call_no, dispatch_status, status, created_at, updated_at) VALUES ('sent', 'run', 1, 'old', 'gemini-3.6-flash', 'gemini', 1, 'sent', 'sent', 1, 1)").run()
    let calls = 0
    const router = new CoachGenerationRouter({
      db,
      runId: 'run',
      order: ['gemini', 'nvidia'],
      providers: { gemini: { generate: async () => { calls++; return wire } }, nvidia: provider(wire) },
      models: { gemini: 'gemini-3.6-flash', nvidia: 'deepseek-ai/deepseek-v4-flash-0731' },
      enabled: { gemini: true, nvidia: true },
      now: () => 100,
    })

    await expect(router.generate('prompt', 1, undefined, content => JSON.parse(content))).rejects.toThrow('attempt-fingerprint-mismatch')
    expect(calls).toBe(0)
    sqlite.close()
  })
})
