import { ProviderQuotaError, changed, type ProviderDatabase, type ProviderName, type ProviderQuotaResult } from './types'

export const NVIDIA_DEFAULT_REQUESTS_PER_MINUTE = 40
export const NVIDIA_MIN_DISPATCH_INTERVAL_MS = 1_500
export const GEMINI_PACIFIC_TIME_ZONE = 'America/Los_Angeles'
export const GEMINI_ESTIMATE_BYTES_PER_TOKEN = 3
export const GEMINI_ESTIMATE_FIXED_MARGIN_TOKENS = 64

export interface GeminiQuotaLimits {
  requestsPerMinute: number
  inputTokensPerMinute: number
  requestsPerDay: number
}

export interface GeminiQuotaReservation extends ProviderQuotaResult {
  provider: 'gemini'
  reservationId: string
  minuteKey: number
  pacificDay: string
  estimatedInputTokens: number
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new ProviderQuotaError(`Configuración de cuota inválida: ${name}`, 'invalid-config')
  return value
}

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new ProviderQuotaError(`Estimación de cuota inválida: ${name}`, 'invalid-config')
  return value
}

function requireNvidiaRpm(requestsPerMinute: number): number {
  const rpm = positiveSafeInteger(requestsPerMinute, 'NVIDIA_REQUESTS_PER_MINUTE')
  if (rpm > NVIDIA_DEFAULT_REQUESTS_PER_MINUTE) throw new ProviderQuotaError('NVIDIA_REQUESTS_PER_MINUTE excede el límite global de 40', 'invalid-config')
  return rpm
}

function pacificDayKey(now: number): string {
  if (!Number.isFinite(now)) throw new ProviderQuotaError('Marca de tiempo inválida', 'invalid-config')
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: GEMINI_PACIFIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function geminiPacificDayKey(now: number): string { return pacificDayKey(now) }

export function estimateGeminiInputTokens(serializedRequest: string): number {
  if (typeof serializedRequest !== 'string') throw new ProviderQuotaError('Request Gemini no serializado', 'invalid-config')
  // La entrada es el JSON completo que se enviará: incluye instrucciones del
  // sistema, contenido del usuario, configuración y esquema. La base combina
  // bytes UTF-8 (Unicode multibyte) con escalares Unicode (puntuación densa y
  // símbolos que pueden tokenizarse individualmente); el margen fijo cubre
  // fronteras de tokenización. Es una cota de presupuesto documentada, no una
  // afirmación de que bytes/3 sea el tokenizer ni una llamada a countTokens.
  const utf8Bytes = new TextEncoder().encode(serializedRequest).byteLength
  const unicodeScalars = Array.from(serializedRequest).length
  return Math.max(1, Math.max(Math.ceil(utf8Bytes / GEMINI_ESTIMATE_BYTES_PER_TOKEN), unicodeScalars) + GEMINI_ESTIMATE_FIXED_MARGIN_TOKENS)
}

export function parseGeminiPromptTokenCount(usageMetadata: unknown): number | undefined {
  if (!usageMetadata || typeof usageMetadata !== 'object') return undefined
  const value = (usageMetadata as { promptTokenCount?: unknown }).promptTokenCount
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

async function ensureNvidiaRow(db: ProviderDatabase): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO provider_request_limits (provider, next_allowed_at, used_requests, max_requests) VALUES ('nvidia', 0, 0, 0)").run()
}

export function nvidiaDispatchIntervalMs(requestsPerMinute: number): number {
  const rpm = requireNvidiaRpm(requestsPerMinute)
  return Math.max(NVIDIA_MIN_DISPATCH_INTERVAL_MS, Math.ceil(60_000 / rpm))
}

/**
 * Reserva una solicitud NVIDIA en una única actualización condicional global.
 * max_requests no aparece deliberadamente en el WHERE: used_requests es sólo
 * diagnóstico histórico, nunca un saldo que pueda bloquear el proveedor.
 */
export async function reserveNvidiaRequest(db: ProviderDatabase, now: number, requestsPerMinute = NVIDIA_DEFAULT_REQUESTS_PER_MINUTE): Promise<ProviderQuotaResult> {
  if (!Number.isFinite(now)) throw new ProviderQuotaError('Marca de tiempo inválida', 'invalid-config')
  await ensureNvidiaRow(db)
  const interval = nvidiaDispatchIntervalMs(requestsPerMinute)
  const result = await db.prepare(`UPDATE provider_request_limits
    SET next_allowed_at = MAX(next_allowed_at, ?) + ?, used_requests = used_requests + 1
    WHERE provider = 'nvidia' AND next_allowed_at <= ?`).bind(now, interval, now).run()
  if (changed(result)) return { reserved: true, retryAt: now + interval }
  const row = await db.prepare("SELECT next_allowed_at FROM provider_request_limits WHERE provider = 'nvidia'").first<{ next_allowed_at: number }>()
  return { reserved: false, retryAt: row?.next_allowed_at }
}

export async function deferNvidiaRequest(db: ProviderDatabase, now: number, retryAfterMs: number): Promise<void> {
  if (!Number.isFinite(now) || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new ProviderQuotaError('Retry-After inválido', 'invalid-config')
  await ensureNvidiaRow(db)
  await db.prepare("UPDATE provider_request_limits SET next_allowed_at = MAX(next_allowed_at, ?) WHERE provider = 'nvidia'").bind(now + retryAfterMs).run()
}

export async function waitForNvidiaRequest(db: ProviderDatabase, options: { now?: () => number; requestsPerMinute?: number; signal?: AbortSignal; sleep?: (milliseconds: number) => Promise<void> } = {}): Promise<void> {
  const clock = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  while (true) {
    if (options.signal?.aborted) throw new ProviderQuotaError('Solicitud cancelada antes de reservar NVIDIA', 'cancelled')
    const now = clock()
    const reservation = await reserveNvidiaRequest(db, now, options.requestsPerMinute)
    if (reservation.reserved) return
    const delay = Math.max(1, (reservation.retryAt ?? now + NVIDIA_MIN_DISPATCH_INTERVAL_MS) - clock())
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const abort = () => { if (!settled) { settled = true; reject(new ProviderQuotaError('Solicitud cancelada antes de reservar NVIDIA', 'cancelled')) } }
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) { abort(); return }
      void sleep(delay).then(() => {
        if (settled) return
        settled = true
        options.signal?.removeEventListener('abort', abort)
        resolve()
      }, reject)
    })
  }
}

