import { readFileSync } from 'node:fs'
import { GLOBAL_REQUEST_DEFER_SQL, GLOBAL_REQUEST_RESERVATION_SQL, requestDeferValues, requestReservationValues } from './request-gate.ts'

interface RemoteCoordinator { accountId: string; databaseId: string; token: string }
const defaultCoordinatorFile = new URL('../../../.cache/corpus/hevy/provider-coordinator.json', import.meta.url)
const missingCoordinatorMessage = 'Falta coordinador global D1 válido o CLOUDFLARE_API_TOKEN; no se envía al proveedor'

/** Valida localmente el coordinador antes de reservar un intento del proveedor. */
export function preflightRemoteRequest(configFile: URL | string = defaultCoordinatorFile): RemoteCoordinator {
  let value: unknown
  try { value = JSON.parse(readFileSync(configFile, 'utf8')) }
  catch { throw new Error(missingCoordinatorMessage) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(missingCoordinatorMessage)
  const config = value as { accountId?: unknown; databaseId?: unknown }
  const accountId = typeof config.accountId === 'string' ? config.accountId.trim() : ''
  const databaseId = typeof config.databaseId === 'string' ? config.databaseId.trim() : ''
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? ''
  if (!accountId || !databaseId || !token) throw new Error(missingCoordinatorMessage)
  return { accountId, databaseId, token }
}

async function coordinatorQuery(sql: string, params: unknown[], signal: AbortSignal, coordinator = preflightRemoteRequest()): Promise<{ success: boolean; meta?: { changes?: number }; results?: Array<{ used_requests: number; max_requests: number }> }> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(coordinator.accountId)}/d1/database/${encodeURIComponent(coordinator.databaseId)}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${coordinator.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }), signal,
  })
  if (!response.ok) throw new Error(`Coordinador global HTTP ${response.status}; no se envía al proveedor`)
  const body = await response.json() as { success: boolean; result?: Array<{ success: boolean; meta?: { changes?: number }; results?: Array<{ used_requests: number; max_requests: number }> }> }
  if (!body.success || !body.result?.[0]?.success) throw new Error('Coordinador global no confirmó la operación')
  return body.result[0]
}

/** Solo configuración de recurso; las credenciales permanecen en el entorno. */
export async function reserveRemoteRequest(rpm: number, signal: AbortSignal, coordinator = preflightRemoteRequest()): Promise<void> {
  while (!signal.aborted) {
    const response = await coordinatorQuery(GLOBAL_REQUEST_RESERVATION_SQL, requestReservationValues(Date.now(), rpm), signal, coordinator)
    if (response.meta?.changes === 1) return
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('Cancelado antes de la reserva global')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, Math.ceil(60_000 / rpm))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
  throw new Error('Cancelado antes de la reserva global')
}

export async function deferRemoteRequest(retryAfterMs: number, signal: AbortSignal): Promise<void> {
  const response = await coordinatorQuery(GLOBAL_REQUEST_DEFER_SQL, requestDeferValues(Date.now(), retryAfterMs), signal)
  if (!response.success) throw new Error('Defer global NVIDIA no confirmado')
}
