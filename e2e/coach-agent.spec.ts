import { test, expect } from '@playwright/test'

const accountId = 'user_e2e_coach'

test('el flujo del agente crea, continúa y cancela ejecuciones sin proveedor real', async ({ page }) => {
  const runs = new Map<string, { eventId: string; status: 'queued' | 'completed' | 'cancelled'; continuation?: boolean }>()
  let sequence = 0
  let contextVersion = ''

  await page.addInitScript(({ accountId: seededAccountId }) => {
    localStorage.setItem('ferro-coach-device-id', 'e2e-device')
    localStorage.setItem('ferro-coach-consent', JSON.stringify([{ userId: seededAccountId, deviceId: 'e2e-device', version: 'coach-context-v2', acceptedAt: Date.now(), enabled: true }]))
  }, { accountId })

  await page.route('**/mock-worker/v1/coach/runs', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const request = route.request().postDataJSON() as { event: { id: string; causedByEventId?: string; accountId: string }; context: { version: string } }
    expect(request.event.accountId).toBe(accountId)
    expect(request.context.version).toMatch(/^coach-context-/)
    contextVersion = request.context.version
    if (request.event.causedByEventId) expect([...runs.values()].some((run) => run.eventId === request.event.causedByEventId)).toBe(true)
    const id = `e2e-run-${++sequence}`
    runs.set(id, { eventId: request.event.id, status: 'queued', continuation: Boolean(request.event.causedByEventId) })
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run: { id, eventId: request.event.id, accountId, contextVersion, specialists: ['orchestrator'], status: 'queued' } }) })
  })

  await page.route('**/mock-worker/v1/coach/runs/**', async (route) => {
    const url = new URL(route.request().url())
    const pathParts = url.pathname.split('/').filter(Boolean)
    const id = pathParts.at(-1) === 'cancel' ? pathParts.at(-2)! : pathParts.at(-1)!
    const run = runs.get(id)
    expect(run).toBeTruthy()
    if (route.request().method() === 'POST' && url.pathname.endsWith('/cancel')) {
      run!.status = 'cancelled'
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run: { id, eventId: run!.eventId, accountId, contextVersion, specialists: ['orchestrator'], status: 'cancelled', endedAt: Date.now() }, error: 'cancelled' }) })
      return
    }
    if (route.request().method() !== 'GET') return route.fallback()
    const completed = id === 'e2e-run-1' && !run!.continuation
    if (completed) run!.status = 'completed'
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      run: { id, eventId: run!.eventId, accountId, contextVersion, specialists: ['orchestrator'], status: run!.status, ...(run!.status === 'completed' ? { endedAt: Date.now() } : {}) },
      ...(completed ? { decision: { kind: 'ask', explanation: 'Necesito una aclaración antes de proponer cambios.', observations: [], evidence: [], questions: ['¿Qué equipo tendrás disponible?'] } } : {}),
    }) })
  })

  await page.goto('./coach')
  await expect(page.getByRole('heading', { name: 'Coach' })).toBeVisible()
  await page.getByLabel('Mensaje para el coach').fill('Analiza mi siguiente sesión')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByText(/El coach está procesando tu contexto/)).toBeVisible()
  await expect(page.getByText('Necesito una aclaración antes de proponer cambios.')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('¿Qué equipo tendrás disponible?')).toBeVisible()

  await page.getByLabel('Mensaje para el coach').fill('Tendré barra y discos')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText(/El coach está procesando tu contexto/)).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByText('Cancelado', { exact: true }).first()).toBeVisible()
  expect([...runs.values()].map((run) => run.continuation)).toEqual([false, true])
})
