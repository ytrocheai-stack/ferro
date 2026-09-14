import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db, FerroDB } from '../db/db'
import { admitCoachRun, buildCoachRequest, normalizeCoachRequestForTransport } from './coachClient'
import { setCoachAccountId } from './coachAccount'
import { grantCoachConsent, getSelectedCoachConversation } from './coachConsent'
import { createCoachConversation, deleteCoachConversation, ensureCoachConversation, flushCoachDraft, getCoachDraft, listCoachConversations, setCoachDraft } from './coachConversations'

describe('conversaciones locales del coach', () => {
  beforeEach(async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    setCoachAccountId('account-a')
    await grantCoachConsent('account-a')
    await db.coachConversations.clear(); await db.coachDrafts.clear(); await db.coachMessages.clear(); await db.coachRuns.clear()
  })
  afterEach(async () => { await db.coachConversations.clear(); await db.coachDrafts.clear(); await db.coachMessages.clear(); await db.coachRuns.clear(); setCoachAccountId(null); vi.unstubAllGlobals() })

  it('aísla cuentas, reutiliza el borrador vacío y asigna una conversación duradera', async () => {
    const first = await ensureCoachConversation('account-a')
    expect(await ensureCoachConversation('account-a', first.id)).toEqual(first)
    expect(await ensureCoachConversation('account-b')).not.toMatchObject({ id: first.id, ownerId: 'account-a' })
    setCoachDraft('account-a', first.id, 'borrador')
    await flushCoachDraft('account-a', first.id)
    expect(await getCoachDraft('account-a', first.id)).toBe('borrador')
    expect(await getCoachDraft('account-b', first.id)).toBe('')
    expect(await createCoachConversation('account-a')).toEqual(first)
  })

  it('resuelve una colisión de identidad sin cambiar el propietario ni los mensajes ajenos', async () => {
    const ownerA = await ensureCoachConversation('owner-a', 'shared-conversation')
    await db.coachMessages.put({ id: 'owner-a-message', ownerId: 'owner-a', runId: 'run-a', conversationId: ownerA.id, sequence: 1, role: 'user', content: 'A', createdAt: 1, contextVersion: 'ctx' })
    const ownerB = await ensureCoachConversation('owner-b', 'shared-conversation')
    expect(ownerB.id).not.toBe(ownerA.id)
    expect(ownerB.ownerId).toBe('owner-b')
    await expect(ensureCoachConversation('owner-b', 'shared-conversation')).resolves.toEqual(ownerB)
    expect(await db.coachConversations.get(ownerA.id)).toMatchObject({ ownerId: 'owner-a' })
    expect(await db.coachMessages.get('owner-a-message')).toMatchObject({ conversationId: ownerA.id, ownerId: 'owner-a' })
  })

  it('envía únicamente la conversación seleccionada y conserva el historial local completo', async () => {
    const selected = await getSelectedCoachConversation('account-a')
    await db.coachMessages.put({ id: 'seed', ownerId: 'account-a', runId: 'seed', conversationId: selected.id, sequence: 1, role: 'user', content: 'semilla', createdAt: 0, contextVersion: 'ctx' })
    const other = await createCoachConversation('account-a', 'Otra')
    await db.coachMessages.bulkPut([
      { id: 'selected', ownerId: 'account-a', runId: 'run-a', conversationId: selected.id, sequence: 1, deliveryState: 'delivered' as const, role: 'user' as const, content: 'seleccionada', createdAt: 1, contextVersion: 'ctx' },
      { id: 'other', ownerId: 'account-a', runId: 'run-b', conversationId: other.id, sequence: 1, deliveryState: 'delivered' as const, role: 'user' as const, content: 'privada', createdAt: 2, contextVersion: 'ctx' },
      { id: 'legacy-without-conversation', ownerId: 'account-a', runId: 'run-legacy', role: 'user' as const, content: 'legacy mezclado', createdAt: 3, contextVersion: 'ctx' },
    ])
    const request = await buildCoachRequest('nuevo')
    expect(request?.event.conversationId).toBe(selected.id)
    expect(request?.context.snapshot.conversation.map((message) => message.content)).toEqual(['semilla', 'seleccionada'])
    expect(await db.coachMessages.count()).toBe(4)
  })

  it('construye el request con la conversación capturada aunque cambie la selección global', async () => {
    const captured = await createCoachConversation('account-a', 'Capturada')
    await db.coachMessages.put({ id: 'captured-seed', ownerId: 'account-a', runId: 'captured-run', conversationId: captured.id, sequence: 1, role: 'user', content: 'capturada', createdAt: 1, contextVersion: 'ctx' })
    const other = await createCoachConversation('account-a', 'Otra')
    const request = await buildCoachRequest('capturada', undefined, 'message-sent', { conversationId: captured.id })
    expect(request?.event.conversationId).toBe(captured.id)
    expect(request?.context.snapshot.conversation.map((message) => message.content)).toEqual(['capturada'])
    expect(other.ownerId).toBe('account-a')
  })

  it('marca eliminación pendiente y cancelación sin borrar contenido, y elimina después', async () => {
    const conversation = await ensureCoachConversation('account-a')
    const run = { id: 'run-pending', ownerId: 'account-a', eventId: 'event-pending', conversationId: conversation.id, contextVersion: 'ctx', status: 'running' as const, request: {} as never, createdAt: 1, updatedAt: 1 }
    await db.coachRuns.put(run)
    await db.coachMessages.put({ id: 'message-pending', ownerId: 'account-a', runId: run.id, conversationId: conversation.id, sequence: 1, role: 'user', content: 'No borrar', createdAt: 1, contextVersion: 'ctx' })
    expect(await deleteCoachConversation('account-a', conversation.id)).toBe(false)
    expect(await db.coachConversations.get(conversation.id)).toMatchObject({ pendingDeletion: true })
    expect(await db.coachRuns.get(run.id)).toMatchObject({ error: 'cancellation-pending', cancelRequestedAt: expect.any(Number) })
    await db.coachRuns.update(run.id, { status: 'cancelled' })
    expect(await deleteCoachConversation('account-a', conversation.id)).toBe(true)
    expect(await db.coachMessages.get('message-pending')).toBeUndefined()
  })

  it('invalida memoria y timer del draft al eliminar una conversación', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const conversation = await ensureCoachConversation('account-a')
      setCoachDraft('account-a', conversation.id, 'no debe reaparecer')
      expect(await deleteCoachConversation('account-a', conversation.id)).toBe(true)
      await vi.advanceTimersByTimeAsync(300)
      expect(await db.coachDrafts.get(`account-a:${conversation.id}`)).toBeUndefined()
    } finally { vi.useRealTimers() }
  })

  it('rechaza una conversación inexistente sin consumir una secuencia ajena', async () => {
    const ownerB = await ensureCoachConversation('owner-b', 'foreign')
    const request = await buildCoachRequest('mensaje')
    const foreignRequest = structuredClone(request!)
    foreignRequest.event.conversationId = ownerB.id
    await expect(admitCoachRun(foreignRequest)).rejects.toThrow('no existe o no pertenece')
    expect(await db.coachConversations.get(ownerB.id)).toMatchObject({ ownerId: 'owner-b', nextSequence: 1 })
    expect(await db.coachRuns.count()).toBe(0)
  })

  it('normaliza snapshots legacy sin mezclar conversaciones', async () => {
    const request = await buildCoachRequest('mensaje')
    const legacy = structuredClone(request!) as unknown as Record<string, unknown>
    const context = legacy.context as Record<string, unknown>
    const snapshot = context.snapshot as Record<string, unknown>
    snapshot.conversation = [
      { id: 'selected', conversationId: request!.event.conversationId, role: 'user', content: 'sí', createdAt: 1, contextVersion: 'ctx' },
      { id: 'other', conversationId: 'other-conversation', role: 'user', content: 'no', createdAt: 2, contextVersion: 'ctx' },
      { id: 'undefined', role: 'user', content: 'tampoco', createdAt: 3, contextVersion: 'ctx' },
    ]
    const normalized = normalizeCoachRequestForTransport(legacy)
    expect(normalized.context.snapshot.conversation.map((message) => message.content)).toEqual(['sí'])
  })

  it('mantiene fechas iguales con secuencias distintas y soporta recarga del repositorio', async () => {
    const first = await ensureCoachConversation('account-a')
    await db.coachMessages.bulkPut([
      { id: 'b', ownerId: 'account-a', runId: 'run', conversationId: first.id, sequence: 2, role: 'user', content: 'b', createdAt: 10, contextVersion: 'ctx' },
      { id: 'a', ownerId: 'account-a', runId: 'run', conversationId: first.id, sequence: 1, role: 'user', content: 'a', createdAt: 10, contextVersion: 'ctx' },
    ])
    expect((await listCoachConversations('account-a'))[0].id).toBe(first.id)
    const reopened = await ensureCoachConversation('account-a', first.id)
    expect(reopened.nextSequence).toBe(1)
    expect(await getCoachDraft('account-a', first.id)).toBe('')
  })
})

