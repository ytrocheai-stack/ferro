import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db, FerroDB } from '../db/db'
import { setCoachAccountId } from './coachAccount'
import { applyCoachChangeSet, boundConversation, buildCoachRequest, cancelCoachRun, contextVersionFromSnapshot, fetchCoach, normalizeCoachRequestForTransport, queueCoachSessionFinished, refreshCoachRun, retryCoachRun, startCoachRun, syncPendingCoachRuns } from './coachClient'
import { grantCoachConsent, getSelectedCoachConversation } from './coachConsent'
import type { CoachRunRecord, Routine } from '../db/types'
import { coachRunRequestSchema, type CoachRunRequest, type CoachRunResponse } from '../../packages/adaptation-core/src/contract'

const accountId = 'user_coach_apply_test'
const routineId = 'routine-coach-test'
const contextVersion = `coach-context-${routineId}:1`

describe('coach submission failures', () => {
  beforeEach(async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    setCoachAccountId(accountId)
    vi.stubEnv('VITE_ADAPTATION_WORKER_URL', 'https://coach.example')
    await grantCoachConsent(accountId)
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await db.coachRuns.clear()
    await db.coachMessages.clear()
    await db.coachConsents.clear()
    setCoachAccountId(null)
  })
  it('shows a confirmed rejection without treating it as an uncertain dispatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'La beta del coach está cerrada' }), { status: 403 })))
    const result = await startCoachRun(async () => 'test-token', 'Hola')
    expect(result.status).toBe('failed')
    expect(result.error).toBe('La beta del coach está cerrada')
  })

  it.each([[401, 'coach-auth-required'], [409, 'coach-conflict'], [429, 'provider-rate-limited'], [500, 'server-error']] as const)('keeps HTTP %s visible as %s', async (status, error) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))
    const result = await startCoachRun(async () => 'test-token', 'Hola')
    expect(result).toMatchObject({ status: 'failed', error })
  })
  it('preserves uncertain outcome on a lost response so a new request is not sent automatically', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')))
    const result = await startCoachRun(async () => 'test-token', 'Hola')
    expect(result.error).toBe('unknown-outcome')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(`https://coach.example/v1/coach/runs/by-event/${encodeURIComponent(result.eventId)}`)
  })

  it('consults the original event before exposing an uncertain outcome', async () => {
    let original: CoachRunRequest | undefined
    const request = vi.fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => { original = JSON.parse(String(init.body)) as CoachRunRequest; throw new TypeError('Network error') })
      .mockImplementationOnce(async () => new Response(JSON.stringify({ run: { id: 'remote-found', eventId: original!.event.id, accountId, contextVersion: original!.context.version, specialists: ['orchestrator'], status: 'completed', endedAt: 20 }, decision: { kind: 'maintain', explanation: 'Listo', observations: [], evidence: [] } }), { status: 200 }))
    vi.stubGlobal('fetch', request)
    const result = await startCoachRun(async () => 'test-token', 'Hola')
    expect(result.status).toBe('completed')
    expect(result.remoteRunId).toBe('remote-found')
    expect(request.mock.calls[1]?.[0]).toBe(`https://coach.example/v1/coach/runs/by-event/${encodeURIComponent(result.eventId)}`)
  })

  it('persists cancellation while offline and reconciles a late completed response', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const initial = await startCoachRun(async () => 'test-token', 'Hola')
    await cancelCoachRun(async () => 'test-token', initial.id)
    expect(await db.coachRuns.get(initial.id)).toMatchObject({ status: 'queued', error: 'cancellation-pending', cancelRequestedAt: expect.any(Number) })
    await db.coachRuns.update(initial.id, { remoteRunId: 'remote-late' })
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ run: { id: 'remote-late', eventId: initial.eventId, accountId, contextVersion: initial.contextVersion, specialists: ['orchestrator'], status: 'completed', endedAt: 20 }, decision: { kind: 'maintain', explanation: 'Terminó', observations: [], evidence: [] } }), { status: 200 })))
    const reconciled = await refreshCoachRun(async () => 'test-token', initial.id)
    expect(reconciled).toMatchObject({ status: 'completed', remoteRunId: 'remote-late' })
  })

  it.each([[401, 'coach-auth-required'], [403, 'coach-forbidden'], [409, 'coach-conflict'], [429, 'provider-rate-limited'], [500, 'server-error']] as const)('persists refresh HTTP %s as %s without deleting the previous response', async (status, error) => {
    const local = await startCoachRun(async () => null, 'Hola')
    const previous = responseFor(local.request).decision
    await db.coachRuns.update(local.id, { remoteRunId: `remote-${local.eventId}`, status: 'running', decision: previous })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))
    const recovered = await refreshCoachRun(async () => 'test-token', local.id)
    expect(recovered).toMatchObject({ status: 'running', error, decision: previous })
    expect(await db.coachRuns.get(local.id)).toMatchObject({ status: 'running', error, decision: previous })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('persists a refresh timeout without deleting the previous response', async () => {
    const local = await startCoachRun(async () => null, 'Hola')
    const previous = responseFor(local.request).decision
    await db.coachRuns.update(local.id, { remoteRunId: `remote-${local.eventId}`, status: 'running', decision: previous })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal
      return new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError'))))
    }))
    const refreshing = refreshCoachRun(async () => 'test-token', local.id)
    const result = expect(refreshing).resolves.toMatchObject({ status: 'running', error: 'coach-call-timeout', decision: previous })
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expect(signal?.aborted).toBe(true)
    expect(await db.coachRuns.get(local.id)).toMatchObject({ status: 'running', error: 'coach-call-timeout', decision: previous })
    vi.useRealTimers()
  })

  it('keeps a persisted cancellation failure visible and retryable', async () => {
    const local = await startCoachRun(async () => null, 'Hola')
    await db.coachRuns.update(local.id, { remoteRunId: `remote-${local.eventId}`, status: 'running' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
    await expect(cancelCoachRun(async () => 'test-token', local.id)).rejects.toThrow('provider-rate-limited')
    expect(await db.coachRuns.get(local.id)).toMatchObject({ status: 'running', error: 'cancellation-pending', lastError: 'provider-rate-limited', cancelRequestedAt: expect.any(Number) })
  })

  it('uses a 30 second abort signal and keeps timeout recoverable', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal
      return new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError'))))
    }))
    const pending = fetchCoach('https://coach.example/timeout', {}, 30_000)
    const rejection = expect(pending).rejects.toThrow('coach-call-timeout')
    await vi.advanceTimersByTimeAsync(30_000)
    await rejection
    expect(signal?.aborted).toBe(true)
    vi.useRealTimers()
  })
  it('an explicit retry does not require the uncertain run to be a completed conversation turn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')))
    const initial = await startCoachRun(async () => 'test-token', 'Hola')
    const retry = await retryCoachRun(async () => 'test-token', initial.id)
    expect(retry.eventId).toBe(initial.eventId)
    expect(retry.request.event.causedByEventId).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('projects the strict transport contract and bounds old conversation history', async () => {
    const selectedConversation = await getSelectedCoachConversation(accountId)
    await db.coachMessages.bulkPut(Array.from({ length: 105 }, (_, index) => ({
      id: `old-${index}`, ownerId: accountId, runId: `run-${index}`, role: index % 2 ? 'assistant' as const : 'user' as const,
      conversationId: selectedConversation.id, content: 'x'.repeat(300), createdAt: index, contextVersion: `ctx-${index}`,
    })))
    const built = await buildCoachRequest('Primer mensaje')
    expect(built).not.toBeNull()
    const request = built!
    const conversation = request.context.snapshot.conversation
    expect(conversation).toHaveLength(100)
    expect(conversation[0]).not.toHaveProperty('ownerId')
    expect(Math.max(...conversation.map((message) => message.content.length))).toBeLessThanOrEqual(4_000)
    expect(conversation.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(36_000)
    expect(() => coachRunRequestSchema.parse(request)).not.toThrow()
    const capped = boundConversation(Array.from({ length: 105 }, (_, index) => ({ id: `cap-${index}`, ownerId: accountId, runId: `cap-run-${index}`, role: 'user' as const, content: 'y'.repeat(400), createdAt: index, contextVersion: 'ctx' })))
    expect(capped.reduce((total, message) => total + message.content.length, 0)).toBe(36_000)
    expect(await db.coachMessages.count()).toBe(105)
    const oversized = boundConversation([{ id: 'large', ownerId: accountId, runId: 'large', role: 'user', content: 'z'.repeat(5_000), createdAt: 0, contextVersion: 'ctx' }])
    expect(oversized[0].content).toHaveLength(4_000)

    const legacy = structuredClone(request)
    legacy.context.snapshot.conversation = legacy.context.snapshot.conversation.map((message) => ({ ...message, ownerId: accountId }))
    const normalized = normalizeCoachRequestForTransport(legacy)
    expect(normalized.event.id).toBe(request!.event.id)
    expect(normalized.context.snapshot.conversation).toHaveLength(0)
    expect(() => coachRunRequestSchema.parse(normalized)).not.toThrow()
  })

  it('rejects an invalid new message before persisting it and allows the next valid message', async () => {
    await expect(startCoachRun(async () => 'test-token', 'x'.repeat(4_001))).rejects.toThrow('4000')
    expect(await db.coachMessages.count()).toBe(0)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'La beta del coach está cerrada' }), { status: 403 })))
    const result = await startCoachRun(async () => 'test-token', 'Siguiente mensaje válido')
    expect(result.status).toBe('failed')
    expect(await db.coachMessages.count()).toBe(1)
  })

  it('enqueues one durable coach review per finished workout', async () => {
    await queueCoachSessionFinished('workout-once')
    await queueCoachSessionFinished('workout-once')
    expect(await db.coachRuns.count()).toBe(1)
    const run = await db.coachRuns.toCollection().first()
    expect(run?.request.event.id).toBe('coach-session-finished-workout-once')
    expect(run?.request.event.type).toBe('session-finished')
  })
})

