import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db, FerroDB } from '../db/db'
import type { CoachConsentRecord, CoachConversation, CoachDraft, CoachMessage, CoachProfile, CoachRunRecord } from '../db/types'
import { useNutrition } from '../stores/nutrition'
import { useSettings } from '../stores/settings'
import { exportBackup, importBackup, validateBackup } from './backup'
import { setCoachAccountId } from './coachAccount'
import { syncPendingCoachRuns } from './coachClient'
import { COACH_CONSENT_VERSION } from './coachConsent'
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
  context: { version: 'ctx-1', capturedAt: 1, timezone: 'America/Mexico_City', isCurrent: true, snapshot: { message: 'Hola', profileRevision: 1, consentVersion: 'coach-context-v3-gemini-nvidia', consentRevision: 1, profile: { population: [], populationConfirmed: false, goals: [] }, goals: [], restrictions: { injuriesOrPain: [], unavailableEquipment: [], excludedExercises: [], nutritionConstraints: [] }, catalog: [], metrics: { captured: false, bestE1rmByExercise: {} }, plan: [], history: [], conversation: [{ id: 'message-1', role: 'user', content: 'Hola', runId: 'run-1', createdAt: 1, contextVersion: 'ctx-1' }], conversationVersion: 'conversation-1:1' } },
}