function validateGeminiLimits(limits: GeminiQuotaLimits): GeminiQuotaLimits {
  return {
    requestsPerMinute: positiveSafeInteger(limits.requestsPerMinute, 'GEMINI_REQUESTS_PER_MINUTE'),
    inputTokensPerMinute: positiveSafeInteger(limits.inputTokensPerMinute, 'GEMINI_INPUT_TOKENS_PER_MINUTE'),
    requestsPerDay: positiveSafeInteger(limits.requestsPerDay, 'GEMINI_REQUESTS_PER_DAY'),
  }
}

/**
 * Reserva las tres dimensiones Gemini con un único UPDATE condicional. Las
 * ventanas se reinician al cambiar la ventana de minuto o el día civil del
 * Pacífico, de manera atómica con la reserva.
 */
function newReservationId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `gemini:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

export async function reserveGeminiRequest(db: ProviderDatabase, now: number, estimatedInputTokens: number, limits: GeminiQuotaLimits, reservationId = newReservationId()): Promise<GeminiQuotaReservation> {
  if (!Number.isFinite(now)) throw new ProviderQuotaError('Marca de tiempo inválida', 'invalid-config')
  const safeEstimate = nonNegativeSafeInteger(estimatedInputTokens, 'input tokens')
  const safeLimits = validateGeminiLimits(limits)
  if (!reservationId.trim()) throw new ProviderQuotaError('Identificador de reserva Gemini inválido', 'invalid-config')
  const minuteKey = Math.floor(now / 60_000)
  const pacificDay = pacificDayKey(now)
  const result = await db.prepare(`UPDATE gemini_quota_state
    SET minute_key = ?,
        minute_requests = CASE WHEN minute_key = ? THEN minute_requests + 1 ELSE 1 END,
        minute_input_tokens = CASE WHEN minute_key = ? THEN minute_input_tokens + ? ELSE ? END,
        pacific_day = ?,
        day_requests = CASE WHEN pacific_day = ? THEN day_requests + 1 ELSE 1 END,
        updated_at = ?
    WHERE id = 1
      AND (CASE WHEN minute_key = ? THEN minute_requests ELSE 0 END) < ?
      AND (CASE WHEN minute_key = ? THEN minute_input_tokens ELSE 0 END) + ? <= ?
      AND (CASE WHEN pacific_day = ? THEN day_requests ELSE 0 END) < ?`).bind(
    minuteKey, minuteKey, minuteKey, safeEstimate, safeEstimate, pacificDay, pacificDay, now,
    minuteKey, safeLimits.requestsPerMinute, minuteKey, safeEstimate, safeLimits.inputTokensPerMinute,
    pacificDay, safeLimits.requestsPerDay,
  ).run()
  if (!changed(result)) return { reserved: false, provider: 'gemini', reservationId, minuteKey, pacificDay, estimatedInputTokens: safeEstimate }
  return { reserved: true, provider: 'gemini', reservationId, minuteKey, pacificDay, estimatedInputTokens: safeEstimate }
}

/** Reconciliación del uso de entrada de una reserva Gemini. */
export async function reconcileGeminiInputTokens(db: ProviderDatabase, reservation: GeminiQuotaReservation, usageMetadata: unknown, now: number): Promise<{ inputTokens: number; estimated: boolean }> {
  if (!reservation.reserved) throw new ProviderQuotaError('No se puede reconciliar una reserva Gemini no concedida', 'invalid-config')
  const measured = parseGeminiPromptTokenCount(usageMetadata)
  type ReconciliationRow = { measured_input_tokens: number | null; usage_incomplete: number; state_applied: number }
  const existing = await db.prepare('SELECT measured_input_tokens, usage_incomplete, state_applied FROM gemini_quota_reconciliations WHERE reservation_id = ?').bind(reservation.reservationId).first<ReconciliationRow>()
  if (existing?.state_applied === 1) return { inputTokens: existing.measured_input_tokens ?? reservation.estimatedInputTokens, estimated: existing.usage_incomplete === 1 }

  // INSERT + contador + finalización del marcador forman una transacción D1.
  // El UPDATE lee los valores del marcador, así un reintento de un marcador
  // pendiente conserva exactamente el usageMetadata original.
  const statements = [
    db.prepare(`INSERT OR IGNORE INTO gemini_quota_reconciliations
      (reservation_id, minute_key, estimated_input_tokens, measured_input_tokens, usage_incomplete, reconciled_at, state_applied, state_applied_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`)
      .bind(reservation.reservationId, reservation.minuteKey, reservation.estimatedInputTokens, measured ?? null, measured === undefined ? 1 : 0, now),
    db.prepare(`UPDATE gemini_quota_state
      SET minute_input_tokens = CASE
            WHEN minute_key = ? AND (SELECT measured_input_tokens FROM gemini_quota_reconciliations WHERE reservation_id = ? ) IS NOT NULL
              THEN MAX(0, minute_input_tokens + (SELECT measured_input_tokens - estimated_input_tokens FROM gemini_quota_reconciliations WHERE reservation_id = ?))
            ELSE minute_input_tokens
          END,
          input_tokens_estimated = input_tokens_estimated + (SELECT estimated_input_tokens FROM gemini_quota_reconciliations WHERE reservation_id = ?),
          input_tokens_measured = input_tokens_measured + COALESCE((SELECT measured_input_tokens FROM gemini_quota_reconciliations WHERE reservation_id = ?), 0),
          usage_incomplete = CASE WHEN usage_incomplete = 1 OR (SELECT usage_incomplete FROM gemini_quota_reconciliations WHERE reservation_id = ?) = 1 THEN 1 ELSE 0 END,
          updated_at = ?
      WHERE id = 1 AND EXISTS (SELECT 1 FROM gemini_quota_reconciliations WHERE reservation_id = ? AND state_applied = 0)`)
      .bind(reservation.minuteKey, reservation.reservationId, reservation.reservationId, reservation.reservationId, reservation.reservationId, reservation.reservationId, now, reservation.reservationId),
    db.prepare(`UPDATE gemini_quota_reconciliations SET state_applied = 1, state_applied_at = ? WHERE reservation_id = ? AND state_applied = 0`)
      .bind(now, reservation.reservationId),
  ]
  if (typeof db.batch !== 'function') {
    await statements[0].run()
    throw new ProviderQuotaError('D1.batch no está disponible; reconciliación queda pendiente', 'database')
  }
  await db.batch(statements)
  const completed = await db.prepare('SELECT measured_input_tokens, usage_incomplete, state_applied FROM gemini_quota_reconciliations WHERE reservation_id = ?').bind(reservation.reservationId).first<ReconciliationRow>()
  if (!completed || completed.state_applied !== 1) throw new ProviderQuotaError('Reconciliación Gemini pendiente de aplicar', 'database')
  return { inputTokens: completed.measured_input_tokens ?? reservation.estimatedInputTokens, estimated: completed.usage_incomplete === 1 }
}

export type { ProviderName }