function responseFor(request: CoachRunRequest, status: CoachRunRecord['status'] = 'completed'): CoachRunResponse {
  return {
    run: { id: `remote-${request.event.id}`, eventId: request.event.id, accountId, contextVersion: request.context.version, status, specialists: ['orchestrator'], startedAt: 10, ...(status === 'completed' ? { endedAt: 20 } : {}) },
    ...(status === 'completed' ? { decision: { kind: 'ask' as const, explanation: 'Necesito conocer tu equipo.', questions: ['¿Tienes barra?', '¿Tienes discos?'], observations: [], evidence: [] } } : {}),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('coach IndexedDB persistence and reconciliation', () => {
  const connections: FerroDB[] = []
  beforeEach(async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    vi.stubEnv('VITE_ADAPTATION_WORKER_URL', 'https://coach.example')
    setCoachAccountId(accountId)
    await grantCoachConsent(accountId)
  })
  afterEach(async () => {
    for (const connection of connections.splice(0)) connection.close()
    await db.coachRuns.clear()
    await db.coachMessages.clear()
    await db.coachConsents.clear()
    setCoachAccountId(null)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  // Cada grafo de módulos usa su conexión y su bloqueo JS de sincronización.
  // Ambas pestañas comparten el planificador de transacciones de IndexedDB.
  async function secondTab() {
    vi.resetModules()
    const tabDb = (await import('../db/db')).db
    connections.push(tabDb)
    const client = await import('./coachClient')
    ;(await import('./coachAccount')).setCoachAccountId(accountId)
    await tabDb.open()
    expect(tabDb).not.toBe(db)
    return { client, tabDb }
  }

  it.each(['coachRuns', 'coachMessages'] as const)('aborts admission when the %s write cannot be cloned by IndexedDB', async (tableName) => {
    const table = db.table(tableName)
    const fail = (_key: unknown, value: object) => { Object.assign(value, { uncloneable: () => undefined }) }
    table.hook('creating', fail)
    try {
      await expect(startCoachRun(async () => null, 'Hola')).rejects.toMatchObject({ name: 'DataCloneError' })
    } finally {
      table.hook('creating').unsubscribe(fail)
    }
    expect(await db.coachRuns.count()).toBe(0)
    expect(await db.coachMessages.count()).toBe(0)
    await startCoachRun(async () => null, 'Ahora sí')
    expect(await db.coachRuns.count()).toBe(1)
    expect(await db.coachMessages.count()).toBe(1)
  })

  it.each(['coachRuns', 'coachMessages'] as const)('atomically rolls back session-finished admission on a %s write failure', async (tableName) => {
    const table = db.table(tableName)
    const fail = (_key: unknown, value: object) => { Object.assign(value, { uncloneable: () => undefined }) }
    table.hook('creating', fail)
    try {
      await expect(queueCoachSessionFinished('workout-failure')).rejects.toMatchObject({ name: 'DataCloneError' })
    } finally {
      table.hook('creating').unsubscribe(fail)
    }
    expect(await db.coachRuns.count()).toBe(0)
    expect(await db.coachMessages.count()).toBe(0)
  })

  it('admits only one concurrent send across two tab connections', async () => {
    const { client, tabDb } = await secondTab()
    const results = await Promise.allSettled([
      startCoachRun(async () => null, 'Primera pestaña'),
      client.startCoachRun(async () => null, 'Segunda pestaña'),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: new Error('Ya existe una ejecución activa del coach. Espera a que termine o cancélala.') })
    expect(await tabDb.coachRuns.count()).toBe(1)
    const messages = await db.coachMessages.toArray()
    expect(messages).toHaveLength(1)
    expect(await tabDb.coachRuns.get(messages[0].runId)).toBeDefined()
  })

  it('deduplicates a finished workout transactionally across tabs', async () => {
    const { client } = await secondTab()
    await Promise.all([queueCoachSessionFinished('same-workout'), client.queueCoachSessionFinished('same-workout')])
    expect(await db.coachRuns.count()).toBe(1)
    expect(await db.coachMessages.count()).toBe(1)
  })

  it('applies admission to both entry points and isolates owners', async () => {
    await db.coachRuns.put({ ...run(), ownerId: 'another-owner', status: 'running' })
    await startCoachRun(async () => null, 'Mi cuenta')
    await expect(queueCoachSessionFinished('another-workout')).rejects.toThrow('ejecución activa')
    expect(await db.coachRuns.count()).toBe(2)
    expect(await db.coachMessages.count()).toBe(1)
  })

  it('keeps a stable local identity, distinct bubbles and both the ask explanation and questions on immediate completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify(responseFor(JSON.parse(String(init.body)))))))
    const result = await startCoachRun(async () => 'token', 'Mi pregunta')
    expect(result.id).toBe(`coach-local-${result.eventId}`)
    expect(result.remoteRunId).toBe(`remote-${result.eventId}`)
    expect(await db.coachRuns.count()).toBe(1)
    expect(await db.coachRuns.get(result.remoteRunId!)).toBeUndefined()
    const messages = await db.coachMessages.toArray()
    expect(messages).toHaveLength(2)
    expect(result.messageId).toBe(messages.find((message) => message.role === 'user')?.id)
    expect(messages.find((message) => message.role === 'user')).toMatchObject({ content: 'Mi pregunta', runId: result.id, createdAt: result.createdAt })
    expect(messages.find((message) => message.role === 'assistant')).toMatchObject({ content: 'Necesito conocer tu equipo.\n\n¿Tienes barra?\n\n¿Tienes discos?', runId: result.id })
    expect(new Set(messages.map((message) => message.id)).size).toBe(2)
  })

  it('claims a queued transport once across tabs, even when start and sync overlap', async () => {
    const { client } = await secondTab()
    const sent = deferred<CoachRunRequest>()
    const reply = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => { sent.resolve(JSON.parse(String(init.body))); return reply.promise }))
    const sending = startCoachRun(async () => 'token', 'Hola')
    const request = await sent.promise
    await client.syncPendingCoachRuns(async () => 'token')
    expect(fetch).toHaveBeenCalledTimes(1)
    reply.resolve(new Response(JSON.stringify(responseFor(request))))
    await sending
    expect(await db.coachRuns.count()).toBe(1)
    expect(await db.coachMessages.count()).toBe(2)
  })

  it('rolls back a failed dispatch claim without sending a request', async () => {
    const local = await startCoachRun(async () => null, 'Hola')
    vi.stubGlobal('fetch', vi.fn())
    const fail = () => ({ uncloneable: () => undefined })
    db.coachRuns.hook('updating', fail)
    try {
      await expect(syncPendingCoachRuns(async () => 'token')).rejects.toMatchObject({ name: 'DataCloneError' })
    } finally {
      db.coachRuns.hook('updating').unsubscribe(fail)
    }
    expect(await db.coachRuns.get(local.id)).toEqual(local)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('serializes a legacy backlog without deleting its queued messages or runs', async () => {
    const first = await startCoachRun(async () => null, 'Primero')
    const secondRequest = structuredClone(first.request)
    secondRequest.event.id = 'legacy-second-event'
    const second = { ...first, id: 'coach-local-legacy-second-event', eventId: secondRequest.event.id, request: secondRequest }
    await db.coachRuns.add(second)
    await db.coachMessages.add({ id: 'legacy-second-message', runId: second.id, ownerId: accountId, role: 'user', content: 'Segundo', contextVersion: second.contextVersion, createdAt: 2 })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify(responseFor(JSON.parse(String(init.body)), 'running')))))
    await syncPendingCoachRuns(async () => 'token')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await db.coachRuns.toArray()).filter((run) => run.remoteRunId)).toHaveLength(1)
    expect(await db.coachRuns.count()).toBe(2)
    expect(await db.coachMessages.count()).toBe(2)
  })

  it('does not lose the admitted pair when persisting a network rejection fails', async () => {
    const fail = (changes: object) => 'error' in changes ? { uncloneable: () => undefined } : undefined
    db.coachRuns.hook('updating', fail)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"rejected"}', { status: 403 })))
    try {
      await expect(startCoachRun(async () => 'token', 'Hola')).rejects.toMatchObject({ name: 'DataCloneError' })
    } finally {
      db.coachRuns.hook('updating').unsubscribe(fail)
    }
    const persisted = await db.coachRuns.toCollection().first()
    expect(persisted).toMatchObject({ status: 'queued' })
    expect(await db.coachMessages.toCollection().first()).toMatchObject({ runId: persisted?.id, role: 'user', content: 'Hola' })
  })

  it.each(['coachRuns', 'coachMessages'] as const)('rolls back remote adoption if the %s write fails, then recovers with the same event', async (tableName) => {
    const local = await startCoachRun(async () => null, 'Hola')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(responseFor(local.request)))))
    const failRun = (changes: object) => 'remoteRunId' in changes ? { uncloneable: () => undefined } : undefined
    const failMessage = (_key: unknown, value: object) => { Object.assign(value, { uncloneable: () => undefined }) }
    if (tableName === 'coachRuns') db.coachRuns.hook('updating', failRun)
    else db.coachMessages.hook('creating', failMessage)
    try {
      await expect(syncPendingCoachRuns(async () => 'token')).rejects.toMatchObject({ name: 'DataCloneError' })
    } finally {
      db.coachRuns.hook('updating').unsubscribe(failRun)
      db.coachMessages.hook('creating').unsubscribe(failMessage)
    }
    const persisted = await db.coachRuns.get(local.id)
    expect(persisted).toMatchObject({ id: local.id, status: 'queued', eventId: local.eventId })
    expect(persisted?.remoteRunId).toBeUndefined()
    expect(await db.coachRuns.count()).toBe(1)
    expect(await db.coachMessages.count()).toBe(1)
    await db.coachRuns.update(local.id, { dispatchLeaseExpiresAt: 0 })
    await syncPendingCoachRuns(async () => 'token')
    expect(await db.coachRuns.get(local.id)).toMatchObject({ status: 'completed', remoteRunId: `remote-${local.eventId}` })
    expect(await db.coachMessages.count()).toBe(2)
    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][1]?.body).toBe(calls[1][1]?.body)
    expect(calls[0][1]?.headers).toEqual(calls[1][1]?.headers)
  })

  it('merges the latest local metadata and preserves timestamps over repeated refreshes', async () => {
    const local = await startCoachRun(async () => null, 'Hola')
    await db.coachRuns.update(local.id, { remoteRunId: `remote-${local.eventId}`, status: 'running' })
    const entered = deferred<void>()
    const reply = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => { entered.resolve(); return reply.promise }))
    const refreshing = refreshCoachRun(async () => 'token', local.id)
    await entered.promise
    await db.coachRuns.update(local.id, { appliedAt: 777, localAnnotation: 'conservar', usage: { inputTokens: 123 } } as Partial<CoachRunRecord>)
    reply.resolve(new Response(JSON.stringify({ ...responseFor(local.request), appliedAt: 999 })))
    expect(await refreshing).toMatchObject({ id: local.id, appliedAt: 777, createdAt: local.createdAt, localAnnotation: 'conservar', usage: { inputTokens: 123 } })
    const messages = await db.coachMessages.toArray()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(responseFor(local.request)))))
    await refreshCoachRun(async () => 'token', local.id)
    await refreshCoachRun(async () => 'token', local.id)
    expect(await db.coachMessages.toArray()).toEqual(messages)
    expect(await db.coachRuns.count()).toBe(1)
    expect(await db.coachRuns.get(local.id)).toMatchObject({ appliedAt: 777, localAnnotation: 'conservar' })
    expect(fetch).toHaveBeenCalledWith(`https://coach.example/v1/coach/runs/remote-${local.eventId}`, expect.anything())
  })

  it.each(['run', 'new assistant', 'existing assistant'] as const)('aborts an entire refresh on a failed %s write', async (target) => {
    const local = await startCoachRun(async () => null, 'Hola')
    await db.coachRuns.update(local.id, { remoteRunId: `remote-${local.eventId}`, status: 'running', appliedAt: 123 })
    if (target === 'existing assistant') await db.coachMessages.add({ id: 'existing-bubble', ownerId: accountId, role: 'assistant', content: 'Anterior', createdAt: 3, runId: local.id, contextVersion: local.contextVersion })
    const before = await db.coachRuns.get(local.id)
    const messages = await db.coachMessages.toArray()
    const failUpdate = () => ({ uncloneable: () => undefined })
    const failCreate = (_key: unknown, value: object) => { Object.assign(value, { uncloneable: () => undefined }) }
    if (target === 'run') db.coachRuns.hook('updating', failUpdate)
    else if (target === 'new assistant') db.coachMessages.hook('creating', failCreate)
    else db.coachMessages.hook('updating', failUpdate)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(responseFor(local.request)))))
    try {
      await expect(refreshCoachRun(async () => 'token', local.id)).rejects.toMatchObject({ name: 'DataCloneError' })
    } finally {
      db.coachRuns.hook('updating').unsubscribe(failUpdate)
      db.coachMessages.hook('updating').unsubscribe(failUpdate)
      db.coachMessages.hook('creating').unsubscribe(failCreate)
    }
    expect(await db.coachRuns.get(local.id)).toEqual(before)
    expect(await db.coachMessages.toArray()).toEqual(messages)
    await refreshCoachRun(async () => 'token', local.id)
    expect(await db.coachMessages.count()).toBe(2)
    if (target === 'existing assistant') expect(await db.coachMessages.get('existing-bubble')).toMatchObject({ createdAt: 3, content: expect.stringContaining('¿Tienes barra?') })
  })

  it('does not regress a completed run when an older refresh arrives late', async () => {
    const local = await startCoachRun(async () => null, 'Hola')
    await db.coachRuns.update(local.id, { remoteRunId: `remote-${local.eventId}`, status: 'running' })
    const entered = deferred<void>()
    const old = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => { entered.resolve(); return old.promise }).mockImplementationOnce(async () => new Response(JSON.stringify(responseFor(local.request)))))
    const staleRefresh = refreshCoachRun(async () => 'token', local.id)
    await entered.promise
    await refreshCoachRun(async () => 'token', local.id)
    const messages = await db.coachMessages.toArray()
    old.resolve(new Response(JSON.stringify(responseFor(local.request, 'running'))))
    expect(await staleRefresh).toMatchObject({ status: 'completed', decision: { kind: 'ask' }, endedAt: 20 })
    expect(await db.coachMessages.toArray()).toEqual(messages)
  })

  it('recovers an expired dispatch lease and ignores its late failure after reconciliation', async () => {
    const { client } = await secondTab()
    const sent = deferred<CoachRunRequest>()
    const late = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => { sent.resolve(JSON.parse(String(init.body))); return late.promise }).mockImplementation(async (_url: string, init: RequestInit) => new Response(JSON.stringify(responseFor(JSON.parse(String(init.body)))))))
    const sending = startCoachRun(async () => 'token', 'Hola')
    const request = await sent.promise
    const localId = `coach-local-${request.event.id}`
    await db.coachRuns.update(localId, { dispatchLeaseExpiresAt: 0, appliedAt: 777 })
    await client.syncPendingCoachRuns(async () => 'token')
    late.reject(new TypeError('Network error'))
    expect(await sending).toMatchObject({ id: localId, status: 'completed', appliedAt: 777 })
    expect(await db.coachMessages.count()).toBe(2)
  })

  it('preserves cancellation when the initial POST completes late and uses the remote ID for cancellation', async () => {
    const sent = deferred<CoachRunRequest>()
    const late = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => { sent.resolve(JSON.parse(String(init.body))); return late.promise }))
    const sending = startCoachRun(async () => 'token', 'Hola')
    const request = await sent.promise
    const localId = `coach-local-${request.event.id}`
    await cancelCoachRun(async () => 'token', localId)
    late.resolve(new Response(JSON.stringify(responseFor(request))))
    expect(await sending).toMatchObject({ id: localId, status: 'completed', remoteRunId: `remote-${request.event.id}` })
    expect(await db.coachMessages.count()).toBe(2)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(responseFor(request, 'completed')))))
    await cancelCoachRun(async () => 'token', localId)
    expect(fetch).toHaveBeenCalledWith(`https://coach.example/v1/coach/runs/remote-${request.event.id}/cancel`, expect.objectContaining({ method: 'POST' }))
  })

  it('does not reactivate an uncertain run after another run was admitted', async () => {
    const { client } = await secondTab()
    const sent = deferred<CoachRunRequest>()
    const late = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => { sent.resolve(JSON.parse(String(init.body))); return late.promise }).mockRejectedValueOnce(new TypeError('Network error')))
    const sending = startCoachRun(async () => 'token', 'Hola')
    const request = await sent.promise
    const localId = `coach-local-${request.event.id}`
    await db.coachRuns.update(localId, { dispatchLeaseExpiresAt: 0 })
    await client.syncPendingCoachRuns(async () => 'token')
    const next = await startCoachRun(async () => null, 'Nuevo mensaje')
    late.resolve(new Response(JSON.stringify(responseFor(request, 'running'))))
    expect(await sending).toMatchObject({ status: 'failed', error: 'unknown-outcome', remoteRunId: `remote-${request.event.id}` })
    expect((await db.coachRuns.toArray()).filter((run) => run.status === 'running' || run.status === 'queued').map((run) => run.id)).toEqual([next.id])
  })

  it('refreshes a legacy remote-ID row in place without duplicating its existing bubble', async () => {
    const legacy = { ...run(), status: 'running' as const, appliedAt: 123 }
    await db.coachRuns.add(legacy)
    await db.coachMessages.add({ id: `coach-message-${legacy.id}`, ownerId: accountId, runId: legacy.id, role: 'assistant', content: 'Anterior', createdAt: 0, contextVersion: legacy.contextVersion })
    const response = responseFor(legacy.request)
    response.run.id = legacy.id
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(response))))
    expect(await refreshCoachRun(async () => 'token', legacy.id)).toMatchObject({ id: legacy.id, remoteRunId: legacy.id, appliedAt: 123 })
    expect(await db.coachRuns.count()).toBe(1)
    expect(await db.coachMessages.count()).toBe(1)
    expect(await db.coachMessages.get(`coach-message-${legacy.id}`)).toMatchObject({ createdAt: 0, content: expect.stringContaining('¿Tienes barra?') })
  })

  it.each(['eventId', 'id', 'accountId', 'contextVersion'] as const)('rejects mismatched remote %s without modifying either store', async (field) => {
    const local = await startCoachRun(async () => null, 'Hola')
    await db.coachRuns.update(local.id, { remoteRunId: `remote-${local.eventId}`, status: 'running' })
    const before = await db.coachRuns.get(local.id)
    const wrong = responseFor(local.request)
    wrong.run[field] = 'another-value'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(wrong))))
    await expect(refreshCoachRun(async () => 'token', local.id)).rejects.toThrow('no corresponde')
    expect(await db.coachRuns.get(local.id)).toEqual(before)
    expect(await db.coachMessages.count()).toBe(1)
  })
})

