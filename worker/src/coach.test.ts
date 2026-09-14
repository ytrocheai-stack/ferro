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
  const snapshots: Record<string, unknown>[] = []
  const db: D1Database = {
    prepare(sql: string) {
      let values: unknown[] = []
      const statement = {
        bind(...bound: unknown[]) { values = bound; return statement },
        async first<T = Record<string, unknown>>() {
          if (sql.includes('FROM coach_run_snapshots')) return (snapshots.filter((item) => item.run_id === values[0]).sort((a, b) => Number(b.sequence) - Number(a.sequence))[0] ?? null) as T | null
          if (sql.includes('SELECT status, decision_json, error_code FROM coach_runs')) return (rows.get(String(values[0]) as string) ?? null) as T | null
          if (sql.includes('SELECT id FROM coach_runs WHERE id = ?')) {
            const row = [...rows.values()].find((item) => item.id === values[0] && item.account_hash === values[1])
            return (row ? { id: row.id } : null) as T | null
          }
          if (sql.includes('WHERE event_id = ? AND account_hash = ? AND conversation_id = ?')) {
            const row = [...rows.values()].find((item) => item.event_id === values[0] && item.account_hash === values[1] && item.conversation_id === values[2])
            return (row ? { status: row.status, request_json: row.request_json, decision_json: row.decision_json } : null) as T | null
          }
          if (sql.includes('WHERE event_id = ? AND account_hash = ?')) {
            const row = [...rows.values()].find((item) => item.event_id === values[0] && item.account_hash === values[1])
            return (row ?? null) as T | null
          }
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
        async all<T = Record<string, unknown>>() {
          if (sql.includes('FROM coach_run_snapshots')) return { results: snapshots.filter((item) => item.run_id === values[0] && Number(item.sequence) > Number(values[1])).sort((a, b) => Number(a.sequence) - Number(b.sequence)) as T[] }
          if (sql.includes('FROM coach_runs WHERE account_hash = ?')) return { results: [...rows.values()].filter((item) => item.account_hash === values[0] && ['queued', 'running'].includes(String(item.status)) && Number(item.created_at) + 600_000 <= Number(values[2])).map((item) => ({ id: item.id })) as T[] }
          return { results: [] as T[] }
        },
        async run() {
          if (sql.includes('INSERT INTO coach_runs')) {
            const [id, accountHash, eventId, conversationId, contextVersion, requestHash, idempotencyKey, requestJson, createdAt, updatedAt] = values
            rows.set(String(id), { id, account_hash: accountHash, event_id: eventId, conversation_id: conversationId, context_version: contextVersion, request_hash: requestHash, idempotency_key: idempotencyKey, status: 'queued', request_json: requestJson, created_at: createdAt, updated_at: updatedAt })
          } else if (sql.includes('INSERT INTO coach_run_snapshots')) {
            const [runId, sequence, text, status, decisionJson, errorCode, createdAt] = values
            snapshots.push({ run_id: runId, sequence, text, status, decision_json: decisionJson, error_code: errorCode, created_at: createdAt })
          } else if (sql.includes("SET status = 'cancelled'")) {
            const row = rows.get(String(values[2])); if (row) { row.status = 'cancelled'; row.error_code = 'cancelled'; row.ended_at = values[0]; row.updated_at = values[1]; row.workflow_status = 'terminated' }
          } else if (sql.includes("SET status = 'failed'")) {
            const row = rows.get(String(values[2])); if (row && ['queued', 'running'].includes(String(row.status))) { row.status = 'failed'; row.error_code = 'coach-global-deadline-exceeded'; row.ended_at = values[0]; row.updated_at = values[1]; row.workflow_status = 'errored' }
          }
          return { success: true, meta: { changes: 1 } }
        },
      }
      return statement
    },
    async batch() { return [] },
  }
  return { db, rows, snapshots }
}

