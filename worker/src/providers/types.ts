import type { D1Database } from '../index'

export type ProviderName = 'gemini' | 'nvidia'

export type ProviderDatabase = D1Database

export interface ProviderQuotaResult {
  reserved: boolean
  retryAt?: number
  minuteKey?: number
  pacificDay?: string
  estimatedInputTokens?: number
}

export class ProviderQuotaError extends Error {
  constructor(message: string, public readonly code: 'invalid-config' | 'cancelled' | 'database' = 'database') {
    super(message)
    this.name = 'ProviderQuotaError'
  }
}

export function changed(result: { meta?: { changes?: number } }): boolean {
  return result.meta?.changes === 1
}