describe('coach additive v10 migration', () => {
  it('preserves legacy IDs, messages, metadata and unrelated stores while repairing dangling references', async () => {
    const name = 'coach-t2-v9-upgrade'
    const legacy = new Dexie(name)
    legacy.version(9).stores({
      coachRuns: 'id, ownerId, eventId, status, createdAt, updatedAt, contextVersion',
      coachMessages: 'id, ownerId, runId, createdAt, [runId+createdAt]',
      routines: 'id, sortOrder, folderId, revision, coachReviewed, scheduledAt, retiredAt',
    })
    const upgraded = new FerroDB(name)
    try {
      await legacy.open()
      const remote = { ...run(), appliedAt: 888, legacyMetadata: 'keep' }
      const orphanId = `coach-local-${remote.eventId}`
      const userMessage = { id: `coach-message-${orphanId}`, ownerId: accountId, runId: orphanId, role: 'user', content: 'Original', createdAt: 1, contextVersion }
      const assistant = { ...userMessage, id: `coach-message-${remote.id}`, runId: remote.id, role: 'assistant', content: 'Respuesta', createdAt: 2 }
      await legacy.table('coachRuns').put(remote)
      await legacy.table('coachMessages').bulkPut([userMessage, assistant, { ...userMessage, id: 'another-owner', ownerId: 'other' }])
      await legacy.table('routines').put(routine())
      legacy.close()
      await upgraded.open()
      expect(upgraded.verno).toBe(10)
      expect(await upgraded.coachRuns.toArray()).toEqual([{ ...remote, remoteRunId: remote.id }])
      expect(await upgraded.coachMessages.get(userMessage.id)).toMatchObject({ ...userMessage, runId: remote.id, conversationId: 'coach-local-event-coach-apply', sequence: 1, deliveryState: 'delivered' })
      expect(await upgraded.coachMessages.get(assistant.id)).toMatchObject({ ...assistant, conversationId: 'coach-local-event-coach-apply', sequence: expect.any(Number), deliveryState: 'delivered' })
      expect(await upgraded.coachMessages.get('another-owner')).toMatchObject({ runId: orphanId })
      expect(await upgraded.coachMessages.count()).toBe(3)
      expect(await upgraded.routines.get(routineId)).toEqual(routine())
      expect(upgraded.coachRuns.schema.indexes.map((index) => index.name)).toEqual(expect.arrayContaining(['ownerId', 'eventId', 'status', 'createdAt', 'updatedAt', 'contextVersion', 'remoteRunId', '[ownerId+eventId]']))
    } finally {
      legacy.close()
      await upgraded.delete()
    }
  })
})

