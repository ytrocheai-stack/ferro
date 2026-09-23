import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgentProtocol } from '../../packages/adaptation-core/src/agent'
import { COACH_CALL_TIMEOUT_MS, COACH_GENERATION_STEP_TIMEOUT, executeCoachRun, persistCoachSnapshot, pruneTelemetry, reconcileCoachRuns, ProviderError, type D1Database, type D1Statement, type Env } from './index'
import { GEMINI_MODEL } from './providers/gemini'
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
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('purges only aged terminal coach runs and children, repairs orphans, and preserves active/recent account data', async () => {
    const f = fixture()
    const now = Date.UTC(2026, 8, 23, 12)
    const cutoff = now - 7 * 24 * 60 * 60 * 1000
    const oldAt = cutoff - 1
    const recentAt = now - 1
    const week = '2026-39'
    const insertRun = f.sql.prepare('INSERT INTO coach_runs (id, account_hash, event_id, context_version, request_hash, idempotency_key, status, request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const insertAttempt = f.sql.prepare('INSERT INTO coach_run_attempts (id, run_id, attempt_no, fingerprint, model, status, response_json, created_at, updated_at) VALUES (?, ?, 1, ?, ?, \'succeeded\', ?, ?, ?)')
    const insertSnapshot = f.sql.prepare('INSERT INTO coach_run_snapshots (run_id, sequence, text, status, decision_json, created_at) VALUES (?, 1, ?, ?, ?, ?)')
    const insertBudget = f.sql.prepare('INSERT INTO adaptation_budgets (user_hash, iso_week, input_tokens, output_tokens, reserved_input_tokens, reserved_output_tokens, active_runs) VALUES (?, ?, 0, 0, 0, 0, 0)')
    const insertLease = f.sql.prepare('INSERT INTO coach_budget_leases (run_id, user_hash, iso_week, input_estimate, output_estimate) VALUES (?, ?, ?, ?, ?)')
    const seedRun = (id: string, status: string, updatedAt: number, accountHash = id) => insertRun.run(id, accountHash, `event-${id}`, 'ctx', `hash-${id}`, `key-${id}`, status, JSON.stringify(request), oldAt, updatedAt)
    const seedChildren = (id: string, status: string, createdAt: number) => {
      insertAttempt.run(`attempt-${id}`, id, `fingerprint-${id}`, 'gemini-3.5-flash-lite', JSON.stringify({ content: `private-${id}` }), createdAt, createdAt)
      insertSnapshot.run(id, `private-${id}`, status, JSON.stringify({ explanation: `private-${id}` }), createdAt)
    }

    f.sql.prepare("UPDATE coach_runs SET status = 'completed', updated_at = ? WHERE id = 'run'").run(oldAt)
    seedChildren('run', 'completed', oldAt)
    for (const [id, status] of [['failed-old', 'failed'], ['cancelled-old', 'cancelled']] as const) {
      seedRun(id, status, oldAt)
      seedChildren(id, status, oldAt)
    }
    seedRun('running-old', 'running', oldAt, 'active-account')
    seedChildren('running-old', 'running', oldAt)
    seedRun('queued-old', 'queued', oldAt, 'queued-account')
    seedChildren('queued-old', 'queued', oldAt)
    seedRun('recent-terminal', 'failed', recentAt, 'recent-account')
    seedChildren('recent-terminal', 'failed', recentAt)
    insertAttempt.run('orphan-attempt', 'missing-parent', 'orphan-fingerprint', 'gemini-3.5-flash-lite', JSON.stringify({ content: 'private-orphan' }), oldAt, oldAt)
    insertSnapshot.run('missing-parent', 'private-orphan', 'failed', JSON.stringify({ explanation: 'private-orphan' }), oldAt)

    insertBudget.run('account', week)
    insertLease.run('run', 'account', week, 100, 4000)
    insertBudget.run('orphan-account', week)
    insertLease.run('orphan-budget-run', 'orphan-account', week, 50, 500)
    insertBudget.run('active-account', week)
    insertLease.run('running-old', 'active-account', week, 20, 80)
    insertBudget.run('recent-account', week)
    insertLease.run('recent-terminal', 'recent-account', week, 10, 40)
    f.sql.prepare("UPDATE coach_budget_leases SET settled = 1, input_tokens = 7, output_tokens = 30 WHERE run_id = 'recent-terminal'").run()

    await pruneTelemetry(f.env.DB, now)

    expect(f.sql.prepare('SELECT id FROM coach_runs ORDER BY id').all()).toEqual([{ id: 'queued-old' }, { id: 'recent-terminal' }, { id: 'running-old' }])
    expect(f.sql.prepare('SELECT id, run_id FROM coach_run_attempts ORDER BY id').all()).toEqual([
      { id: 'attempt-queued-old', run_id: 'queued-old' },
      { id: 'attempt-recent-terminal', run_id: 'recent-terminal' },
      { id: 'attempt-running-old', run_id: 'running-old' },
    ])
    expect(f.sql.prepare('SELECT run_id, text FROM coach_run_snapshots ORDER BY run_id').all()).toEqual([
      { run_id: 'queued-old', text: 'private-queued-old' },
      { run_id: 'recent-terminal', text: 'private-recent-terminal' },
      { run_id: 'running-old', text: 'private-running-old' },
    ])
    expect(f.sql.prepare('SELECT run_id FROM coach_budget_leases ORDER BY run_id').all()).toEqual([{ run_id: 'recent-terminal' }, { run_id: 'running-old' }])
    expect(f.sql.prepare("SELECT input_tokens, output_tokens, reserved_input_tokens, reserved_output_tokens, active_runs FROM adaptation_budgets WHERE user_hash = 'account'").get()).toEqual({ input_tokens: 100, output_tokens: 4000, reserved_input_tokens: 0, reserved_output_tokens: 0, active_runs: 0 })
    expect(f.sql.prepare("SELECT input_tokens, output_tokens, active_runs FROM adaptation_budgets WHERE user_hash = 'orphan-account'").get()).toEqual({ input_tokens: 50, output_tokens: 500, active_runs: 0 })
    expect(f.sql.prepare("SELECT active_runs FROM adaptation_budgets WHERE user_hash = 'active-account'").get()).toEqual({ active_runs: 1 })
    expect(f.sql.prepare("SELECT input_tokens, output_tokens FROM adaptation_budgets WHERE user_hash = 'recent-account'").get()).toEqual({ input_tokens: 7, output_tokens: 30 })
  })

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
  it('fija el modelo Gemini aprobado al reanudar una ejecución de producción con env desactualizado', async () => {
    const f = fixture()
    f.env.ENVIRONMENT = 'production'
    f.env.GEMINI_MODEL = 'gemini-unapproved-model'
    f.env.ENABLE_GEMINI = 'true'
    f.env.ENABLE_NVIDIA = 'false'
    f.env.ENABLE_FLASH = 'false'
    f.sql.prepare("UPDATE coach_runs SET status = 'running', started_at = 1, deadline_at = 600000 WHERE id = 'run'").run()
    const models: string[] = []
    await executeCoachRun(f.env, 'run', {
      now: () => 100,
      generationProviders: { gemini: { generate: async (_prompt, model) => { models.push(model); return content } } },
    }, f.steps)
    expect(models).toEqual([GEMINI_MODEL])
    expect(f.sql.prepare('SELECT status FROM coach_runs').get()?.status).toBe('completed')
  })
  it('fija el modelo de embeddings aprobado al reanudar aunque env apunte a otro modelo', async () => {
    const f = fixture()
    const populatedRequest = coachRunRequestSchema.parse({
      ...request,
      context: { ...request.context, snapshot: { ...request.context.snapshot, profile: { ...request.context.snapshot.profile, population: ['adult'], populationConfirmed: true } } },
    })
    f.sql.prepare('UPDATE coach_runs SET request_json = ?, status = \'running\', started_at = 1, deadline_at = 600000 WHERE id = \'run\'').run(JSON.stringify(populatedRequest))
    f.env.ENVIRONMENT = 'production'
    f.env.ENABLE_EMBEDDINGS = 'true'
    f.env.ENABLE_GEMINI = 'true'
    f.env.ENABLE_NVIDIA = 'false'
    f.env.NVIDIA_API_KEY = 'embedding-only-key'
    f.env.EMBEDDING_MODEL = 'nvidia/unapproved-embedding-model'
    f.env.RAG_INDEX_VERSION = 'v1'
    let dispatchedModel = ''
    let queriedVector: number[] = []
    f.env.VECTORIZE = { query: async vector => { queriedVector = vector; return { matches: [] } } }
    vi.stubGlobal('fetch', (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { model?: string }
      dispatchedModel = payload.model ?? ''
      return Response.json({ data: [{ embedding: new Array(2048).fill(1) }] })
    }) as typeof fetch)
    await executeCoachRun(f.env, 'run', {
      now: () => 100,
      generationProviders: { gemini: { generate: async () => content } },
    }, f.steps)
    expect(dispatchedModel).toBe('nvidia/nemotron-3-embed-1b')
    expect(queriedVector).toHaveLength(512)
    expect(f.sql.prepare('SELECT status FROM coach_runs').get()?.status).toBe('completed')
  })
  it('falla sin decisión y nunca despacha generación a NVIDIA en producción', async () => {
    const f = fixture()
    f.env.ENVIRONMENT = 'production'
    f.env.COACH_PROVIDER_ORDER = 'gemini,nvidia'
    f.env.ENABLE_GEMINI = 'true'
    f.env.ENABLE_NVIDIA = 'true' // Incluso una configuración accidental debe filtrar NVIDIA en producción.
    f.env.ENABLE_FLASH = 'true'
    let nvidiaDispatches = 0
    await executeCoachRun(f.env, 'run', {
      now: () => 100,
      generationProviders: {
        gemini: { generate: async () => { throw new ProviderError('Gemini caído', 503, 'server-error') } },
        nvidia: { generate: async () => { nvidiaDispatches += 1; return content } },
      },
    }, f.steps)
    expect(nvidiaDispatches).toBe(0)
    expect(f.sql.prepare('SELECT status, error_code, decision_json FROM coach_runs').get()).toEqual({ status: 'failed', error_code: 'provider-server-error', decision_json: null })
    expect(f.sql.prepare("SELECT status, text, decision_json FROM coach_run_snapshots WHERE run_id = 'run' ORDER BY sequence DESC LIMIT 1").get()).toMatchObject({ status: 'failed', text: '', decision_json: null })
  })
  it('persiste indisponibilidad recuperable sin decisión cuando ambos proveedores están apagados', async () => {
    const f = fixture()
    f.env.ENABLE_GEMINI = 'false'
    f.env.ENABLE_NVIDIA = 'false'
    await executeCoachRun(f.env, 'run', { now: () => 100 }, f.steps)
    expect(f.sql.prepare('SELECT status, error_code, decision_json FROM coach_runs').get()).toEqual({ status: 'failed', error_code: 'coach-providers-unavailable', decision_json: null })
    expect(f.sql.prepare("SELECT status, text FROM coach_run_snapshots WHERE run_id = 'run' ORDER BY sequence DESC LIMIT 1").get()).toMatchObject({ status: 'failed', text: '' })
  })
  it('desactiva streaming de providers en producción aunque la bandera esté activa', async () => {
    const f = fixture()
    f.env.ENVIRONMENT = 'production'
    f.env.COACH_PROVIDER_ORDER = 'gemini'
    f.env.ENABLE_GEMINI = 'true'
    f.env.ENABLE_NVIDIA = 'false'
    f.env.ENABLE_FLASH = 'false'
    f.env.ENABLE_COACH_STREAMING = 'true'
    let streamCalls = 0
    await executeCoachRun(f.env, 'run', {
      now: () => 100,
      generationProviders: { gemini: {
        generate: async () => content,
        generateStream: async () => { streamCalls += 1; return content },
      } },
    }, f.steps)
    expect(streamCalls).toBe(0)
    expect(f.sql.prepare('SELECT status FROM coach_runs').get()?.status).toBe('completed')
  })
  it('uses the opt-in stream for a tool turn, continues, and publishes explanation only after completion', async () => {
    const f = fixture()
    f.env.ENABLE_COACH_STREAMING = 'true'
    let calls = 0
    let generateCalls = 0
    const observed: Array<{ explanation: string; status: unknown }> = []
    await executeCoachRun(f.env, 'run', {
      now: () => 100,
      generation: {
        generate: async () => { generateCalls++; return content },
        generateStream: async (_prompt, _model, _signal, onExplanation) => {
          calls++
          if (calls === 1) return JSON.stringify({ type: 'tool', name: 'goals', arguments: {} })
          onExplanation?.('Mantén el plan.')
          return content
        },
      },
      onCoachExplanation: async (runId, explanation) => { observed.push({ explanation, status: f.sql.prepare('SELECT status FROM coach_runs WHERE id = ?').get(runId)?.status }) },
    }, f.steps)
    expect(generateCalls).toBe(0)
    expect(calls).toBe(2)
    expect(observed).toEqual([{ explanation: 'Mantén el plan.', status: 'completed' }])
  })

  it('persists a cancelled terminal snapshot when a restarted Workflow sees cancellation', async () => {
    const f = fixture()
    f.sql.prepare("UPDATE coach_runs SET status = 'cancelled', error_code = 'cancelled', ended_at = 50 WHERE id = 'run'").run()
    await executeCoachRun(f.env, 'run', { now: () => 100 }, f.steps)
    expect(f.sql.prepare("SELECT status, error_code FROM coach_run_snapshots WHERE run_id = 'run' ORDER BY sequence DESC LIMIT 1").get()).toMatchObject({ status: 'cancelled', error_code: 'cancelled' })
    expect(f.sql.prepare("SELECT status FROM coach_runs WHERE id = 'run'").get()?.status).toBe('cancelled')
  })

  it('expires only still-active runs and emits a failed terminal snapshot', async () => {
    const f = fixture()
    f.sql.prepare("UPDATE coach_runs SET deadline_at = 10 WHERE id = 'run'").run()
    await reconcileCoachRuns(f.env.DB!, 'account', 20)
    expect(f.sql.prepare("SELECT status, error_code FROM coach_runs WHERE id = 'run'").get()).toMatchObject({ status: 'failed', error_code: 'coach-global-deadline-exceeded' })
    expect(f.sql.prepare("SELECT status, error_code FROM coach_run_snapshots WHERE run_id = 'run' ORDER BY sequence DESC LIMIT 1").get()).toMatchObject({ status: 'failed', error_code: 'coach-global-deadline-exceeded' })
  })

  it('retries a sequence collision and assigns the next D1 sequence', async () => {
    let latestReads = 0
    let stored = 0
    const db: D1Database = {
      prepare(sql) {
        let args: unknown[] = []
        const statement: D1Statement = {
          bind(...values) { args = values; return statement },
          async first<T>() { return (sql.includes('coach_run_snapshots') && latestReads++ < 2 ? null : stored ? { run_id: 'run', sequence: stored, text: 'prev', status: 'running', created_at: 1 } : null) as T | null },
          async all<T>() { return { results: [] as T[] } },
          async run() {
            if (sql.includes('INSERT INTO coach_run_snapshots')) {
              if (stored === 0) { stored = Number(args[1]); return { success: true } }
              if (Number(args[1]) === 1) throw new Error('UNIQUE constraint failed: coach_run_snapshots.run_id, coach_run_snapshots.sequence')
              stored = Number(args[1]); return { success: true }
            }
            return { success: true }
          },
        }
        return statement
      },
      async batch() { return [] },
    }
    const results = await Promise.all([
      persistCoachSnapshot(db, 'run', 'uno', 'running', 2),
      persistCoachSnapshot(db, 'run', 'dos', 'running', 2_002),
    ])
    expect(results.map((result) => result?.sequence).sort()).toEqual([1, 2])
  })

  it('keeps the failed path from overwriting a run cancelled during generation', async () => {
    const f = fixture()
    let calls = 0
    f.sql.prepare("UPDATE coach_runs SET status = 'running' WHERE id = 'run'").run()
    await executeCoachRun(f.env, 'run', {
      now: () => 100,
      generation: { generate: async () => { calls += 1; f.sql.prepare("UPDATE coach_runs SET status = 'cancelled', error_code = 'cancelled' WHERE id = 'run'").run(); throw new Error('provider-server-error') } },
    }, f.steps)
    expect(calls).toBe(1)
    expect(f.sql.prepare("SELECT status FROM coach_runs WHERE id = 'run'").get()?.status).toBe('cancelled')
    expect(f.sql.prepare("SELECT status FROM coach_run_snapshots WHERE run_id = 'run' ORDER BY sequence DESC LIMIT 1").get()?.status).toBe('cancelled')
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
