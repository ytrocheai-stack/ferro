import { readFileSync } from 'node:fs'
import { GLOBAL_REQUEST_DEFER_SQL, GLOBAL_REQUEST_RESERVATION_SQL, requestDeferValues, requestReservationValues } from './request-gate.ts'

async function coordinatorQuery(sql: string, params: unknown[], signal: AbortSignal): Promise<{ success: boolean; meta?: { changes?: number }; results?: Array<{ used_requests: number; max_requests: number }> }> {
  const config = JSON.parse(readFileSync(new URL('../../../.cache/corpus/hevy/provider-coordinator.json', import.meta.url), 'utf8')) as { accountId: string; databaseId: string }
  if (!config.accountId || !config.databaseId || !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Falta coordinador global D1; no se envía al proveedor')
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/d1/database/${encodeURIComponent(config.databaseId)}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }), signal,
  })
  if (!response.ok) throw new Error(`Coordinador global HTTP ${response.status}; no se envía al proveedor`)
  const body = await response.json() as { success: boolean; result?: Array<{ success: boolean; meta?: { changes?: number }; results?: Array<{ used_requests: number; max_requests: number }> }> }
  if (!body.success || !body.result?.[0]?.success) throw new Error('Coordinador global no confirmó la operación')
  return body.result[0]
}

/** Solo configuración de recurso; las credenciales permanecen en el entorno. */
export async function reserveRemoteRequest(rpm: number, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const response = await coordinatorQuery(GLOBAL_REQUEST_RESERVATION_SQL, requestReservationValues(Date.now(), rpm), signal)
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