function request() {
  return {
    event: { id: 'event-coach-apply', accountId, deviceId: 'device-test', type: 'message-sent' as const, occurredAt: 1, contextVersion, payload: { message: 'Ajusta la rutina' } },
    context: { version: contextVersion, capturedAt: 1, timezone: 'UTC', isCurrent: true, snapshot: {} },
  }
}

function routine(): Routine {
  return {
    id: routineId, name: 'Rutina de prueba', sortOrder: 0, createdAt: 1, revision: 1, scheduledAt: 123_456,
    trainingRole: 'strength', loadIncrementKg: 2.5, coachReviewed: false,
    exercises: [{ occurrenceId: `${routineId}:0:squat`, exerciseId: 'squat', plannedSets: 3, setTargets: [], restSec: 120, notes: 'Nota existente', repRangeMin: 5, repRangeMax: 8, trainingRole: 'strength', loadIncrementKg: 2.5 }],
  }
}

function run(): CoachRunRecord {
  const operationId = 'operation-coach-apply'
  return {
    id: 'run-coach-apply', ownerId: accountId, eventId: 'event-coach-apply', contextVersion, status: 'completed', request: request(), createdAt: 1, updatedAt: 1,
    decision: {
      kind: 'propose', explanation: 'Aumentar una serie con evidencia.', observations: [], evidence: [],
      changeSet: {
        id: 'changeset-coach-apply', accountId, eventId: 'event-coach-apply', domain: 'training', expectedContextVersion: contextVersion,
        explanation: 'Aumentar una serie con evidencia.', observations: [], evidence: [], createdAt: 1, policyVersion: 'v1',
        operations: [{ kind: 'routine', operationId, expectedRevision: 1, routineId, occurrenceId: `${routineId}:0:squat`, patch: { plannedSets: 4 } }],
      },
    },
  }
}

