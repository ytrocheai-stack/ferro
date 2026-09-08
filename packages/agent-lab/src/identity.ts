import { createHash } from 'node:crypto'

export function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

export function stableAuthorizationIdentity(auth: { model: string; maxCalls: number; maxInputTokens: number; maxOutputTokens: number; timeoutMs: number; maxTotalCalls: number; maxTotalInputTokens: number; maxTotalOutputTokens: number }): Pick<typeof auth, 'model' | 'maxCalls' | 'maxInputTokens' | 'maxOutputTokens' | 'timeoutMs' | 'maxTotalCalls' | 'maxTotalInputTokens' | 'maxTotalOutputTokens'> {
  return { model: auth.model, maxCalls: auth.maxCalls, maxInputTokens: auth.maxInputTokens, maxOutputTokens: auth.maxOutputTokens, timeoutMs: auth.timeoutMs, maxTotalCalls: auth.maxTotalCalls, maxTotalInputTokens: auth.maxTotalInputTokens, maxTotalOutputTokens: auth.maxTotalOutputTokens }
}