const authHeaders = { Origin: 'https://ytrocheai-stack.github.io', Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': 'event-1', 'X-NextRep-Consent-Version': 'coach-context-v2', 'X-NextRep-Device-Id': 'device-1' }

describe('private coach runs', () => {
  it('requires the strict transport projection and enforces conversation limits', async () => {
    const { db, rows } = fakeDb()
    const workflow: WorkflowBinding = { create: async ({ id }) => ({ id }), get: () => ({ terminate: async () => undefined }) }
    const env: Env = { CLERK_JWT_KEY: 'jwt', PSEUDONYMIZATION_KEY: 'pseudo', ALLOWED_CLERK_IDS: 'user_1', ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-context-v2', DB: db, COACH_WORKFLOW: workflow }
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 }
    const message = { id: 'message-1', role: 'user' as const, content: 'Hola', runId: 'run-1', createdAt: 1_700_000_000_000, contextVersion: 'ctx-1' }
    const withOwnerId = { ...requestBody(), context: { ...requestBody().context, snapshot: { ...requestBody().context.snapshot, conversation: [{ ...message, ownerId: 'user_1' }] } } }
    const ownerLeak = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: authHeaders, body: JSON.stringify(withOwnerId) }), env, deps)
    expect(ownerLeak.status).toBe(400)
    expect(rows.size).toBe(0)

    const tooMany = { ...requestBody(), event: { ...requestBody().event, id: 'event-too-many' }, context: { ...requestBody().context, snapshot: { ...requestBody().context.snapshot, conversation: Array.from({ length: 101 }, (_, index) => ({ ...message, id: `message-${index}`, createdAt: index })) } } }
    const response = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: { ...authHeaders, 'Idempotency-Key': 'event-too-many' }, body: JSON.stringify(tooMany) }), env, deps)
    expect(response.status).toBe(400)
    expect(rows.size).toBe(0)
  })

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

  it('reads a run by event only inside the authenticated account', async () => {
    const { db, rows } = fakeDb()
    const workflow: WorkflowBinding = { create: async ({ id }) => ({ id }), get: () => ({ terminate: async () => undefined }) }
    const env: Env = { CLERK_JWT_KEY: 'jwt', PSEUDONYMIZATION_KEY: 'pseudo', ALLOWED_CLERK_IDS: 'user_1', ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-context-v2', DB: db, COACH_WORKFLOW: workflow }
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 }
    const created = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: authHeaders, body: JSON.stringify(requestBody()) }), env, deps)
    expect(created.status).toBe(202)
    const found = await handleRequest(new Request('https://worker.test/v1/coach/runs/by-event/event-1', { headers: authHeaders }), env, deps)
    expect(found.status).toBe(200)
    expect((await found.json() as { run: { eventId: string; accountId: string } }).run).toMatchObject({ eventId: 'event-1', accountId: 'user_1' })
    rows.values().next().value!.account_hash = 'other-account'
    const hidden = await handleRequest(new Request('https://worker.test/v1/coach/runs/by-event/event-1', { headers: authHeaders }), env, deps)
    expect(hidden.status).toBe(404)
  })

  it('streams only owned snapshots and resumes strictly after Last-Event-ID', async () => {
    const { db, rows, snapshots } = fakeDb()
    const workflow: WorkflowBinding = { create: async ({ id }) => ({ id }), get: () => ({ terminate: async () => undefined }) }
    const env: Env = { CLERK_JWT_KEY: 'jwt', PSEUDONYMIZATION_KEY: 'pseudo', ALLOWED_CLERK_IDS: 'user_1', ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-context-v2', DB: db, COACH_WORKFLOW: workflow }
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 }
    const created = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: authHeaders, body: JSON.stringify(requestBody()) }), env, deps)
    const id = (await created.json() as { run: { id: string } }).run.id
    snapshots.push({ run_id: id, sequence: 1, text: 'parcial', status: 'running', created_at: 10 })
    const liveDeps = { ...deps, sleep: async () => { if (!snapshots.some((item) => item.sequence === 2)) snapshots.push({ run_id: id, sequence: 2, text: 'final', status: 'completed', decision_json: JSON.stringify({ kind: 'maintain', explanation: 'final', observations: [], evidence: [] }), created_at: 20 }) } }
    const resumed = await handleRequest(new Request(`https://worker.test/v1/coach/runs/${id}/events`, { headers: { ...authHeaders, 'Last-Event-ID': '1' } }), env, liveDeps)
    expect(resumed.status).toBe(200)
    expect(resumed.headers.get('Content-Type')).toContain('text/event-stream')
    const body = await resumed.text()
    expect(body).toContain('id: 2')
    expect(body).not.toContain('id: 1')
    rows.get(id)!.account_hash = 'other-account'
    expect((await handleRequest(new Request(`https://worker.test/v1/coach/runs/${id}/events`, { headers: authHeaders }), env, deps)).status).toBe(404)
  })

  it('closes a quiet SSE connection after the bounded window and emits heartbeat', async () => {
    const { db } = fakeDb()
    const workflow: WorkflowBinding = { create: async ({ id }) => ({ id }), get: () => ({ terminate: async () => undefined }) }
    const env: Env = { CLERK_JWT_KEY: 'jwt', PSEUDONYMIZATION_KEY: 'pseudo', ALLOWED_CLERK_IDS: 'user_1', ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-context-v2', DB: db, COACH_WORKFLOW: workflow }
    let now = 0
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => now, sleep: async () => { now += 500 } }
    const created = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: authHeaders, body: JSON.stringify(requestBody()) }), env, deps)
    const id = (await created.json() as { run: { id: string } }).run.id
    const response = await handleRequest(new Request(`https://worker.test/v1/coach/runs/${id}/events`, { headers: authHeaders }), env, deps)
    const body = await response.text()
    expect(body).toContain(': heartbeat')
    expect(body).toContain(': timeout')
  })

  it('reconciles an expired run before events and replays its failed terminal snapshot', async () => {
    const { db, rows, snapshots } = fakeDb()
    const workflow: WorkflowBinding = { create: async ({ id }) => ({ id }), get: () => ({ terminate: async () => undefined }) }
    const env: Env = { CLERK_JWT_KEY: 'jwt', PSEUDONYMIZATION_KEY: 'pseudo', ALLOWED_CLERK_IDS: 'user_1', ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-context-v2', DB: db, COACH_WORKFLOW: workflow }
    let now = 1_700_000_000_000
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => now }
    const created = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: authHeaders, body: JSON.stringify(requestBody()) }), env, deps)
    const id = (await created.json() as { run: { id: string } }).run.id
    now += 600_001
    const response = await handleRequest(new Request(`https://worker.test/v1/coach/runs/${id}/events`, { headers: authHeaders }), env, deps)
    const body = await response.text()
    expect(body).toContain('"status":"failed"')
    expect(body).toContain('coach-global-deadline-exceeded')
    expect(rows.get(id)?.status).toBe('failed')
    expect(snapshots.at(-1)).toMatchObject({ run_id: id, status: 'failed' })
  })

  it('cancels durably with a cancelled terminal snapshot and does not rewrite it as failed', async () => {
    const { db, rows, snapshots } = fakeDb()
    const workflow: WorkflowBinding = { create: async ({ id }) => ({ id }), get: () => ({ terminate: async () => undefined }) }
    const env: Env = { CLERK_JWT_KEY: 'jwt', PSEUDONYMIZATION_KEY: 'pseudo', ALLOWED_CLERK_IDS: 'user_1', ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-context-v2', DB: db, COACH_WORKFLOW: workflow }
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 }
    const created = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: authHeaders, body: JSON.stringify(requestBody()) }), env, deps)
    const id = (await created.json() as { run: { id: string } }).run.id
    rows.get(id)!.status = 'running'
    const cancelled = await handleRequest(new Request(`https://worker.test/v1/coach/runs/${id}/cancel`, { method: 'POST', headers: authHeaders, body: '{}' }), env, deps)
    expect((await cancelled.json() as { run: { status: string } }).run.status).toBe('cancelled')
    expect(snapshots.at(-1)).toMatchObject({ run_id: id, status: 'cancelled', error_code: 'cancelled' })
    expect(snapshots.some((snapshot) => snapshot.status === 'failed')).toBe(false)
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

  it('continues a completed turn only inside the same conversation', async () => {
    const { db, rows } = fakeDb()
    const workflow: WorkflowBinding = { create: async ({ id }) => ({ id }), get: () => ({ terminate: async () => undefined }) }
    const env: Env = { CLERK_JWT_KEY: 'jwt', PSEUDONYMIZATION_KEY: 'pseudo', ALLOWED_CLERK_IDS: 'user_1', ENABLE_BETA: 'true', REQUIRED_CONSENT_VERSION: 'coach-context-v2', DB: db, COACH_WORKFLOW: workflow }
    const deps = { verify: async () => ({ sub: 'user_1' }), now: () => 1_700_000_000_000 }
    const first = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: authHeaders, body: JSON.stringify(requestBody()) }), env, deps)
    expect(first.status).toBe(202)
    const firstRow = [...rows.values()][0]
    firstRow!.status = 'completed'
    firstRow!.decision_json = JSON.stringify({ kind: 'ask', explanation: 'Pregunta', observations: [], evidence: [], questions: ['¿Qué equipo tienes?'] })

    const continuation = { ...requestBody(), event: { ...requestBody().event, id: 'event-2', causedByEventId: 'event-1' } }
    const response = await handleRequest(new Request('https://worker.test/v1/coach/runs', { method: 'POST', headers: { ...authHeaders, 'Idempotency-Key': 'event-2' }, body: JSON.stringify(continuation) }), env, deps)
    expect(response.status).toBe(202)
    expect(rows.size).toBe(2)
  })
})
