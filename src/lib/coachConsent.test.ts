import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COACH_CONSENT_VERSION, getCoachConsent } from './coachConsent'

describe('versión de consentimiento del coach', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    localStorage.setItem('ferro-coach-device-id', 'device-1')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('requiere volver a aceptar un consentimiento v3 habilitado', () => {
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{
      userId: 'user-1',
      deviceId: 'device-1',
      version: 'coach-context-v3-gemini-nvidia',
      acceptedAt: 1,
      enabled: true,
    }]))

    expect(COACH_CONSENT_VERSION).toBe('coach-context-v4-gemini-nvidia-embeddings')
    expect(getCoachConsent('user-1')).toBeNull()
  })

  it('reconoce el consentimiento vigente para esta cuenta y dispositivo', () => {
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{
      userId: 'user-1',
      deviceId: 'device-1',
      version: COACH_CONSENT_VERSION,
      acceptedAt: 1,
      enabled: true,
    }]))

    expect(getCoachConsent('user-1')).toMatchObject({ version: COACH_CONSENT_VERSION, enabled: true })
  })
})
