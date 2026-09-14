import { db } from '../db/db'
import type { CoachConversation, CoachDraft } from '../db/types'
import { uid } from './format'

const DEFAULT_TITLE = 'Nueva conversación'
const draftTimers = new Map<string, ReturnType<typeof setTimeout>>()
const draftMemory = new Map<string, string>()
const draftId = (ownerId: string, conversationId: string) => `${ownerId}:${conversationId}`

function alternateConversationId(ownerId: string, requestedId: string): string {
  return `${ownerId}:${requestedId}`
}

export async function listCoachConversations(ownerId: string): Promise<CoachConversation[]> {
  return (await db.coachConversations.where('ownerId').equals(ownerId).toArray())
    .filter((item) => !item.pendingDeletion).sort((a, b) => b.updatedAt - a.updatedAt || a.createdAt - b.createdAt)
}

export async function ensureCoachConversation(ownerId: string, requestedId?: string): Promise<CoachConversation> {
  return db.transaction('rw', [db.coachConversations, db.coachMessages], async () => {
    if (requestedId) {
      const requested = await db.coachConversations.get(requestedId)
      if (requested?.ownerId === ownerId && !requested.pendingDeletion) return requested
    }
    const conversations = await db.coachConversations.where('ownerId').equals(ownerId).toArray()
    if (!requestedId) {
      for (const conversation of conversations) {
        if (!conversation.pendingDeletion && await db.coachMessages.where('conversationId').equals(conversation.id).count() === 0) return conversation
      }
    }
    const baseId = requestedId ?? uid()
    let id = baseId
    let collision = await db.coachConversations.get(id)
    let suffix = 0
    while (collision) {
      if (collision.ownerId === ownerId && !collision.pendingDeletion) return collision
      suffix += 1
      id = `${alternateConversationId(ownerId, baseId)}${suffix === 1 ? '' : `:${suffix}`}`
      collision = await db.coachConversations.get(id)
    }
    const now = Date.now()
    const conversation: CoachConversation = { id, ownerId, title: DEFAULT_TITLE, createdAt: now, updatedAt: now, nextSequence: 1 }
    await db.coachConversations.add(conversation)
    return conversation
  })
}

export async function selectCoachConversation(ownerId: string, id: string, previousId?: string): Promise<CoachConversation> {
  if (previousId && previousId !== id) await flushCoachDraft(ownerId, previousId)
  return ensureCoachConversation(ownerId, id)
}

export async function createCoachConversation(ownerId: string, title = DEFAULT_TITLE): Promise<CoachConversation> {
  return db.transaction('rw', [db.coachConversations, db.coachMessages], async () => {
    const candidates = await db.coachConversations.where('ownerId').equals(ownerId).toArray()
    for (const candidate of candidates) {
      if (!candidate.pendingDeletion && await db.coachMessages.where('conversationId').equals(candidate.id).count() === 0) return candidate
    }
    const now = Date.now()
    const conversation: CoachConversation = { id: uid(), ownerId, title: title.trim() || DEFAULT_TITLE, createdAt: now, updatedAt: now, nextSequence: 1 }
    await db.coachConversations.add(conversation)
    return conversation
  })
}

export async function renameCoachConversation(ownerId: string, id: string, title: string): Promise<CoachConversation> {
  const current = await db.coachConversations.get(id)
  if (!current || current.ownerId !== ownerId || current.pendingDeletion) throw new Error('La conversación no existe')
  const next = { ...current, title: title.trim() || DEFAULT_TITLE, updatedAt: Date.now() }
  await db.coachConversations.put(next)
  return next
}

export async function deleteCoachConversation(ownerId: string, id: string): Promise<boolean> {
  const key = draftId(ownerId, id)
  const timer = draftTimers.get(key)
  if (timer) { clearTimeout(timer); draftTimers.delete(key) }
  draftMemory.delete(key)
  return db.transaction('rw', [db.coachConversations, db.coachMessages, db.coachRuns, db.coachDrafts], async () => {
    const current = await db.coachConversations.get(id)
    if (!current || current.ownerId !== ownerId) return false
    const active = (await db.coachRuns.where('ownerId').equals(ownerId).toArray()).filter((run) => run.conversationId === id && (run.status === 'queued' || run.status === 'running'))
    if (active.length) {
      const now = Date.now()
      await db.coachConversations.put({ ...current, pendingDeletion: true, updatedAt: now })
      await db.coachRuns.bulkPut(active.map((run) => ({ ...run, cancelRequestedAt: run.cancelRequestedAt ?? now, error: 'cancellation-pending', updatedAt: now })))
      return false
    }
    await db.coachMessages.where('conversationId').equals(id).delete()
    await db.coachDrafts.where('[ownerId+conversationId]').equals([ownerId, id]).delete()
    await db.coachConversations.delete(id)
    return true
  })
}

export async function getCoachDraft(ownerId: string, conversationId: string): Promise<string> {
  const key = draftId(ownerId, conversationId)
  if (draftMemory.has(key)) return draftMemory.get(key)!
  const content = (await db.coachDrafts.get(key))?.content ?? ''
  draftMemory.set(key, content)
  return content
}

export async function flushCoachDraft(ownerId: string, conversationId: string): Promise<void> {
  const key = draftId(ownerId, conversationId)
  const timer = draftTimers.get(key)
  if (timer) { clearTimeout(timer); draftTimers.delete(key) }
  const content = draftMemory.get(key) ?? ''
  if (content) await db.coachDrafts.put({ id: key, ownerId, conversationId, content, updatedAt: Date.now() } satisfies CoachDraft)
  else await db.coachDrafts.delete(key)
}

export function setCoachDraft(ownerId: string, conversationId: string, content: string): void {
  const key = draftId(ownerId, conversationId)
  draftMemory.set(key, content)
  const old = draftTimers.get(key)
  if (old) clearTimeout(old)
  draftTimers.set(key, setTimeout(() => void flushCoachDraft(ownerId, conversationId), 300))
}

export async function flushAllCoachDrafts(): Promise<void> {
  await Promise.all([...draftMemory.keys()].map((key) => { const split = key.indexOf(':'); return flushCoachDraft(key.slice(0, split), key.slice(split + 1)) }))
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushAllCoachDrafts() })
  window.addEventListener('pagehide', () => void flushAllCoachDrafts())
}