describe('migración v9 a v10 de conversaciones', () => {
  it('agrupa referencias huérfanas por propietario sin borrar mensajes', async () => {
    const name = `t4-migration-${Date.now()}`
    const legacy = new Dexie(name)
    legacy.version(9).stores({ coachRuns: 'id, ownerId, eventId, status, createdAt, updatedAt, contextVersion', coachMessages: 'id, ownerId, runId, createdAt, [runId+createdAt]' })
    await legacy.open()
    await legacy.table('coachRuns').put({ id: 'coach-local-event-1', ownerId: 'owner-a', eventId: 'event-1', contextVersion: 'ctx', status: 'completed', request: { event: { id: 'event-1', accountId: 'owner-a', deviceId: 'd', conversationId: 'conv-a' } }, createdAt: 10, updatedAt: 10 })
    await legacy.table('coachMessages').bulkPut([{ id: 'known-a', ownerId: 'owner-a', runId: 'coach-local-event-1', role: 'user', content: 'conserva', createdAt: 10, contextVersion: 'ctx' }, { id: 'known-b', ownerId: 'owner-a', runId: 'coach-local-event-1', role: 'assistant', content: 'segunda', createdAt: 10, contextVersion: 'ctx' }, { id: 'orphan', ownerId: 'owner-a', runId: 'missing', role: 'assistant', content: 'huérfano', createdAt: 10, contextVersion: 'ctx' }])
    legacy.close()
    const upgraded = new FerroDB(name)
    await upgraded.open()
    expect(await upgraded.coachMessages.count()).toBe(3)
    expect(await upgraded.coachConversations.get('conv-a')).toMatchObject({ ownerId: 'owner-a' })
    expect(await upgraded.coachConversations.get('coach-history-owner-a')).toMatchObject({ title: 'Historial anterior' })
    expect((await upgraded.coachMessages.get('orphan'))?.content).toBe('huérfano')
    expect(await upgraded.coachMessages.get('known-a')).toMatchObject({ sequence: 1, conversationId: 'conv-a' })
    expect(await upgraded.coachMessages.get('known-b')).toMatchObject({ sequence: 2, conversationId: 'conv-a' })
    expect(await upgraded.coachConversations.get('conv-a')).toMatchObject({ nextSequence: 3 })
    upgraded.close()
    const reopened = new FerroDB(name)
    await reopened.open()
    expect(await reopened.coachMessages.get('known-a')).toMatchObject({ sequence: 1 })
    expect(await reopened.coachMessages.get('known-b')).toMatchObject({ sequence: 2 })
    expect(await reopened.coachConversations.get('conv-a')).toMatchObject({ nextSequence: 3 })
    reopened.close(); await Dexie.delete(name)
  })
})
