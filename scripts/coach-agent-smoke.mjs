import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
function option(flag) {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Falta valor de ${flag}`)
  return value
}
function fail(message) { throw new Error(`coach:agent-smoke: ${message}`) }
async function readJson(file) { return JSON.parse(await fs.readFile(path.resolve(root, file), 'utf8')) }

if (!has('--execute')) {
  console.log(JSON.stringify({ schema: 'coach-agent-smoke-v1', status: 'blocked', reason: 'Añade --execute con autorización canaria, token JWT y contexto consentido; no se hicieron requests.' }, null, 2))
} else {
  const baseUrl = option('--base-url')?.replace(/\/$/, '')
  const tokenFile = option('--token-file')
  const contextFile = option('--context-file')
  const deviceId = option('--device-id')
  const origin = option('--origin') ?? 'https://ytrocheai-stack.github.io'
  const maxPolls = Number(option('--max-polls') ?? 15)
  const maxRequests = Number(option('--max-requests') ?? 24)
  if (!baseUrl || !tokenFile || !contextFile || !deviceId?.trim()) fail('requiere --base-url, --token-file, --context-file y --device-id')
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || !Number.isSafeInteger(maxRequests) || maxRequests < 5) fail('límites de smoke inválidos')
  const token = (await fs.readFile(path.resolve(root, tokenFile), 'utf8')).trim()
  if (!token) fail('el archivo JWT está vacío')
  const request = await readJson(contextFile)
  if (request?.event?.type !== 'message-sent' || request.event.deviceId !== deviceId || request.event.contextVersion !== request.context?.version || request.context?.isCurrent !== true) fail('el archivo no contiene un contexto consentido y vigente')
  const headers = { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json', 'X-NextRep-Consent-Version': 'coach-context-v2', 'X-NextRep-Device-Id': deviceId }
  let requests = 0
  async function call(method, pathname, body, extra = {}) {
    if (++requests > maxRequests) fail(`se alcanzó el límite de ${maxRequests} requests`)
    const response = await fetch(`${baseUrl}${pathname}`, { method, headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const payload = await response.json().catch(() => null)
    if (!response.ok) fail(`${method} ${pathname} devolvió HTTP ${response.status}: ${JSON.stringify(payload)}`)
    return payload
  }
  const idempotencyKey = `coach-agent-smoke-${Date.now().toString(36)}`
  const first = await call('POST', '/v1/coach/runs', request, { 'Idempotency-Key': idempotencyKey })
  const firstId = first?.run?.id
  if (typeof firstId !== 'string' || first?.run?.status !== 'queued') fail('la creación no devolvió una ejecución queued')
  const firstRead = await call('GET', `/v1/coach/runs/${encodeURIComponent(firstId)}`)
  if (firstRead?.run?.id !== firstId) fail('la consulta no devolvió la misma ejecución')
  let completed = firstRead
  for (let poll = 0; poll < maxPolls && ['queued', 'running'].includes(completed?.run?.status); poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    completed = await call('GET', `/v1/coach/runs/${encodeURIComponent(firstId)}`)
  }
  if (['queued', 'running'].includes(completed?.run?.status)) fail('la primera ejecución no terminó dentro del límite de smoke')
  if (completed?.run?.status !== 'completed') fail(`la primera ejecución terminó en un estado no aprobable: ${completed?.run?.status ?? 'desconocido'}`)
  if (!completed?.decision || ['unavailable', 'abstain'].includes(completed.decision.kind)) fail('la primera ejecución no produjo una decisión utilizable')
  const continuation = structuredClone(request)
  continuation.event = { ...continuation.event, id: `${continuation.event.id}-continuation-${Date.now().toString(36)}`, causedByEventId: completed.run.eventId }
  continuation.event.payload = { ...continuation.event.payload, message: `${String(continuation.event.payload?.message ?? '')}\nRespuesta de continuación del canario.` }
  const second = await call('POST', '/v1/coach/runs', continuation, { 'Idempotency-Key': `${idempotencyKey}-continuation` })
  const secondId = second?.run?.id
  if (typeof secondId !== 'string' || second?.run?.status !== 'queued') fail('la continuación no devolvió una ejecución queued')
  const cancelled = await call('POST', `/v1/coach/runs/${encodeURIComponent(secondId)}/cancel`, {}, { 'Idempotency-Key': `${idempotencyKey}-cancel` })
  if (cancelled?.run?.id !== secondId || !['cancelled', 'completed'].includes(cancelled?.run?.status)) fail('la cancelación no devolvió un estado terminal aprobable')
  console.log(JSON.stringify({ schema: 'coach-agent-smoke-v1', status: 'passed', baseUrl, origin, requests, firstRun: { id: firstId, status: completed.run.status }, continuationRun: { id: secondId, status: cancelled.run.status }, manualFollowUps: ['validar propuesta real y aplicación desde la PWA', 'probar cambio de cuenta, consentimiento revocado, offline y ambos navegadores', 'apagar cualquier activación temporal tras el canario'] }, null, 2))
}
