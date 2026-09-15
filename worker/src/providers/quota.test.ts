import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { D1Database, D1Statement } from '../index'
import { deferNvidiaRequest, estimateGeminiInputTokens, geminiPacificDayKey, parseGeminiPromptTokenCount, reconcileGeminiInputTokens, reserveGeminiRequest, reserveNvidiaRequest, waitForNvidiaRequest } from './quota'
import { acquireProviderCircuit, recordProviderFailure, recordProviderSuccess } from './circuit'

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
    sqlite.close()
  })

  it('reserva NVIDIA globalmente, ignora max_requests y conserva 1.500 ms a 40 RPM', async () => {
    const { sqlite, db } = fixture()
    sqlite.exec("INSERT INTO provider_request_limits(provider,next_allowed_at,used_requests,max_requests) VALUES ('nvidia',0,4499,1)")
    const first = await reserveNvidiaRequest(db, 1_700_000_000_000, 40)
    expect(first.reserved).toBe(true)
    expect((await reserveNvidiaRequest(db, 1_700_000_000_000 + 1_499, 40)).reserved).toBe(false)
    expect((await reserveNvidiaRequest(db, 1_700_000_000_000 + 1_500, 40)).reserved).toBe(true)
    expect(sqlite.prepare("SELECT used_requests, max_requests FROM provider_request_limits WHERE provider = 'nvidia'").get()).toEqual({ used_requests: 4501, max_requests: 1 })
    sqlite.close()
  })

  it('coordina dos isolates concurrentes y respeta Retry-After sin devolver una reserva', async () => {
    const { sqlite, db } = fixture()
    sqlite.exec("INSERT INTO provider_request_limits(provider,next_allowed_at,used_requests,max_requests) VALUES ('nvidia',0,0,0)")
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
  })

  it('reserva RPM, TPM y RPD Gemini con ventanas atómicas y día del Pacífico', async () => {
    const { sqlite, db } = fixture()
    const limits = { requestsPerMinute: 2, inputTokensPerMinute: 100, requestsPerDay: 2 }
    const now = Date.parse('2026-01-15T06:59:00.000Z')
    expect(geminiPacificDayKey(now)).toBe('2026-01-14')
    const first = await reserveGeminiRequest(db, now, 60, limits)
    expect(first.reserved).toBe(true)
    expect((await reserveGeminiRequest(db, now, 41, limits)).reserved).toBe(false)
    expect((await reserveGeminiRequest(db, now + 60_000, 40, limits)).reserved).toBe(true)
    expect((await reserveGeminiRequest(db, now + 120_000, 1, limits)).reserved).toBe(false)
    // 08:01Z is midnight in Los Angeles for this winter date: RPD resets.
    const nextPacificDay = Date.parse('2026-01-15T08:01:00.000Z')
    expect(geminiPacificDayKey(nextPacificDay)).toBe('2026-01-15')
    expect((await reserveGeminiRequest(db, nextPacificDay, 1, limits)).reserved).toBe(true)
    expect(sqlite.prepare('SELECT minute_requests, minute_input_tokens, day_requests FROM gemini_quota_state').get()).toEqual({ minute_requests: 1, minute_input_tokens: 1, day_requests: 1 })
    sqlite.close()
  })

  it('estima de forma conservadora y reconcilia usageMetadata sin countTokens', async () => {
    const { sqlite, db } = fixture()
    const estimate = estimateGeminiInputTokens('fuerza 💪 y recuperación')
    expect(estimate).toBeGreaterThan(0)
    expect(parseGeminiPromptTokenCount({ promptTokenCount: 23 })).toBe(23)
    expect(parseGeminiPromptTokenCount({ promptTokenCount: -1 })).toBeUndefined()
    const reservation = await reserveGeminiRequest(db, 10_000, estimate, { requestsPerMinute: 10, inputTokensPerMinute: 100, requestsPerDay: 10 })
    const missing = await reconcileGeminiInputTokens(db, reservation, undefined, 10_001)
    expect(missing).toEqual({ inputTokens: estimate, estimated: true })
    const measuredReservation = await reserveGeminiRequest(db, 70_000, 20, { requestsPerMinute: 10, inputTokensPerMinute: 100, requestsPerDay: 10 })
    expect(await reconcileGeminiInputTokens(db, measuredReservation, { promptTokenCount: 5 }, 70_001)).toEqual({ inputTokens: 5, estimated: false })
    expect(sqlite.prepare('SELECT input_tokens_estimated, input_tokens_measured, usage_incomplete FROM gemini_quota_state').get()).toEqual({ input_tokens_estimated: estimate + 20, input_tokens_measured: 5, usage_incomplete: 1 })
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

  it('abre por Retry-After aunque no haya alcanzado el umbral', async () => {
    const { db } = fixture()
    const state = await recordProviderFailure(db, 'nvidia', 1_000, 10_000, { failureThreshold: 3, cooldownMs: 100 })
    expect(state.opened_at).toBe(1_000)
    expect(state.cooldown_until).toBe(11_000)
  })
})
