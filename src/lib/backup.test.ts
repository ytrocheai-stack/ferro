import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import type { CoachConsentRecord, CoachConversation, CoachDraft, CoachMessage, CoachProfile, CoachRunRecord } from '../db/types'
import { useNutrition } from '../stores/nutrition'
import { useSettings } from '../stores/settings'
import { exportBackup, importBackup, validateBackup } from './backup'
import { setCoachAccountId } from './coachAccount'
import { syncPendingCoachRuns } from './coachClient'
import { normalizeBackup, type ValidBackup } from './validation'

const base = {
  app: 'ferro' as const,
  version: 2 as const,
  exportedAt: '2026-08-08T00:00:00.000Z',
  workouts: [
    {
      id: 'w1',
      name: 'Push',
      startedAt: 1_000,
      endedAt: 2_000,
      exercises: [
        {
          exerciseId: 'bench',
          restSec: 90,
          sets: [{ type: 'normal' as const, weightKg: 60, reps: 5, completed: true }],
        },
      ],
      volumeKg: 300,
      totalSets: 1,
      prs: [],
    },
  ],
  routines: [],
  customExercises: [],
}

const coachRequest = {
  event: { id: 'event-1', accountId: 'owner-a', deviceId: 'device-a', conversationId: 'conversation-1', type: 'message-sent', occurredAt: 1, contextVersion: 'ctx-1', payload: { message: 'Hola' } },
  context: { version: 'ctx-1', capturedAt: 1, timezone: 'America/Mexico_City', isCurrent: true, snapshot: { message: 'Hola', profileRevision: 1, consentVersion: 'coach-context-v2', consentRevision: 1, profile: { population: [], populationConfirmed: false, goals: [] }, goals: [], restrictions: { injuriesOrPain: [], unavailableEquipment: [], excludedExercises: [], nutritionConstraints: [] }, catalog: [], metrics: { captured: false, bestE1rmByExercise: {} }, plan: [], history: [], conversation: [{ id: 'message-1', role: 'user', content: 'Hola', runId: 'run-1', createdAt: 1, contextVersion: 'ctx-1' }], conversationVersion: 'conversation-1:1' } },
}

