import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { importBackup, validateBackup } from './backup'

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
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    await db.delete()
    await db.open()
  })

  afterEach(() => vi.unstubAllGlobals())

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
    const backup = { ...base, version: 10 as const, ...coachRecords }
    expect(validateBackup(backup)).toBeNull()
    await importBackup(new File([JSON.stringify(backup)], 'coach.json'))
    await expect(db.coachConversations.get('conversation-1')).resolves.toMatchObject({ title: 'Primera', nextSequence: 2 })
    await expect(db.coachMessages.get('message-1')).resolves.toMatchObject({ conversationId: 'conversation-1', sequence: 1 })
    await expect(db.coachDrafts.get('owner-a:conversation-1')).resolves.toMatchObject({ content: 'Borrador' })
    await expect(db.coachRuns.get('run-1')).resolves.toMatchObject({ status: 'completed', conversationId: 'conversation-1' })
  })

  it('revierte toda la importación cuando una escritura Coach falla', async () => {
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
})