const coachRecords = {
  coachProfiles: [{ id: 'owner-a', ownerId: 'owner-a', population: ['general'], populationConfirmed: true, goals: ['fuerza'], injuriesOrPain: [], unavailableEquipment: [], excludedExercises: [], nutritionConstraints: [], revision: 1, updatedAt: 1 }],
  coachConsents: [{ id: 'owner-a:device-a', ownerId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v3-gemini-nvidia', enabled: true, revision: 1, acceptedAt: 1, updatedAt: 1 }],
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
    const currentConsent = { id: 'owner-a:device-a', ownerId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v3-gemini-nvidia', enabled: true, revision: 99, acceptedAt: 90, updatedAt: 99 }
    await db.coachConsents.put(currentConsent)
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v3-gemini-nvidia', acceptedAt: 90, enabled: true }]))
    const backup = { ...base, version: 10 as const, ...coachRecords, coachConsents: [{ ...coachRecords.coachConsents[0], revision: 1, acceptedAt: 1, updatedAt: 1 }] }

    await importBackup(new File([JSON.stringify(backup)], 'consent.json'))

    await expect(db.coachConsents.get(currentConsent.id)).resolves.toEqual(currentConsent)
    expect(JSON.parse(localStorage.getItem('ferro-coach-consent')!)).toEqual([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v3-gemini-nvidia', acceptedAt: 90, enabled: true }])
  })

  it('rechaza cualquier backup Coach si no hay owner activo', async () => {
    setCoachAccountId(null)
    const backup = { ...base, version: 10 as const, ...coachRecords }

    await expect(importBackup(new File([JSON.stringify(backup)], 'owner-required.json'))).rejects.toThrow(/cuenta activa|owner/i)
    await expect(db.coachConversations.count()).resolves.toBe(0)
  })

  it('importa runs activos como legacy y no los despacha al despertar la sincronización', async () => {
    setCoachAccountId('owner-a')
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v3-gemini-nvidia', acceptedAt: 1, enabled: true }]))
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

  it('normaliza explícitamente un backup v7 al formato canónico v11', () => {
    const legacy = structuredClone({ ...base, version: 7 as const, ...coachRecords }) as unknown as ValidBackup
    delete legacy.coachRuns![0].endedAt
    delete legacy.coachMessages![0].sequence
    const normalized = normalizeBackup(legacy as never)

    expect(normalized.version).toBe(11)
    expect(normalized.coachRuns?.[0]).toMatchObject({ legacy: true, endedAt: 2, reconciliationState: 'reconciled' })
    expect(normalized.coachMessages?.[0]).toMatchObject({ sequence: 1 })
    expect(normalized.coachConversations?.[0]).toMatchObject({ nextSequence: 2 })
    expect(validateBackup(normalized)).toBeNull()
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const)('normaliza la versión histórica v%s a v11 sin perder colecciones', (version) => {
    const normalized = normalizeBackup({ ...base, version } as unknown as ValidBackup)
    expect(normalized.version).toBe(11)
    expect(normalized.coachRuns).toEqual([])
    expect(normalized.coachMessages).toEqual([])
    expect(normalized.routines).toEqual([])
  })

  it('exporta datos Coach reales y permite reimportarlos conservando las entidades', async () => {
    setCoachAccountId('owner-a')
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v3-gemini-nvidia', acceptedAt: 1, enabled: true }]))
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
    expect(JSON.parse(await exported!.text()).version).toBe(11)
    await db.coachRuns.clear()
    await importBackup(new File([await exported!.text()], 'exported.json'))

    await expect(db.coachConversations.get('conversation-1')).resolves.toMatchObject({ title: 'Primera' })
    await expect(db.coachDrafts.get('owner-a:conversation-1')).resolves.toMatchObject({ content: 'Borrador' })
    await expect(db.coachMessages.get('message-1')).resolves.toMatchObject({ sequence: 1 })
    await expect(db.coachRuns.get('run-1')).resolves.toMatchObject({ status: 'completed', legacy: true })
  })

  it.each([9, 10] as const)('importa v%s reparando conversación ausente y secuencias duplicadas o con huecos', async (version) => {
    setCoachAccountId('owner-a')
    const legacy = structuredClone({ ...base, version, ...coachRecords }) as unknown as ValidBackup
    delete legacy.coachRuns![0].conversationId
    delete legacy.coachRuns![0].request.event.conversationId
    delete legacy.coachRuns![0].endedAt
    legacy.coachRuns![0].request.context.snapshot.conversation = []
    legacy.coachDrafts = []
    legacy.coachConversations = []
    const message = legacy.coachMessages![0]
    delete message.conversationId
    delete message.deliveryState
    legacy.coachMessages = [{ ...message, id: 'z', sequence: 8 }, { ...message, id: 'a', sequence: 8 }, { ...message, id: 'c', createdAt: 2, sequence: 30 }]
    legacy.coachRuns![0].messageId = 'a'
    expect(validateBackup(legacy)).toBeNull()
    await importBackup(new File([JSON.stringify(legacy)], 'legacy.json'))
    const run = await db.coachRuns.get('run-1')
    expect(run).toMatchObject({ conversationId: 'coach-local-event-1', endedAt: 2, legacy: true })
    const messages = await db.coachMessages.orderBy('[conversationId+sequence]').toArray()
    expect(messages.map(({ id, sequence, deliveryState }) => ({ id, sequence, deliveryState }))).toEqual(['a', 'z', 'c'].map((id, index) => ({ id, sequence: index + 1, deliveryState: 'delivered' })))
    expect(await db.coachConversations.get(run!.conversationId!)).toMatchObject({ nextSequence: 4 })
  })

  it.each(['conversationId', 'reconciliationState', 'endedAt', 'ownerId'] as const)('exige %s en los runs v11', (field) => {
    const backup = structuredClone({ ...base, version: 11, ...coachRecords })
    expect(validateBackup(backup)).toBeNull()
    delete (backup.coachRuns[0] as Record<string, unknown>)[field]
    expect(validateBackup(backup)).not.toBeNull()
  })

  it.each(['conversationId', 'sequence', 'deliveryState', 'ownerId'] as const)('exige %s en los mensajes v11', (field) => {
    const backup = structuredClone({ ...base, version: 11, ...coachRecords })
    expect(validateBackup(backup)).toBeNull()
    delete (backup.coachMessages[0] as Record<string, unknown>)[field]
    expect(validateBackup(backup)).not.toBeNull()
  })

  it('rechaza relaciones entre mensajes y runs de conversaciones distintas en v11', () => {
    const backup = structuredClone({ ...base, version: 11, ...coachRecords })
    backup.coachConversations.push({ ...backup.coachConversations[0], id: 'other', nextSequence: 2 })
    backup.coachConversations[0].nextSequence = 1
    backup.coachMessages[0].conversationId = 'other'
    backup.coachRuns[0].request.context.snapshot.conversation = []
    expect(validateBackup(backup)).toMatch(/conversaci/i)
  })

  it('importa consentimientos como registros deshabilitados aunque el archivo autorice otro dispositivo', async () => {
    setCoachAccountId('owner-a')
    const backup = { ...base, version: 10, ...coachRecords, coachConsents: [...coachRecords.coachConsents, { ...coachRecords.coachConsents[0], id: 'owner-a:other-device', deviceId: 'other-device' }] }
    await importBackup(new File([JSON.stringify(backup)], 'consents.json'))
    expect(await db.coachConsents.toArray()).toEqual(backup.coachConsents.map((consent) => ({ ...consent, enabled: false })))
    expect(localStorage.getItem('ferro-coach-consent')).toBeNull()
  })

  it.each(['QuotaExceededError', 'DataError'])('revierte tablas y ajustes ante %s durante la escritura', async (name) => {
    setCoachAccountId('owner-a')
    const original = { ...base.workouts[0], name: 'Original' }
    await db.workouts.put(original)
    await db.coachConsents.put(coachRecords.coachConsents[0])
    const settingsBefore = useSettings.getState()
    const goalsBefore = useNutrition.getState().goals
    const fail = () => { throw new DOMException('fallo de almacenamiento', name) }
    db.coachMessages.hook('creating', fail)
    try {
      await expect(importBackup(new File([JSON.stringify({ ...base, version: 10, ...coachRecords })], 'rollback.json'))).rejects.toMatchObject({ name })
      expect(await db.workouts.toArray()).toEqual([original])
      expect(await db.coachConsents.toArray()).toEqual(coachRecords.coachConsents)
      expect(await db.coachConversations.count()).toBe(0)
      expect(await db.coachRuns.count()).toBe(0)
      expect(useSettings.getState()).toEqual(settingsBefore)
      expect(useNutrition.getState().goals).toEqual(goalsBefore)
    } finally {
      db.coachMessages.hook('creating').unsubscribe(fail)
    }
  })

  it('revierte IndexedDB y el estado local si falla la persistencia de Zustand', async () => {
    setCoachAccountId('owner-a')
    const original = { ...base.workouts[0], name: 'Original' }
    const originalConsent = { ...coachRecords.coachConsents[0], enabled: false, revision: 7, updatedAt: 7 }
    await db.workouts.put(original)
    await db.coachConsents.put(originalConsent)
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v3-gemini-nvidia', acceptedAt: 7, enabled: false }]))
    const settingsBefore = useSettings.getState()
    const nutritionBefore = useNutrition.getState()
    const settingsStorage = useSettings.persist.getOptions().storage
    const nutritionStorage = useNutrition.persist.getOptions().storage
    const quotaStorage = { getItem: () => null, setItem: () => { throw new DOMException('sin espacio', 'QuotaExceededError') }, removeItem: () => undefined }
    useSettings.persist.setOptions({ storage: quotaStorage })
    useNutrition.persist.setOptions({ storage: quotaStorage })
    const backup = { ...base, version: 11 as const, ...coachRecords, settings: { theme: settingsBefore.theme === 'dark' ? 'light' : 'dark' }, nutritionGoals: { kcal: nutritionBefore.goals.kcal + 1 } }

    try {
      await expect(importBackup(new File([JSON.stringify(backup)], 'quota-local-state.json'))).rejects.toMatchObject({ name: 'QuotaExceededError' })
      expect(await db.workouts.toArray()).toEqual([original])
      expect(await db.coachConsents.toArray()).toEqual([originalConsent])
      expect(useSettings.getState()).toEqual(settingsBefore)
      expect(useNutrition.getState()).toEqual(nutritionBefore)
    expect(localStorage.getItem('ferro-coach-consent')).toBe(JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: 'coach-context-v3-gemini-nvidia', acceptedAt: 7, enabled: false }]))
    } finally {
      useSettings.persist.setOptions({ storage: settingsStorage })
      useNutrition.persist.setOptions({ storage: nutritionStorage })
    }
  })

  it('restaura las claves crudas de localStorage si falla la segunda persistencia local', async () => {
    setCoachAccountId('owner-a')
    const original = { ...base.workouts[0], name: 'Original' }
    await db.workouts.put(original)
    const settingsRawBefore = JSON.stringify({ state: { theme: 'light' }, version: 0 })
    const nutritionRawBefore = JSON.stringify({ state: { goals: { kcal: 2400 } }, version: 0 })
    localStorage.setItem('ferro-settings', settingsRawBefore)
    localStorage.setItem('ferro-nutrition-goals', nutritionRawBefore)
    const settingsBefore = useSettings.getState()
    const nutritionBefore = useNutrition.getState()
    const settingsStorage = useSettings.persist.getOptions().storage
    const nutritionStorage = useNutrition.persist.getOptions().storage
    let writes = 0
    const firstSucceedsSecondFails = {
      getItem: () => null,
      setItem: (key: string, value: unknown) => {
        writes += 1
        if (writes === 2) throw new DOMException('sin espacio', 'QuotaExceededError')
        localStorage.setItem(key, JSON.stringify(value))
      },
      removeItem: (key: string) => localStorage.removeItem(key),
    }
    useSettings.persist.setOptions({ storage: firstSucceedsSecondFails })
    useNutrition.persist.setOptions({ storage: firstSucceedsSecondFails })
    const backup = { ...base, version: 11 as const, ...coachRecords, settings: { theme: 'dark' }, nutritionGoals: { kcal: nutritionBefore.goals.kcal + 1 } }

    try {
      await expect(importBackup(new File([JSON.stringify(backup)], 'quota-raw-local-state.json'))).rejects.toMatchObject({ name: 'QuotaExceededError' })
      expect(writes).toBe(2)
      expect(await db.workouts.toArray()).toEqual([original])
      expect(useSettings.getState()).toEqual(settingsBefore)
      expect(useNutrition.getState()).toEqual(nutritionBefore)
      expect(localStorage.getItem('ferro-settings')).toBe(settingsRawBefore)
      expect(localStorage.getItem('ferro-nutrition-goals')).toBe(nutritionRawBefore)
    } finally {
      useSettings.persist.setOptions({ storage: settingsStorage })
      useNutrition.persist.setOptions({ storage: nutritionStorage })
    }
  })

  it('hace prevalecer el consentimiento vigente de localStorage sobre una fila disabled importada', async () => {
    setCoachAccountId('owner-a')
    const current = { ...coachRecords.coachConsents[0], version: COACH_CONSENT_VERSION, enabled: false, revision: 9, updatedAt: 9 }
    await db.coachConsents.put(current)
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: COACH_CONSENT_VERSION, acceptedAt: 9, enabled: true }]))
    const imported = { ...coachRecords.coachConsents[0], enabled: true, revision: 999, updatedAt: 999 }

    await importBackup(new File([JSON.stringify({ ...base, version: 11, ...coachRecords, coachConsents: [imported] })], 'consent-authority.json'))

    expect(await db.coachConsents.get(current.id)).toEqual({ ...current, enabled: true })
    expect(localStorage.getItem('ferro-coach-consent')).toBe(JSON.stringify([{ userId: 'owner-a', deviceId: 'device-a', version: COACH_CONSENT_VERSION, acceptedAt: 9, enabled: true }]))
  })

  it.each([9, 10] as const)('reimporta el contenido de una base v%s migrada, incluidos los IDs de mensajes históricos', async (version) => {
    setCoachAccountId('owner-a')
    const name = `backup-migration-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(version).stores({ coachRuns: 'id, ownerId, eventId', coachMessages: 'id, ownerId, runId' })
    const oldRun = structuredClone(coachRecords.coachRuns[0]) as unknown as CoachRunRecord
    delete oldRun.conversationId
    delete oldRun.request.event.conversationId
    delete oldRun.reconciliationState
    delete oldRun.endedAt
    oldRun.appliedAt = 1.5
    oldRun.messageId = 'coach-message-coach-local-event-1'
    oldRun.request.context.snapshot!.conversation = [{ ...coachRequest.context.snapshot.conversation[0], role: 'user', id: oldRun.messageId, runId: 'coach-local-event-1' }]
    const oldMessage = { ...coachRecords.coachMessages[0], id: oldRun.messageId, runId: 'coach-local-event-1', conversationId: undefined, sequence: undefined, deliveryState: undefined }
    await old.open()
    await old.table('coachRuns').put(oldRun)
    await old.table('coachMessages').put(oldMessage)
    old.close()
    const upgraded = new FerroDB(name)
    try {
      await upgraded.open()
      const payload = { ...base, version: 11, coachRuns: await upgraded.coachRuns.toArray(), coachMessages: await upgraded.coachMessages.toArray(), coachConversations: await upgraded.coachConversations.toArray() }
      expect(validateBackup(payload)).toBeNull()
      await importBackup(new File([JSON.stringify(payload)], 'migrated.json'))
      expect(await db.coachMessages.get(oldMessage.id)).toMatchObject({ id: oldMessage.id, runId: oldRun.id, content: oldMessage.content, createdAt: oldMessage.createdAt })
    } finally {
      upgraded.close()
      await Dexie.delete(name)
    }
  })

  it('repara referencias locales v9 que apuntaban a un run sustituido por su ID remoto', async () => {
    setCoachAccountId('owner-a')
    const legacy = structuredClone({ ...base, version: 9, ...coachRecords })
    legacy.coachMessages[0].runId = 'coach-local-event-1'
    legacy.coachMessages[0].id = 'coach-message-coach-local-event-1'
    legacy.coachRuns[0].messageId = legacy.coachMessages[0].id
    legacy.coachRuns[0].request.context.snapshot.conversation = [{ ...legacy.coachRuns[0].request.context.snapshot.conversation[0], id: legacy.coachMessages[0].id, runId: 'coach-local-event-1' }]
    await importBackup(new File([JSON.stringify(legacy)], 'legacy-reference.json'))
    expect(await db.coachMessages.get(legacy.coachMessages[0].id)).toMatchObject({ runId: 'run-1', content: 'Hola' })
  })

  it('normaliza los valores por defecto de requests históricos antes de restaurarlos', async () => {
    setCoachAccountId('owner-a')
    const backup = structuredClone({ ...base, version: 9, ...coachRecords }) as unknown as ValidBackup
    delete (backup.coachRuns![0].request.context as Record<string, unknown>).snapshot
    await importBackup(new File([JSON.stringify(backup)], 'default-snapshot.json'))
    expect(await db.coachRuns.get('run-1')).toMatchObject({ request: { context: { snapshot: { conversation: [] } } } })
  })

  it.each([9, 10])('completa endedAt en v%s sin adelantarlo respecto de appliedAt', async (version) => {
    setCoachAccountId('owner-a')
    const backup = structuredClone({ ...base, version, ...coachRecords }) as unknown as ValidBackup
    delete backup.coachRuns![0].endedAt
    backup.coachRuns![0].appliedAt = 1.5
    await importBackup(new File([JSON.stringify(backup)], 'applied.json'))
    expect(await db.coachRuns.get('run-1')).toMatchObject({ endedAt: 1.5, appliedAt: 1.5, updatedAt: 2 })
  })

  it('conserva el contenido literal y los timestamps al normalizar e importar', async () => {
    setCoachAccountId('owner-a')
    const backup = structuredClone({ ...base, version: 10, ...coachRecords })
    backup.coachMessages[0].content = '  Primera línea\nSegunda línea  '
    backup.coachRuns[0].request.context.snapshot.conversation[0].content = backup.coachMessages[0].content
    backup.workouts[0].name = '  Push  '
    await importBackup(new File([JSON.stringify(backup)], 'literal-content.json'))
    expect(await db.coachMessages.get('message-1')).toMatchObject(backup.coachMessages[0])
    expect(await db.coachRuns.get('run-1')).toMatchObject({ request: backup.coachRuns[0].request, createdAt: 1, updatedAt: 2, endedAt: 2 })
    expect(await db.workouts.get('w1')).toMatchObject({ name: backup.workouts[0].name })
  })

  it.each(['runId', 'conversationId'] as const)('rechaza una referencia %s inválida en v11 conservando toda la base', async (field) => {
    setCoachAccountId('owner-a')
    await db.workouts.put({ ...base.workouts[0], name: 'Original' })
    await db.coachConsents.put(coachRecords.coachConsents[0])
    const backup = structuredClone({ ...base, version: 11, ...coachRecords })
    backup.coachMessages[0][field] = 'inexistente'
    await expect(importBackup(new File([JSON.stringify(backup)], 'invalid-reference.json'))).rejects.toThrow(/no se ha modificado/)
    expect(await db.workouts.get('w1')).toMatchObject({ name: 'Original' })
    expect(await db.coachConsents.toArray()).toEqual(coachRecords.coachConsents)
    expect(await db.coachRuns.count()).toBe(0)
    expect(await db.coachConversations.count()).toBe(0)
  })

  it('acepta y conserva snapshots parciales persistidos por el transporte', async () => {
    setCoachAccountId('owner-a')
    const run = { ...coachRecords.coachRuns[0], snapshotSequence: 4, partialExplanation: 'Respuesta parcial' }
    const backup = { ...base, version: 11, ...coachRecords, coachRuns: [run] }
    expect(validateBackup(backup)).toBeNull()
    await importBackup(new File([JSON.stringify(backup)], 'snapshot.json'))
    expect(await db.coachRuns.get(run.id)).toMatchObject({ snapshotSequence: 4, partialExplanation: 'Respuesta parcial' })
  })

  it.each([true, false])('el consentimiento local enabled=%s prevalece sobre el importado aunque tenga revisión mayor', async (enabled) => {
    setCoachAccountId('owner-a')
    const local = { ...coachRecords.coachConsents[0], enabled, revision: 5, updatedAt: 5 }
    await db.coachConsents.put(local)
    const imported = { ...local, enabled: true, revision: 999, updatedAt: 999 }
    await importBackup(new File([JSON.stringify({ ...base, version: 11, ...coachRecords, coachConsents: [imported] })], 'consent-conflict.json'))
    expect(await db.coachConsents.get(local.id)).toEqual(local)
  })

  it.each([{ sequences: [1, 1] }, { sequences: [1, 3] }])('rechaza secuencias v11 inválidas $sequences sin modificar datos', async ({ sequences }) => {
    setCoachAccountId('owner-a')
    const original = { ...base.workouts[0], name: 'Original' }
    await db.workouts.put(original)
    const backup = { ...base, version: 11, ...coachRecords, coachMessages: sequences.map((sequence, index) => ({ ...coachRecords.coachMessages[0], id: index ? 'second' : 'message-1', sequence })), coachConversations: [{ ...coachRecords.coachConversations[0], nextSequence: 4 }] }
    expect(validateBackup(backup)).not.toBeNull()
    await expect(importBackup(new File([JSON.stringify(backup)], 'sequences.json'))).rejects.toThrow(/no se ha modificado/)
    expect(await db.workouts.toArray()).toEqual([original])
  })
})