const coachRecords = {
  coachProfiles: [{ id: 'owner-a', ownerId: 'owner-a', population: ['general'], populationConfirmed: true, goals: ['fuerza'], injuriesOrPain: [], unavailableEquipment: [], excludedExercises: [], nutritionConstraints: [], revision: 1, updatedAt: 1 }],
  coachConsents: [{ id: 'owner-a:device-a', ownerId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v2', enabled: true, revision: 1, acceptedAt: 1, updatedAt: 1 }],
  coachConversations: [{ id: 'conversation-1', ownerId: 'owner-a', title: 'Primera', createdAt: 1, updatedAt: 2, nextSequence: 2 }],
  coachDrafts: [{ id: 'owner-a:conversation-1', ownerId: 'owner-a', conversationId: 'conversation-1', content: 'Borrador', updatedAt: 2 }],
  coachMessages: [{ id: 'message-1', ownerId: 'owner-a', runId: 'run-1', conversationId: 'conversation-1', sequence: 1, role: 'user', content: 'Hola', createdAt: 1, contextVersion: 'ctx-1', deliveryState: 'delivered' }],
  coachRuns: [{ id: 'run-1', ownerId: 'owner-a', eventId: 'event-1', conversationId: 'conversation-1', messageId: 'message-1', reconciliationState: 'reconciled', contextVersion: 'ctx-1', status: 'completed', request: coachRequest, createdAt: 1, updatedAt: 2, endedAt: 2 }],
}

describe('validación de respaldos', () => {
  beforeEach(async () => {
    const storage = new Map<string, string>([['ferro-coach-device-id', 'device-a']])
    const localStorageStub = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }
    vi.stubGlobal('localStorage', localStorageStub)
    Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageStub })
    await db.delete()
    await db.open()
  })

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); setCoachAccountId(null) })

  it('rechaza un ejercicio con una serie incompleta', () => {
    const broken = structuredClone(base)
    delete (broken.workouts[0].exercises[0].sets[0] as { completed?: boolean }).completed
    expect(validateBackup(broken)).toMatch(/completed|complet/i)
  })

  it('rechaza fechas o derivados ausentes antes de modificar la base', async () => {
    await db.workouts.put({ ...base.workouts[0], name: 'Local' })
    const broken = structuredClone(base) as Record<string, unknown>
    const workout = (broken.workouts as Array<Record<string, unknown>>)[0]
    delete workout.endedAt
    expect(validateBackup(broken)).toMatch(/endedAt|entreno/i)

    await expect(importBackup(new File([JSON.stringify(broken)], 'broken.json', { type: 'application/json' }))).rejects.toThrow(
      /no se ha modificado/i,
    )
    await expect(db.workouts.get('w1')).resolves.toMatchObject({ name: 'Local' })
  })

  it('acepta un backup v2 válido sin tablas introducidas en v3', () => {
    expect(validateBackup(base)).toBeNull()
  })

  it('acepta el formato v7 que conserva la identidad del contexto', () => {
    expect(validateBackup({ ...base, version: 7 })).toBeNull()
  })

  it('acepta la preferencia de tema sin exigirla en backups antiguos', () => {
    expect(validateBackup({ ...base, settings: { theme: 'dark' } })).toBeNull()
    expect(validateBackup({ ...base, settings: { theme: 'invalid' } })).toMatch(/theme|tema/i)
  })

  it('rechaza IDs duplicados y referencias Coach inválidas antes de escribir', async () => {
    const duplicate = { ...base, customExercises: [{ id: 'dup', name: 'A', bodyPart: '', equipment: '', target: '', secondaryMuscles: [], createdAt: 1 }, { id: 'dup', name: 'B', bodyPart: '', equipment: '', target: '', secondaryMuscles: [], createdAt: 2 }] }
    expect(validateBackup(duplicate)).not.toBeNull()
    const invalidReference = { ...base, version: 10 as const, ...coachRecords, coachMessages: [{ ...coachRecords.coachMessages[0], conversationId: 'missing' }] }
    expect(validateBackup(invalidReference)).not.toBeNull()
  })

  it('rechaza owner inconsistente y secuencias imposibles sin limpiar los datos locales', async () => {
    const local = { ...base.workouts[0], name: 'Local' }
    await db.workouts.put(local)
    const broken = { ...base, version: 10 as const, ...coachRecords, coachConversations: [{ ...coachRecords.coachConversations[0], nextSequence: 1 }], coachMessages: [{ ...coachRecords.coachMessages[0], ownerId: 'owner-b' }] }
    expect(validateBackup(broken)).not.toBeNull()
    await expect(importBackup(new File([JSON.stringify(broken)], 'owner.json'))).rejects.toThrow(/no se ha modificado/i)
    await expect(db.workouts.get('w1')).resolves.toMatchObject({ name: 'Local' })
  })

  it('conserva conversaciones, mensajes, drafts y runs en un round-trip v10', async () => {
    setCoachAccountId('owner-a')
    const backup = { ...base, version: 10 as const, ...coachRecords }
    expect(validateBackup(backup)).toBeNull()
    await importBackup(new File([JSON.stringify(backup)], 'coach.json'))
    await expect(db.coachConversations.get('conversation-1')).resolves.toMatchObject({ title: 'Primera', nextSequence: 2 })
    await expect(db.coachMessages.get('message-1')).resolves.toMatchObject({ conversationId: 'conversation-1', sequence: 1 })
    await expect(db.coachDrafts.get('owner-a:conversation-1')).resolves.toMatchObject({ content: 'Borrador' })
    await expect(db.coachRuns.get('run-1')).resolves.toMatchObject({ status: 'completed', conversationId: 'conversation-1' })
  })

  it('revierte toda la importación cuando una escritura Coach falla', async () => {
    setCoachAccountId('owner-a')
    await db.workouts.put({ ...base.workouts[0], name: 'Original' })
    const fail = () => { throw new Error('fallo de almacenamiento') }
    db.coachMessages.hook('creating', fail)
    try {
      const backup = { ...base, version: 10 as const, ...coachRecords }
      await expect(importBackup(new File([JSON.stringify(backup)], 'rollback.json'))).rejects.toThrow('fallo de almacenamiento')
      await expect(db.workouts.get('w1')).resolves.toMatchObject({ name: 'Original' })
      await expect(db.coachConversations.count()).resolves.toBe(0)
    } finally {
      db.coachMessages.hook('creating').unsubscribe(fail)
    }
  })

  it('preserva el consentimiento operativo actual en IndexedDB y localStorage', async () => {
    setCoachAccountId('owner-a')
    const currentConsent = { id: 'owner-a:device-a', ownerId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v2', enabled: true, revision: 99, acceptedAt: 90, updatedAt: 99 }
    await db.coachConsents.put(currentConsent)
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v2', acceptedAt: 90, enabled: true }]))
    const backup = { ...base, version: 10 as const, ...coachRecords, coachConsents: [{ ...coachRecords.coachConsents[0], revision: 1, acceptedAt: 1, updatedAt: 1 }] }

    await importBackup(new File([JSON.stringify(backup)], 'consent.json'))

    await expect(db.coachConsents.get(currentConsent.id)).resolves.toEqual(currentConsent)
    expect(JSON.parse(localStorage.getItem('ferro-coach-consent')!)).toEqual([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v2', acceptedAt: 90, enabled: true }])
  })

  it('rechaza cualquier backup Coach si no hay owner activo', async () => {
    setCoachAccountId(null)
    const backup = { ...base, version: 10 as const, ...coachRecords }

    await expect(importBackup(new File([JSON.stringify(backup)], 'owner-required.json'))).rejects.toThrow(/cuenta activa|owner/i)
    await expect(db.coachConversations.count()).resolves.toBe(0)
  })

  it('importa runs activos como legacy y no los despacha al despertar la sincronización', async () => {
    setCoachAccountId('owner-a')
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v2', acceptedAt: 1, enabled: true }]))
    vi.stubEnv('VITE_ADAPTATION_WORKER_URL', 'https://coach.example')
    vi.stubGlobal('navigator', { onLine: true })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const backup = { ...base, version: 10 as const, ...coachRecords, coachRuns: [{ ...coachRecords.coachRuns[0], status: 'queued' as const, endedAt: undefined }] }

    await importBackup(new File([JSON.stringify(backup)], 'legacy.json'))
    await syncPendingCoachRuns(async () => 'token')

    await expect(db.coachRuns.get('run-1')).resolves.toMatchObject({ status: 'queued', legacy: true, error: 'legacy-imported', dispatchToken: undefined, dispatchLeaseExpiresAt: undefined })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rechaza IDs canónicos, relaciones de snapshot y estados temporales imposibles', () => {
    const broken = structuredClone({ ...base, version: 10 as const, ...coachRecords }) as unknown as ValidBackup
    broken.coachConsents![0].id = 'wrong-consent-id'
    broken.coachDrafts![0].id = 'wrong-draft-id'
    broken.coachRuns![0].request.event.conversationId = 'other-conversation'
    broken.coachRuns![0].dispatchToken = 'stale-token'
    broken.coachRuns![0].dispatchLeaseExpiresAt = 2
    expect(validateBackup(broken)).not.toBeNull()
    const snapshotBroken = structuredClone({ ...base, version: 10 as const, ...coachRecords }) as unknown as ValidBackup
    snapshotBroken.coachRuns![0].request.context.snapshot.conversation[0].content = 'contenido alterado'
    expect(validateBackup(snapshotBroken)).not.toBeNull()
  })

  it('normaliza explícitamente un backup v7 al formato canónico v10', () => {
    const legacy = structuredClone({ ...base, version: 7 as const, ...coachRecords }) as unknown as ValidBackup
    delete legacy.coachRuns![0].endedAt
    delete legacy.coachMessages![0].sequence
    const normalized = normalizeBackup(legacy as never)

    expect(normalized.version).toBe(10)
    expect(normalized.coachRuns?.[0]).toMatchObject({ legacy: true, endedAt: 2, reconciliationState: 'reconciled' })
    expect(normalized.coachMessages?.[0]).toMatchObject({ sequence: 1 })
    expect(normalized.coachConversations?.[0]).toMatchObject({ nextSequence: 2 })
    expect(validateBackup(normalized)).toBeNull()
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const)('normaliza la versión histórica v%s a v10 sin perder colecciones', (version) => {
    const normalized = normalizeBackup({ ...base, version } as unknown as ValidBackup)
    expect(normalized.version).toBe(10)
    expect(normalized.coachRuns).toEqual([])
    expect(normalized.coachMessages).toEqual([])
    expect(normalized.routines).toEqual([])
  })

  it('exporta datos Coach reales y permite reimportarlos conservando las entidades', async () => {
    setCoachAccountId('owner-a')
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v2', acceptedAt: 1, enabled: true }]))
    await db.coachConversations.put(coachRecords.coachConversations[0] as unknown as CoachConversation)
    await db.coachDrafts.put(coachRecords.coachDrafts[0] as unknown as CoachDraft)
    await db.coachMessages.put(coachRecords.coachMessages[0] as unknown as CoachMessage)
    await db.coachRuns.put(coachRecords.coachRuns[0] as unknown as CoachRunRecord)
    await db.coachProfiles.put(coachRecords.coachProfiles[0] as unknown as CoachProfile)
    await db.coachConsents.put(coachRecords.coachConsents[0] as unknown as CoachConsentRecord)
    const persistStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
    useSettings.persist.setOptions({ storage: persistStorage })
    useNutrition.persist.setOptions({ storage: persistStorage })
    let exported: Blob | undefined
    vi.stubGlobal('URL', { createObjectURL: (value: Blob) => { exported = value; return 'blob:backup' }, revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await exportBackup()
    expect(exported).toBeDefined()
    await db.coachRuns.clear()
    await importBackup(new File([await exported!.text()], 'exported.json'))

    await expect(db.coachConversations.get('conversation-1')).resolves.toMatchObject({ title: 'Primera' })
    await expect(db.coachDrafts.get('owner-a:conversation-1')).resolves.toMatchObject({ content: 'Borrador' })
    await expect(db.coachMessages.get('message-1')).resolves.toMatchObject({ sequence: 1 })
    await expect(db.coachRuns.get('run-1')).resolves.toMatchObject({ status: 'completed', legacy: true })
  })
})
