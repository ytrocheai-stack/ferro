export const COACH_CONSENT_VERSION = 'coach-context-v3-gemini-nvidia'
const CONSENT_KEY = 'ferro-coach-consent'
const DEVICE_KEY = 'ferro-coach-device-id'
const CONVERSATION_PREFIX = 'ferro-coach-conversation:'
import { db } from '../db/db'
import type { CoachConsentRecord, CoachProfile } from '../db/types'
import { ensureCoachConversation } from './coachConversations'

export interface CoachConsent {
  userId: string
  deviceId: string
  version: string
  acceptedAt: number
  enabled: boolean
}

function read(): CoachConsent[] {
  try {
    const value: unknown = JSON.parse(typeof localStorage?.getItem === 'function' ? localStorage.getItem(CONSENT_KEY) ?? '[]' : '[]')
    return Array.isArray(value) ? value.filter((item): item is CoachConsent => {
      if (!item || typeof item !== 'object') return false
      const record = item as Record<string, unknown>
      return typeof record.userId === 'string' && typeof record.deviceId === 'string' && typeof record.version === 'string' && typeof record.acceptedAt === 'number' && typeof record.enabled === 'boolean'
    }) : []
  } catch {
    return []
  }
}

function write(consents: CoachConsent[]) {
  if (typeof localStorage?.setItem === 'function') localStorage.setItem(CONSENT_KEY, JSON.stringify(consents))
}

export function getCoachDeviceId(): string {
  const existing = typeof localStorage?.getItem === 'function' ? localStorage.getItem(DEVICE_KEY) : null
  if (existing) return existing
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  if (typeof localStorage?.setItem === 'function') localStorage.setItem(DEVICE_KEY, id)
  return id
}

/** Conversation stable for this account/device; local messages remain the source of truth. */
export function getCoachConversationId(userId: string): string {
  const key = `${CONVERSATION_PREFIX}${userId}:${getCoachDeviceId()}`
  const existing = typeof localStorage?.getItem === 'function' ? localStorage.getItem(key) : null
  if (existing) return existing
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `conversation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  if (typeof localStorage?.setItem === 'function') localStorage.setItem(key, id)
  return id
}

export function setCoachConversationId(userId: string, conversationId: string): void {
  if (typeof localStorage?.setItem === 'function') localStorage.setItem(`${CONVERSATION_PREFIX}${userId}:${getCoachDeviceId()}`, conversationId)
}

/** Returns the durable selected conversation while preserving the old localStorage identity. */
export async function getSelectedCoachConversation(userId: string) {
  return ensureCoachConversation(userId, getCoachConversationId(userId))
}

export function getCoachConsent(userId: string | null | undefined): CoachConsent | null {
  if (!userId) return null
  return read().find((item) => item.userId === userId && item.deviceId === getCoachDeviceId() && item.version === COACH_CONSENT_VERSION && item.enabled) ?? null
}

export async function grantCoachConsent(userId: string): Promise<CoachConsent> {
  const consent: CoachConsent = { userId, deviceId: getCoachDeviceId(), version: COACH_CONSENT_VERSION, acceptedAt: Date.now(), enabled: true }
  const now = Date.now()
  await db.coachConsents.put({ id: `${userId}:${consent.deviceId}`, ownerId: userId, deviceId: consent.deviceId, version: consent.version, enabled: true, revision: now, acceptedAt: consent.acceptedAt, updatedAt: now } satisfies CoachConsentRecord)
  write([...read().filter((item) => !(item.userId === userId && item.deviceId === consent.deviceId)), consent])
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nextrep:coach-consent-changed', { detail: { userId } }))
  return consent
}

export async function revokeCoachConsent(userId: string): Promise<void> {
  const deviceId = getCoachDeviceId()
  write(read().map((item) => item.userId === userId && item.deviceId === deviceId ? { ...item, enabled: false } : item))
  await db.transaction('rw', [db.coachConsents, db.coachRuns, db.adaptationProposals], async () => {
    const id = `${userId}:${deviceId}`
    const current = await db.coachConsents.get(id)
    const now = Date.now()
    await db.coachConsents.put({ id, ownerId: userId, deviceId, version: current?.version ?? COACH_CONSENT_VERSION, enabled: false, revision: (current?.revision ?? 0) + 1, acceptedAt: current?.acceptedAt ?? now, updatedAt: now })
    const runs = await db.coachRuns.where('ownerId').equals(userId).toArray()
    await db.coachRuns.bulkPut(runs.filter((run) => run.status === 'queued' || run.status === 'running').map((run) => ({ ...run, status: 'cancelled' as const, error: 'cancelled-by-consent-revocation', endedAt: now, updatedAt: now })))
    const proposals = await db.adaptationProposals.where('ownerId').equals(userId).toArray()
    await db.adaptationProposals.bulkPut(proposals.filter((proposal) => proposal.status === 'pending').map((proposal) => ({ ...proposal, status: 'stale' as const })))
  })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nextrep:coach-consent-changed', { detail: { userId } }))
}

export async function readCoachConsentRecord(userId: string, deviceId = getCoachDeviceId()): Promise<CoachConsentRecord | undefined> {
  return db.coachConsents.get(`${userId}:${deviceId}`)
}

const emptyProfile = (ownerId: string): CoachProfile => ({
  id: ownerId,
  ownerId,
  population: [],
  populationConfirmed: false,
  goals: [],
  injuriesOrPain: [],
  unavailableEquipment: [],
  excludedExercises: [],
  nutritionConstraints: [],
  revision: 1,
  updatedAt: Date.now(),
})

export async function getCoachProfile(ownerId: string): Promise<CoachProfile> {
  return (await db.coachProfiles.get(ownerId)) ?? emptyProfile(ownerId)
}

export async function saveCoachProfile(profile: Omit<CoachProfile, 'revision' | 'updatedAt'> & Partial<Pick<CoachProfile, 'revision' | 'updatedAt'>>): Promise<CoachProfile> {
  const previous = await db.coachProfiles.get(profile.ownerId)
  const now = Date.now()
  const next: CoachProfile = { ...emptyProfile(profile.ownerId), ...profile, revision: (previous?.revision ?? profile.revision ?? 0) + 1, updatedAt: now }
  await db.transaction('rw', [db.coachProfiles, db.coachRuns], async () => {
    await db.coachProfiles.put(next)
    const runs = await db.coachRuns.where('ownerId').equals(profile.ownerId).toArray()
    await db.coachRuns.bulkPut(runs.filter((run) => run.status === 'queued' || run.status === 'running').map((run) => ({ ...run, status: 'cancelled' as const, error: 'cancelled-by-context-change', endedAt: now, updatedAt: now })))
  })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nextrep:coach-profile-changed', { detail: { userId: profile.ownerId } }))
  return next
}
