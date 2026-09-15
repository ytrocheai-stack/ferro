import { ProviderQuotaError, changed, type ProviderDatabase, type ProviderName } from './types'

export interface ProviderCircuitOptions {
  failureThreshold?: number
  cooldownMs?: number
  halfOpenLeaseMs?: number
}

export type CircuitPermission = 'closed' | 'half-open' | 'open'

export interface CircuitState {
  provider: ProviderName
  consecutive_failures: number
  opened_at: number | null
  cooldown_until: number
  half_open_lease_id: string | null
  half_open_lease_until: number | null
}

const DEFAULT_FAILURE_THRESHOLD = 3
const DEFAULT_COOLDOWN_MS = 60_000
const DEFAULT_HALF_OPEN_LEASE_MS = 30_000

function positive(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new ProviderQuotaError(`Configuración de circuito inválida: ${name}`, 'invalid-config')
  return result
}

function circuitOptions(options: ProviderCircuitOptions = {}) {
  return {
    failureThreshold: positive(options.failureThreshold, DEFAULT_FAILURE_THRESHOLD, 'failureThreshold'),
    cooldownMs: positive(options.cooldownMs, DEFAULT_COOLDOWN_MS, 'cooldownMs'),
    halfOpenLeaseMs: positive(options.halfOpenLeaseMs, DEFAULT_HALF_OPEN_LEASE_MS, 'halfOpenLeaseMs'),
  }
}

async function ensureCircuitRow(db: ProviderDatabase, provider: ProviderName): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO provider_circuit_state(provider) VALUES (?)').bind(provider).run()
}

function leaseId(provider: ProviderName, now: number): string {
  // No contiene secretos ni datos del usuario; la unicidad local basta para el
  // lease CAS y evita depender de crypto.randomUUID en runtimes de test antiguos.
  return `${provider}:${now}:${Math.random().toString(36).slice(2)}`
}

export async function acquireProviderCircuit(db: ProviderDatabase, provider: ProviderName, now: number, options: ProviderCircuitOptions = {}): Promise<{ permission: CircuitPermission; leaseId?: string; retryAt?: number }> {
  if (!Number.isFinite(now)) throw new ProviderQuotaError('Marca de tiempo inválida', 'invalid-config')
  const config = circuitOptions(options)
  await ensureCircuitRow(db, provider)
  const current = await db.prepare('SELECT opened_at, cooldown_until, half_open_lease_until FROM provider_circuit_state WHERE provider = ?').bind(provider).first<{ opened_at: number | null; cooldown_until: number; half_open_lease_until: number | null }>()
  if (current?.opened_at === null || current?.opened_at === undefined) return { permission: 'closed' }
  const id = leaseId(provider, now)
  const result = await db.prepare(`UPDATE provider_circuit_state
    SET half_open_lease_id = ?, half_open_lease_until = ?, updated_at = ?
    WHERE provider = ? AND (
      opened_at IS NULL OR
      (cooldown_until <= ? AND (half_open_lease_until IS NULL OR half_open_lease_until <= ?))
    )`).bind(id, now + config.halfOpenLeaseMs, now, provider, now, now).run()
  if (changed(result)) return { permission: 'half-open', leaseId: id }
  const state = await db.prepare('SELECT cooldown_until, half_open_lease_until FROM provider_circuit_state WHERE provider = ?').bind(provider).first<{ cooldown_until: number; half_open_lease_until: number | null }>()
  return { permission: 'open', retryAt: Math.max(state?.cooldown_until ?? now + config.cooldownMs, state?.half_open_lease_until ?? 0) }
}

export async function recordProviderSuccess(db: ProviderDatabase, provider: ProviderName, now: number, leaseId?: string): Promise<void> {
  await db.prepare(`UPDATE provider_circuit_state SET consecutive_failures = 0, opened_at = NULL, cooldown_until = 0,
    half_open_lease_id = NULL, half_open_lease_until = NULL, updated_at = ?
    WHERE provider = ? AND (
      (opened_at IS NULL AND half_open_lease_id IS NULL AND ? IS NULL) OR
      (opened_at IS NOT NULL AND half_open_lease_id = ? AND ? IS NOT NULL)
    )`)
    .bind(now, provider, leaseId ?? null, leaseId ?? null, leaseId ?? null).run()
}

export async function recordProviderFailure(db: ProviderDatabase, provider: ProviderName, now: number, retryAfterMs = 0, options: ProviderCircuitOptions = {}, leaseId?: string): Promise<CircuitState> {
  if (!Number.isFinite(now) || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new ProviderQuotaError('Retry-After inválido', 'invalid-config')
  const config = circuitOptions(options)
  await ensureCircuitRow(db, provider)
  const cooldownUntil = now + Math.max(config.cooldownMs, retryAfterMs)
  await db.prepare(`UPDATE provider_circuit_state
    SET consecutive_failures = consecutive_failures + 1,
        opened_at = CASE WHEN consecutive_failures + 1 >= ? OR ? > 0 THEN ? ELSE opened_at END,
        cooldown_until = CASE WHEN consecutive_failures + 1 >= ? OR ? > 0 THEN MAX(cooldown_until, ?) ELSE cooldown_until END,
        half_open_lease_id = NULL,
        half_open_lease_until = NULL,
        updated_at = ? WHERE provider = ?
      AND ((half_open_lease_id IS NULL AND ? IS NULL) OR half_open_lease_id = ?)`)
    .bind(config.failureThreshold, retryAfterMs, now, config.failureThreshold, retryAfterMs, cooldownUntil, now, provider, leaseId ?? null, leaseId ?? null).run()
  const row = await db.prepare('SELECT provider, consecutive_failures, opened_at, cooldown_until, half_open_lease_id, half_open_lease_until FROM provider_circuit_state WHERE provider = ?').bind(provider).first<CircuitState>()
  if (!row) throw new ProviderQuotaError('No se pudo leer el circuito del proveedor')
  return row
}

export async function openProviderCircuitUntil(db: ProviderDatabase, provider: ProviderName, now: number, retryAfterMs: number, leaseId?: string): Promise<void> {
  if (!Number.isFinite(now) || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new ProviderQuotaError('Retry-After inválido', 'invalid-config')
  await ensureCircuitRow(db, provider)
  await db.prepare(`UPDATE provider_circuit_state
    SET opened_at = COALESCE(opened_at, ?), cooldown_until = MAX(cooldown_until, ?),
        half_open_lease_id = NULL, half_open_lease_until = NULL, updated_at = ?
    WHERE provider = ? AND ((half_open_lease_id IS NULL AND ? IS NULL) OR half_open_lease_id = ?)`)
    .bind(now, now + retryAfterMs, now, provider, leaseId ?? null, leaseId ?? null).run()
}

export class DurableProviderCircuit {
  constructor(private readonly db: ProviderDatabase, private readonly provider: ProviderName, private readonly options: ProviderCircuitOptions = {}) {}
  acquire(now = Date.now()): Promise<{ permission: CircuitPermission; leaseId?: string; retryAt?: number }> { return acquireProviderCircuit(this.db, this.provider, now, this.options) }
  success(now = Date.now(), leaseId?: string): Promise<void> { return recordProviderSuccess(this.db, this.provider, now, leaseId) }
  failure(now = Date.now(), retryAfterMs = 0, leaseId?: string): Promise<CircuitState> { return recordProviderFailure(this.db, this.provider, now, retryAfterMs, this.options, leaseId) }
}
