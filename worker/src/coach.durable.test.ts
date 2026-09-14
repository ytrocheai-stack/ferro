import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgentProtocol } from '../../packages/adaptation-core/src/agent'
import { COACH_CALL_TIMEOUT_MS, COACH_GENERATION_STEP_TIMEOUT, executeCoachRun, type D1Database, type D1Statement, type Env } from './index'
import { coachRunRequestSchema } from '../../packages/adaptation-core/src/contract'

const request = coachRunRequestSchema.parse({ event: { id: 'event', accountId: 'user', deviceId: 'device', type: 'message-sent', occurredAt: 1, contextVersion: 'ctx', payload: { message: 'Revisa' } }, context: { version: 'ctx', capturedAt: 1, timezone: 'UTC', isCurrent: true, snapshot: {} } })
const content = JSON.stringify({ type: 'decision', decision: { kind: 'maintain', explanation: 'Mantén el plan.', observations: [], evidence: [] } })
function fixture() {
  const sql = new DatabaseSync(':memory:')
  const migrations = fileURLToPath(new NodeURL('../migrations/', import.meta.url))
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(`${migrations}/${name}`, 'utf8'))
  sql.prepare("INSERT INTO coach_runs (id,account_hash,event_id,context_version,request_hash,idempotency_key,status,request_json,created_at,updated_at) VALUES ('run','account','event','ctx','hash','key','queued',?,1,1)").run(JSON.stringify(request))
  let failPersist = false
  const db: D1Database = {
    prepare(query) {
      let args: (string | number | null)[] = []
      const statement: D1Statement = {
        bind(...values) { args = values as typeof args; return statement },
        async first<T>() { return (sql.prepare(query).get(...args) ?? null) as T | null },
        async all<T>() { return { results: sql.prepare(query).all(...args) as T[] } },
        async run() {
          if (failPersist && query.includes("SET status = 'completed'")) throw new Error('D1 unavailable')
          const result = sql.prepare(query).run(...args)
          return { success: true, meta: { changes: Number(result.changes) } }
        },
      }
      return statement
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())) },
  }
  const env: Env = { DB: db, CLERK_JWT_KEY: 'key', ENABLE_FLASH: 'true' }
  const cache = new Map<string, unknown>()
  const steps = { async do<T>(name: string, _options: unknown, callback: () => Promise<T>): Promise<T> { if (cache.has(name)) return cache.get(name) as T; const value = await callback(); cache.set(name, value); return value } }
  return { sql, env, steps, cache, failPersist: (value: boolean) => { failPersist = value } }
}