describe('applyCoachChangeSet', () => {
  beforeEach(async () => {
    setCoachAccountId(accountId)
    await db.routines.clear()
    await db.coachRuns.clear()
    await db.routineRevisionSnapshots.clear()
    await db.routines.put(routine())
    await db.coachRuns.put(run())
  })

  afterEach(async () => {
    await db.routines.clear()
    await db.coachRuns.clear()
    await db.routineRevisionSnapshots.clear()
    setCoachAccountId(null)
  })

  it('aplica una propuesta confirmada atomically y conserva snapshot de la revisión anterior', async () => {
    await applyCoachChangeSet('run-coach-apply')

    const updated = await db.routines.get(routineId)
    const savedRun = await db.coachRuns.get('run-coach-apply')
    const snapshot = await db.routineRevisionSnapshots.get(`${routineId}:revision:1`)
    expect(updated?.revision).toBe(2)
    expect(updated?.exercises[0]?.plannedSets).toBe(4)
    expect(savedRun?.appliedAt).toEqual(expect.any(Number))
    expect(snapshot?.routine.exercises[0]?.plannedSets).toBe(3)
  })

  it('rechaza una propuesta obsoleta sin escribir cambios parciales', async () => {
    await db.routines.put({ ...routine(), revision: 2 })

    await expect(applyCoachChangeSet('run-coach-apply')).rejects.toThrow('La rutina cambió')
    expect((await db.routines.get(routineId))?.exercises[0]?.plannedSets).toBe(3)
    expect(await db.routineRevisionSnapshots.count()).toBe(0)
    expect((await db.coachRuns.get('run-coach-apply'))?.appliedAt).toBeUndefined()
  })

  it('conserva programación y campos no editados al aplicar un futurePlan', async () => {
    const next = run()
    if (next.decision?.kind !== 'propose') throw new Error('fixture inválido')
    next.decision.changeSet.futurePlan = {
      horizon: 'next-session',
      sessions: [{
        sessionId: routineId, name: 'Rutina de prueba', expectedRevision: 1,
        exercises: [{ occurrenceId: `${routineId}:0:squat`, exerciseId: 'squat', order: 0, plannedSets: 4, setTargets: [{ type: 'normal' }, { type: 'normal' }, { type: 'normal' }, { type: 'normal' }], repRangeMin: 5, repRangeMax: 8 }],
      }],
    }
    await db.coachRuns.put(next)
    await applyCoachChangeSet(next.id)
    const updated = await db.routines.get(routineId)
    expect(updated?.scheduledAt).toBe(123_456)
    expect(updated?.exercises[0]?.notes).toBe('Nota existente')
    expect(updated?.exercises[0]?.plannedSets).toBe(4)
  })
})

describe('coach context identity', () => {
  it('invalidates the context when consent or profile revisions change', () => {
    const base = { profileRevision: 1, consentVersion: 'coach-beta-v1', consentRevision: 4, goals: ['fuerza'] }
    expect(contextVersionFromSnapshot(base)).not.toBe(contextVersionFromSnapshot({ ...base, profileRevision: 2 }))
    expect(contextVersionFromSnapshot(base)).not.toBe(contextVersionFromSnapshot({ ...base, consentRevision: 5 }))
  })
})
