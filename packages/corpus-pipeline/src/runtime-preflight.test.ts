import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const gateState = vi.hoisted(() => ({ configFile: '' }))

vi.mock('./remote-request-gate.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./remote-request-gate.ts')>()
  return {
    ...original,
    preflightRemoteRequest: (configFile?: URL | string) => original.preflightRemoteRequest(configFile ?? gateState.configFile),
  }
})

import { EMBEDDING_MODEL, FLASH_MODEL, ProviderSession, type Authorization } from './runtime'

const authorization = (): Authorization => ({
  accessVerified: true,
  budgetVerified: true,
  maxAdditionalCost: 0,
  verifiedAt: new Date().toISOString(),
  reviewer: 'test',
  evidence: 'local fixture',
  model: FLASH_MODEL,
  embeddingModel: EMBEDDING_MODEL,
  maxCalls: 2,
  maxInputTokens: 20000,
  maxOutputTokens: 1200,
  timeoutMs: 1000,
  maxTotalCalls: 4,
  maxTotalInputTokens: 50000,
  maxTotalOutputTokens: 4000,
})

describe('preflight del coordinador remoto', () => {
  it('no persiste un intento pendiente ni despacha NVIDIA si falta la configuración D1', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'provider-preflight-'))
    gateState.configFile = path.join(root, 'provider-coordinator.json')
    const directory = path.join(root, 'provider-ledger')
    const dispatch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', dispatch)

    try {
      const session = new ProviderSession({ directory, authorization: authorization(), apiKey: 'test' })
      await expect(session.generate('consulta', 1200, undefined, 'missing-coordinator')).rejects.toThrow('Falta coordinador global D1 válido')
      expect(session.report().calls).toBe(0)
      expect(existsSync(path.join(directory, 'ledger.json'))).toBe(false)
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
