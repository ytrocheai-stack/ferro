import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { D1Database, D1Statement } from '../index'
import { deferNvidiaRequest, estimateGeminiInputTokens, geminiPacificDayKey, parseGeminiPromptTokenCount, reconcileGeminiInputTokens, reserveGeminiRequest, reserveNvidiaRequest, waitForNvidiaRequest } from './quota'
import { acquireProviderCircuit, openProviderCircuitUntil, recordProviderFailure, recordProviderSuccess } from './circuit'

function fixture(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(':memory:')
  const migrations = fileURLToPath(new NodeURL('../../migrations/', import.meta.url))
  for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`${migrations}/${name}`, 'utf8'))
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

describe('cuotas durables de proveedores', () => {
  it('migra el ledger de intentos y crea estado Gemini/circuitos sin borrar históricos', () => {
    const { sqlite } = fixture()
    const columns = sqlite.prepare('PRAGMA table_info(coach_run_attempts)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['provider', 'logical_call_no', 'dispatch_status']))
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM gemini_quota_state').get()).toEqual({ count: 1 })
    expect(sqlite.prepare("SELECT provider FROM provider_circuit_state ORDER BY provider").all()).toEqual([{ provider: 'gemini' }, { provider: 'nvidia' }])
    expect(sqlite.prepare("SELECT provider, next_allowed_at, used_requests, max_requests FROM provider_request_limits WHERE provider='nvidia'").get()).toEqual({ provider: 'nvidia', next_allowed_at: 0, used_requests: 0, max_requests: 0 })
    sqlite.close()
  })

  it('reserva NVIDIA globalmente, ignora max_requests y conserva 1.500 ms a 40 RPM', async () => {
    const { sqlite, db } = fixture()
    sqlite.exec("INSERT OR IGNORE INTO provider_request_limits(provider,next_allowed_at,used_requests,max_requests) VALUES ('nvidia',0,0,0)")
    sqlite.exec("UPDATE provider_request_limits SET next_allowed_at=0, used_requests=4499, max_requests=1 WHERE provider='nvidia'")
    const first = await reserveNvidiaRequest(db, 1_700_000_000_000, 40)
    expect(first.reserved).toBe(true)
    expect((await reserveNvidiaRequest(db, 1_700_000_000_000 + 1_499, 40)).reserved).toBe(false)
    expect((await reserveNvidiaRequest(db, 1_700_000_000_000 + 1_500, 40)).reserved).toBe(true)
    expect(sqlite.prepare("SELECT used_requests, max_requests FROM provider_request_limits WHERE provider = 'nvidia'").get()).toEqual({ used_requests: 4501, max_requests: 1 })
    sqlite.close()
  })

  it('coordina dos isolates concurrentes y respeta Retry-After sin devolver una reserva', async () => {
    const { sqlite, db } = fixture()
    sqlite.exec("UPDATE provider_request_limits SET next_allowed_at=0, used_requests=0, max_requests=0 WHERE provider='nvidia'")
    const results = await Promise.all([reserveNvidiaRequest(db, 10_000, 40), reserveNvidiaRequest(db, 10_000, 40)])
    expect(results.filter((result) => result.reserved)).toHaveLength(1)
    await deferNvidiaRequest(db, 10_000, 10_000)
    expect((await reserveNvidiaRequest(db, 19_999, 40)).reserved).toBe(false)
    expect((await reserveNvidiaRequest(db, 20_000, 40)).reserved).toBe(true)
    sqlite.close()
  })

  it('cancela una espera NVIDIA antes del despacho', async () => {
    const { db } = fixture()
    const controller = new AbortController()
    await reserveNvidiaRequest(db, 1_000, 40)
    const pending = waitForNvidiaRequest(db, { now: () => 1_000, signal: controller.signal, sleep: () => new Promise<void>(() => undefined) })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect((await db.prepare("SELECT used_requests FROM provider_request_limits WHERE provider='nvidia'").first<{ used_requests: number }>())?.used_requests).toBe(1)
  })

  it('reserva RPM, TPM y RPD Gemini con ventanas atómicas y día del Pacífico', async () => {
    const { sqlite, db } = fixture()
    const limits = { requestsPerMinute: 2, inputTokensPerMinute: 100, requestsPerDay: 2 }
    const now = Date.parse('2026-01-15T06:59:00.000Z')
    expect(geminiPacificDayKey(now)).toBe('2026-01-14')
    const first = await reserveGeminiRequest(db, now, 60, limits)
    expect(first.reserved).toBe(true)
    const denied = await reserveGeminiRequest(db, now, 41, limits)
    expect(denied.reserved).toBe(false)
    await expect(reconcileGeminiInputTokens(db, denied, { promptTokenCount: 1 }, now + 1)).rejects.toMatchObject({ code: 'invalid-config' })
    expect((await reserveGeminiRequest(db, now + 60_000, 40, limits)).reserved).toBe(true)
    expect((await reserveGeminiRequest(db, now + 120_000, 1, limits)).reserved).toBe(false)
    // 08:01Z is midnight in Los Angeles for this winter date: RPD resets.
    const nextPacificDay = Date.parse('2026-01-15T08:01:00.000Z')
    expect(geminiPacificDayKey(nextPacificDay)).toBe('2026-01-15')
    expect((await reserveGeminiRequest(db, nextPacificDay, 1, limits)).reserved).toBe(true)
    expect(sqlite.prepare('SELECT minute_requests, minute_input_tokens, day_requests FROM gemini_quota_state').get()).toEqual({ minute_requests: 1, minute_input_tokens: 1, day_requests: 1 })
    sqlite.close()
  })

  it('estima el request serializado completo con margen adversarial y reconcilia usageMetadata sin countTokens', async () => {
    const { sqlite, db } = fixture()
    const requests = [
      { systemInstruction: { parts: [{ text: 'Devuelve JSON estricto.' }] }, contents: [{ role: 'user', parts: [{ text: 'fuerza 💪 y recuperación' }] }], generationConfig: { responseMimeType: 'application/json' } },
      { systemInstruction: { parts: [{ text: '¡¡¡¡,,,,....::::;;;;????!!!!(((( )))) [[ ]] {{ }}' }] }, contents: [{ role: 'user', parts: [{ text: '\ud83d\udca5\u0301'.repeat(1000) }] }], generationConfig: { responseMimeType: 'application/json' } },
      { systemInstruction: { parts: [{ text: 'JSON' }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify({ name: 'sentadilla', sets: [{ weightKg: 100, reps: 8, notes: '💪 recuperación' }] }) }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'object', properties: { name: { type: 'string' } } } } },
    ]
    for (const request of requests) {
      const serialized = JSON.stringify(request)
      const utf8Bytes = new TextEncoder().encode(serialized).byteLength
      const scalarCount = Array.from(serialized).length
      expect(estimateGeminiInputTokens(serialized)).toBeGreaterThan(Math.ceil(utf8Bytes / 3))
      expect(estimateGeminiInputTokens(serialized)).toBeGreaterThan(scalarCount)
    }
    const estimate = estimateGeminiInputTokens(JSON.stringify(requests[0]))
    expect(estimate).toBeGreaterThan(0)
    expect(parseGeminiPromptTokenCount({ promptTokenCount: 23 })).toBe(23)
    expect(parseGeminiPromptTokenCount({ promptTokenCount: -1 })).toBeUndefined()
    const reservation = await reserveGeminiRequest(db, 10_000, estimate, { requestsPerMinute: 10, inputTokensPerMinute: 1_000, requestsPerDay: 10 }, 'attempt-uncertain')
    const missing = await reconcileGeminiInputTokens(db, reservation, undefined, 10_001)
    expect(missing).toEqual({ inputTokens: estimate, estimated: true })
    expect(await reconcileGeminiInputTokens(db, reservation, { promptTokenCount: 999 }, 10_002)).toEqual({ inputTokens: estimate, estimated: true })
    const measuredReservation = await reserveGeminiRequest(db, 70_000, 20, { requestsPerMinute: 10, inputTokensPerMinute: 1_000, requestsPerDay: 10 })
    expect(await reconcileGeminiInputTokens(db, measuredReservation, { promptTokenCount: 5 }, 70_001)).toEqual({ inputTokens: 5, estimated: false })
    expect(sqlite.prepare('SELECT input_tokens_estimated, input_tokens_measured, usage_incomplete FROM gemini_quota_state').get()).toEqual({ input_tokens_estimated: estimate + 20, input_tokens_measured: 5, usage_incomplete: 1 })
    sqlite.close()
  })

  it('deja la reconciliación pendiente si falla el batch y la completa sin doble contabilizar al reintentar', async () => {
    const { sqlite, db } = fixture()
    const reservation = await reserveGeminiRequest(db, 10_000, 20, { requestsPerMinute: 10, inputTokensPerMinute: 100, requestsPerDay: 10 }, 'batch-failure')
    const failingDb = {
      ...db,
      async batch(statements: D1Statement[]) {
        await statements[0].run()
        throw new Error('fallo entre pasos')
      },
    } as D1Database

    await expect(reconcileGeminiInputTokens(failingDb, reservation, { promptTokenCount: 25 }, 10_001)).rejects.toThrow('fallo entre pasos')
    expect(sqlite.prepare('SELECT state_applied, measured_input_tokens FROM gemini_quota_reconciliations WHERE reservation_id = ?').get('batch-failure')).toEqual({ state_applied: 0, measured_input_tokens: 25 })
    expect(sqlite.prepare('SELECT input_tokens_measured, input_tokens_estimated FROM gemini_quota_state').get()).toEqual({ input_tokens_measured: 0, input_tokens_estimated: 0 })

    await expect(reconcileGeminiInputTokens(db, reservation, { promptTokenCount: 25 }, 10_002)).resolves.toEqual({ inputTokens: 25, estimated: false })
    expect(sqlite.prepare('SELECT state_applied, state_applied_at FROM gemini_quota_reconciliations WHERE reservation_id = ?').get('batch-failure')).toMatchObject({ state_applied: 1, state_applied_at: 10_002 })
    expect(sqlite.prepare('SELECT input_tokens_measured, input_tokens_estimated FROM gemini_quota_state').get()).toEqual({ input_tokens_measured: 25, input_tokens_estimated: 20 })
    sqlite.close()
  })

  it('comparte el límite entre dos wrappers de cuentas distintas y no reserva al cancelar la espera', async () => {
    const { sqlite, db } = fixture()
    const makeWrapper = () => ({
      prepare: (query: string) => {
        let args: SQLInputValue[] = []
        const statement: D1Statement = {
          bind(...values) { args = values as SQLInputValue[]; return statement },
          async first<T>() { return (sqlite.prepare(query).get(...args) ?? null) as T | null },
          async all<T>() { return { results: sqlite.prepare(query).all(...args) as T[] } },
          async run() { const result = sqlite.prepare(query).run(...args); return { success: true, meta: { changes: Number(result.changes) } } },
        }
        return statement
      },
      async batch(statements: D1Statement[]) { return Promise.all(statements.map((statement) => statement.run())) },
    } as D1Database)
    const accountA = makeWrapper()
    const accountB = makeWrapper()
    const results = await Promise.all([
      reserveGeminiRequest(accountA, 20_000, 1, { requestsPerMinute: 1, inputTokensPerMinute: 10, requestsPerDay: 10 }),
      reserveGeminiRequest(accountB, 20_000, 1, { requestsPerMinute: 1, inputTokensPerMinute: 10, requestsPerDay: 10 }),
    ])
    expect(results.filter((result) => result.reserved)).toHaveLength(1)
    await reserveNvidiaRequest(db, 20_000, 40)
    const controller = new AbortController()
    const pending = waitForNvidiaRequest(db, { now: () => 20_000, sleep: () => new Promise<void>(() => undefined), signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    sqlite.close()
  })
})

describe('circuitos durables de proveedores', () => {
  it('abre tras fallos consecutivos, concede un único half-open y resetea al éxito', async () => {
    const { sqlite, db } = fixture()
    expect(await acquireProviderCircuit(db, 'gemini', 0)).toMatchObject({ permission: 'closed' })
    expect((await recordProviderFailure(db, 'gemini', 1, 0, { failureThreshold: 2, cooldownMs: 100, halfOpenLeaseMs: 20 })).consecutive_failures).toBe(1)
    const opened = await recordProviderFailure(db, 'gemini', 2, 0, { failureThreshold: 2, cooldownMs: 100, halfOpenLeaseMs: 20 })
    expect(opened.cooldown_until).toBe(102)
    expect((await acquireProviderCircuit(db, 'gemini', 50, { halfOpenLeaseMs: 20 })).permission).toBe('open')
    const halfOpen = await acquireProviderCircuit(db, 'gemini', 102, { halfOpenLeaseMs: 20 })
    expect(halfOpen.permission).toBe('half-open')
    expect((await acquireProviderCircuit(db, 'gemini', 102, { halfOpenLeaseMs: 20 })).permission).toBe('open')
    await recordProviderSuccess(db, 'gemini', 103, halfOpen.leaseId)
    expect((await acquireProviderCircuit(db, 'gemini', 103)).permission).toBe('closed')
    sqlite.close()
  })

  it('no limpia un circuito abierto por un éxito tardío sin lease', async () => {
    const { sqlite, db } = fixture()
    await recordProviderFailure(db, 'gemini', 1, 0, { failureThreshold: 1, cooldownMs: 100 })
    await recordProviderSuccess(db, 'gemini', 2)
    expect(sqlite.prepare("SELECT consecutive_failures, opened_at, cooldown_until FROM provider_circuit_state WHERE provider='gemini'").get()).toEqual({ consecutive_failures: 1, opened_at: 1, cooldown_until: 101 })
    sqlite.close()
  })

  it('ignora fallos y éxitos tardíos sin el lease vigente o con un lease distinto', async () => {
    const { sqlite, db } = fixture()
    await recordProviderFailure(db, 'gemini', 1, 0, { failureThreshold: 1, cooldownMs: 10, halfOpenLeaseMs: 20 })
    const lease = await acquireProviderCircuit(db, 'gemini', 11, { halfOpenLeaseMs: 20 })
    expect(lease.permission).toBe('half-open')
    await recordProviderFailure(db, 'gemini', 12, 1000, { failureThreshold: 1, cooldownMs: 10, halfOpenLeaseMs: 20 }, 'stale-lease')
    const afterStaleFailure = sqlite.prepare('SELECT consecutive_failures, cooldown_until, half_open_lease_id FROM provider_circuit_state WHERE provider = \'gemini\'').get()
    expect(afterStaleFailure).toEqual({ consecutive_failures: 1, cooldown_until: 11, half_open_lease_id: lease.leaseId })
    await recordProviderSuccess(db, 'gemini', 13, 'stale-lease')
    const afterStaleSuccess = sqlite.prepare('SELECT consecutive_failures, cooldown_until, half_open_lease_id FROM provider_circuit_state WHERE provider = \'gemini\'').get()
    expect(afterStaleSuccess).toEqual(afterStaleFailure)
    await recordProviderSuccess(db, 'gemini', 14, lease.leaseId)
    await recordProviderFailure(db, 'gemini', 15, 1000, { failureThreshold: 1, cooldownMs: 10, halfOpenLeaseMs: 20 }, lease.leaseId)
    const afterLateResult = sqlite.prepare('SELECT consecutive_failures, cooldown_until, half_open_lease_id FROM provider_circuit_state WHERE provider = \'gemini\'').get()
    expect(afterLateResult).toEqual({ consecutive_failures: 0, cooldown_until: 0, half_open_lease_id: null })
    sqlite.close()
  })

  it('abre por Retry-After aunque no haya alcanzado el umbral', async () => {
    const { db } = fixture()
    const state = await recordProviderFailure(db, 'nvidia', 1_000, 10_000, { failureThreshold: 3, cooldownMs: 100 })
    expect(state.opened_at).toBe(1_000)
    expect(state.cooldown_until).toBe(11_000)
  })

  it('abre por Retry-After y limpia el lease half-open sólo con el CAS correspondiente', async () => {
    const { sqlite, db } = fixture()
    await recordProviderFailure(db, 'nvidia', 1_000, 0, { failureThreshold: 1, cooldownMs: 100, halfOpenLeaseMs: 20 })
    const lease = await acquireProviderCircuit(db, 'nvidia', 1_100, { halfOpenLeaseMs: 20 })
    expect(lease.permission).toBe('half-open')
    await openProviderCircuitUntil(db, 'nvidia', 1_101, 5_000, 'stale-lease')
    expect(sqlite.prepare("SELECT half_open_lease_id, cooldown_until FROM provider_circuit_state WHERE provider='nvidia'").get()).toEqual({ half_open_lease_id: lease.leaseId, cooldown_until: 1_100 })
    await openProviderCircuitUntil(db, 'nvidia', 1_101, 5_000, lease.leaseId)
    expect(sqlite.prepare("SELECT half_open_lease_id, cooldown_until FROM provider_circuit_state WHERE provider='nvidia'").get()).toEqual({ half_open_lease_id: null, cooldown_until: 6_101 })
    sqlite.close()
  })
})
