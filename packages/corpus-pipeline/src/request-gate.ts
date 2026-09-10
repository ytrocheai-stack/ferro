/** Una sola reserva atómica para Node y Worker. No se devuelven reservas inciertas. */
export const GLOBAL_REQUEST_RESERVATION_SQL = `UPDATE provider_request_limits
SET next_allowed_at = ?, used_requests = used_requests + 1
WHERE provider = 'nvidia' AND next_allowed_at <= ? AND used_requests < max_requests`

export function requestReservationValues(now: number, rpm: number): [number, number] {
  if (!Number.isSafeInteger(rpm) || rpm < 1 || rpm > 40) throw new Error('Límite global NVIDIA inválido')
  return [now + Math.ceil(60_000 / rpm), now]
}
