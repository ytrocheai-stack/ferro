/** Una sola reserva atómica para Node y Worker. No se devuelven reservas inciertas. */
export const GLOBAL_REQUEST_RESERVATION_SQL = `UPDATE provider_request_limits
SET next_allowed_at = ?, used_requests = used_requests + 1
WHERE provider = 'nvidia' AND next_allowed_at <= ?`

export const GLOBAL_REQUEST_DEFER_SQL = `UPDATE provider_request_limits
SET next_allowed_at = MAX(next_allowed_at, ?)
WHERE provider = 'nvidia'`

export function requestReservationValues(now: number, rpm: number): [number, number] {
  if (!Number.isSafeInteger(rpm) || rpm < 1 || rpm > 40) throw new Error('Límite global NVIDIA inválido')
  return [now + Math.ceil(60_000 / rpm), now]
}

export function requestDeferValues(now: number, retryAfterMs: number): [number] {
  if (!Number.isFinite(now) || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new Error('Retry-After NVIDIA inválido')
  return [now + retryAfterMs]
}