describe('coach durable execution on SQLite', () => {
  afterEach(() => vi.useRealTimers())

  it('allows a response after 120 seconds while the 240-second call timeout remains open', async () => {
    vi.useFakeTimers()
    const result = runAgentProtocol({
      maxCalls: 1, deadlineAt: 600_000, now: () => 0, callTimeoutMs: COACH_CALL_TIMEOUT_MS,
      prompt: () => 'prompt',
      generate: async () => new Promise<string>((resolve) => { setTimeout(() => resolve('response'), 120_001) }),
      parse: () => ({ type: 'decision' as const, decision: true }), runTool: async () => null,
    })
    const assertion = expect(result).resolves.toMatchObject({ decision: true })
    await vi.advanceTimersByTimeAsync(120_001)
    await assertion
  })

  it('reports call timeout at 240 seconds and global exhaustion at 600 seconds', async () => {
    vi.useFakeTimers()
    const callTimeout = runAgentProtocol({
      maxCalls: 1, deadlineAt: 600_000, now: () => 0, callTimeoutMs: COACH_CALL_TIMEOUT_MS,
      prompt: () => 'prompt', generate: async () => new Promise<string>(() => undefined),
      parse: () => ({ type: 'decision' as const, decision: true }), runTool: async () => null,
    })
    const callAssertion = expect(callTimeout).rejects.toThrow('agent-deadline-exceeded')
    await vi.advanceTimersByTimeAsync(COACH_CALL_TIMEOUT_MS)
    await callAssertion

    let now = 0
    const globalTimeout = runAgentProtocol({
      maxCalls: 4, deadlineAt: 600_000, now: () => now, callTimeoutMs: COACH_CALL_TIMEOUT_MS,
      prompt: () => 'prompt', generate: async () => new Promise<string>((resolve) => { setTimeout(() => { now = 600_000; resolve('response') }, 1) }),
      parse: () => ({ type: 'decision' as const, decision: true }), runTool: async () => null,
    })
    const globalAssertion = expect(globalTimeout).rejects.toThrow('agent-deadline-exceeded')
    await vi.advanceTimersByTimeAsync(1)
    await globalAssertion
  })

  it('uses a 250-second durable generation step with no Workflow retry', async () => {
    const f = fixture()
    const options: Array<{ name: string; timeout?: string; retries?: { limit?: number } }> = []
    const steps = { async do<T>(name: string, stepOptions: { timeout?: string; retries?: { limit?: number } }, callback: () => Promise<T>): Promise<T> { options.push({ name, ...stepOptions }); return callback() } }
    await executeCoachRun(f.env, 'run', { now: () => 100, generation: { generate: async () => content } }, steps)
    const generationStep = options.find((step) => step.name === 'coach-run-generation-1')
    expect(generationStep?.timeout).toBe(COACH_GENERATION_STEP_TIMEOUT)
    expect(generationStep?.retries?.limit).toBe(0)
  })

  it('runs the explicitly configured free Flash model through the durable protocol', async () => {
    const f = fixture()
    f.env.FLASH_MODEL = 'deepseek-ai/deepseek-v4-flash-0731'
    await executeCoachRun(f.env, 'run', { now: () => 100, generation: { generate: async (_prompt, model) => { expect(model).toBe(f.env.FLASH_MODEL); return content } } }, f.steps)
    expect(f.sql.prepare('SELECT status FROM coach_runs').get()?.status).toBe('completed')
  })
  it('retries persistence after restart without a new provider call, even after the deadline', async () => {
    const f = fixture()
    let calls = 0
    let now = 100
    const deps = { now: () => now, generation: { generate: async () => { calls++; return content } } }
    f.failPersist(true)
    await expect(executeCoachRun(f.env, 'run', deps, f.steps)).rejects.toThrow('D1 unavailable')
    expect(f.sql.prepare('SELECT status FROM coach_runs').get()?.status).toBe('running')
    f.failPersist(false)
    // Simula respuesta confirmada en D1 cuyo checkpoint de Workflow se perdió.
    f.cache.delete('coach-run-generation-1')
    now += 700_000
    await executeCoachRun(f.env, 'run', deps, f.steps)
    expect(calls).toBe(1)
    expect(f.sql.prepare('SELECT status FROM coach_runs').get()?.status).toBe('completed')
    expect(f.sql.prepare('SELECT active_runs FROM adaptation_budgets').get()?.active_runs).toBe(0)
    expect(f.cache.has('coach-run-generation-1')).toBe(true)
    expect(f.cache.has('coach-run-persist')).toBe(true)
  })

  it('does not resend an unknown attempt when running is resumed', async () => {
    const f = fixture()
    f.sql.prepare("UPDATE coach_runs SET status = 'running', deadline_at = 600100").run()
    f.sql.prepare("INSERT INTO coach_run_attempts (id,run_id,attempt_no,fingerprint,model,status,created_at,updated_at) VALUES ('attempt','run',1,'unknown','moonshotai/kimi-k2.5','sent',1,1)").run()
    let calls = 0
    await executeCoachRun(f.env, 'run', { now: () => 100, generation: { generate: async () => { calls++; return content } } }, f.steps)
    expect(calls).toBe(0)
    expect(f.sql.prepare('SELECT status FROM coach_runs').get()?.status).toBe('failed')
    expect(f.sql.prepare('SELECT active_runs FROM adaptation_budgets').get()?.active_runs).toBe(0)
  })

  it('preserves cancellation and releases a reservation while a provider finishes', async () => {
    const f = fixture()
    await executeCoachRun(f.env, 'run', { now: () => 100, generation: { generate: async () => { f.sql.exec("UPDATE coach_runs SET status = 'cancelled'"); return content } } }, f.steps)
    expect(f.sql.prepare('SELECT status FROM coach_runs').get()?.status).toBe('cancelled')
    expect(f.sql.prepare('SELECT active_runs FROM adaptation_budgets').get()?.active_runs).toBe(0)
    expect(f.sql.prepare('SELECT settled FROM coach_budget_leases').get()?.settled).toBe(1)
  })

  it('stops after four tool turns and settles accounting once', async () => {
    const f = fixture()
    let calls = 0
    await executeCoachRun(f.env, 'run', { now: () => 100, generation: { generate: async () => { calls++; return JSON.stringify({ type: 'tool', name: 'goals', arguments: {} }) } } }, f.steps)
    expect(calls).toBe(4)
    expect(f.sql.prepare('SELECT status FROM coach_runs').get()?.status).toBe('failed')
    const before = f.sql.prepare('SELECT * FROM adaptation_budgets').get()
    f.sql.exec('UPDATE coach_budget_leases SET settled = 1')
    expect(f.sql.prepare('SELECT * FROM adaptation_budgets').get()).toEqual(before)
  })
})
