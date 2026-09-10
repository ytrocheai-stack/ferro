import { describe, expect, it } from 'vitest'
import { handleRequest, type D1Database, type Env, type WorkflowBinding } from './index'

function requestBody() {
  return {
    event: { id: 'event-1', accountId: 'user_1', deviceId: 'device-1', conversationId: 'conversation-1', type: 'message-sent', occurredAt: 1_700_000_000_000, contextVersion: 'ctx-1', payload: { message: 'Revisa mi próxima sesión' } },
    context: { version: 'ctx-1', capturedAt: 1_700_000_000_000, timezone: 'America/Mexico_City', isCurrent: true, snapshot: { goals: [], restrictions: [] } },
  }
}

function fakeDb() {
  const rows = new Map<string, Record<string, unknown>>()
  const db: D1Database = {
    prepare(sql: string) {
      let values: unknown[] = []
      const statement = {
        bind(...bound: unknown[]) { values = bound; return statement },
        async first<T = Record<string, unknown>>() {
          if (sql.includes('SELECT id FROM coach_runs')) {
            const row = [...rows.values()].find((item) => item.account_hash === values[0] && ['queued', 'running'].includes(String(item.status)))
            return (row ? { id: row.id } : null) as T | null
          }
          if (sql.includes('WHERE event_id = ? AND account_hash = ? AND conversation_id = ?')) {
            const row = [...rows.values()].find((item) => item.event_id === values[0] && item.account_hash === values[1] && item.conversation_id === values[2])
            return (row ? { status: row.status, request_json: row.request_json, decision_json: row.decision_json } : null) as T | null
          }
          if (sql.includes('SELECT status FROM coach_runs')) return (rows.get(String(values[0])) ?? null) as T | null
          if (sql.includes('SELECT * FROM coach_runs')) {
            const row = [...rows.values()].find((item) => item.id === values[0] && (!sql.includes('account_hash') || item.account_hash === values[1]))
            return (row ?? null) as T | null
          }
          return null
        },
        async all<T = Record<string, unknown>>() { return { results: [] as T[] } },
        async run() {
          if (sql.includes('INSERT INTO coach_runs')) {
            const [id, accountHash, eventId, conversationId, contextVersion, requestHash, idempotencyKey, requestJson, createdAt, updatedAt] = values
            rows.set(String(id), { id, account_hash: accountHash, event_id: eventId, conversation_id: conversationId, context_version: contextVersion, request_hash: requestHash, idempotency_key: idempotencyKey, status: 'queued', request_json: requestJson, created_at: createdAt, updated_at: updatedAt })
          } else if (sql.includes("SET status = 'cancelled'")) {
            const row = rows.get(String(values[2])); if (row) { row.status = 'cancelled'; row.error_code = 'cancelled'; row.ended_at = values[0]; row.updated_at = values[1]; row.workflow_status = 'terminated' }
          }
          return { success: true, meta: { changes: 1 } }
        },
      }
      return statement
    },
    async batch() { return [] },
  }
  return { db, rows }
}

const authHeaders = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'event-1', 'X-NextRep-Consent-Version': 'coach-context-v2', 'X-NextRep-Device-Id': 'device-1' }

describe('private coach runs', () => {
  it('creates a durable run, rejects a second active run, reads it, and cancels it', async () => {
    const { db } = fakeDb()
    let created = ''
    let terminated = 0
    const workflow: WorkflowBinding = { create: async ({ id }) => { created = id; return { id } }, get: () => ({ terminate: async () => { terminated++ } }) }
    const env: Env = { CLERK_JWT_KEY: 'jwt', PSEUDONYMIZATION_KEY: 'pseudo', ALLOWED_CLERK_IDS: 'user_1', ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-context-v2', DB: db, COACH_WORKFLOW: workflow }
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 }
    const first = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: authHeaders, body: JSON.stringify(requestBody()) }), env, deps)
    expect(first.status).toBe(202)
    const firstBody = await first.json() as { run: { id: string; status: string; accountId: string } }
    expect(firstBody.run.status).toBe('queued')
    expect(firstBody.run.accountId).toBe('user_1')
    expect(created).toBe(firstBody.run.id)

    const duplicate = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: { ...authHeaders, 'Idempotency-Key': 'other-key' }, body: JSON.stringify({ ...requestBody(), event: { ...requestBody().event, id: 'event-2' } }) }), env, deps)
    expect(duplicate.status).toBe(409)

    const read = await handleRequest(new Request(`https://worker.test/v1/coach/runs/${encodeURIComponent(firstBody.run.id)}`, { headers: authHeaders }), env, deps)
    expect(read.status).toBe(200)
    expect((await read.json() as { run: { id: string } }).run.id).toBe(firstBody.run.id)

    const cancel = await handleRequest(new Request(`https://worker.test/v1/coach/runs/${encodeURIComponent(firstBody.run.id)}/cancel`, { method: 'POST', headers: authHeaders, body: '{}' }), env, deps)
    expect(cancel.status).toBe(200)
    expect((await cancel.json() as { run: { status: string } }).run.status).toBe('cancelled')
    expect(terminated).toBe(1)
  })

  it('does not continue a completed turn from another conversation', async () => {
    const { db, rows } = fakeDb()
    const workflow: WorkflowBinding = { create: async ({ id }) => ({ id }), get: () => ({ terminate: async () => undefined }) }
    const env: Env = { CLERK_JWT_KEY: 'jwt', PSEUDONYMIZATION_KEY: 'pseudo', ALLOWED_CLERK_IDS: 'user_1', ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-context-v2', DB: db, COACH_WORKFLOW: workflow }
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 }
    const first = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: authHeaders, body: JSON.stringify(requestBody()) }), env, deps)
    expect(first.status).toBe(202)
    const firstRow = [...rows.values()][0]
    firstRow!.status = 'completed'
    firstRow!.decision_json = JSON.stringify({ kind: 'ask', explanation: 'Pregunta', observations: [], evidence: [], questions: ['¿Qué equipo tienes?'] })
    const continuation = { ...requestBody(), event: { ...requestBody().event, id: 'event-2', causedByEventId: 'event-1', conversationId: 'conversation-2' } }
    const response = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: { ...authHeaders, 'Idempotency-Key': 'event-2' }, body: JSON.stringify(continuation) }), env, deps)
    expect(response.status).toBe(409)
  })
})
