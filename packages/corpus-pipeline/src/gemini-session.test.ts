import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EMBEDDING_MODEL, writeJson } from './runtime.ts'
import {
  GEMINI_GENERATE_CONTENT_URL,
  GEMINI_GENERATION_MODEL,
  GEMINI_PROJECT_NAME,
  GEMINI_PROJECT_NUMBER,
  GEMINI_PROJECT_QUOTA,
  GeminiGenerationSession,
  readGeminiAuthorization,
  type GeminiAllocation,
  type GeminiAuthorization,
} from './gemini-session.ts'

function authorization(overrides: Partial<GeminiAuthorization> = {}): GeminiAuthorization {
  return {
    provider: 'google-ai-studio',
    projectName: GEMINI_PROJECT_NAME,
    projectNumber: GEMINI_PROJECT_NUMBER,
    accessVerified: true,
    budgetVerified: true,
    maxAdditionalCost: 0,
    verifiedAt: new Date().toISOString(),
    reviewer: 'test reviewer',
    evidence: 'synthetic free-tier authorization fixture',
    projectQuota: { ...GEMINI_PROJECT_QUOTA },
    model: GEMINI_GENERATION_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    requestsPerMinute: 15,
    tokensPerMinute: GEMINI_PROJECT_QUOTA.tokensPerMinute,
    requestsPerDay: GEMINI_PROJECT_QUOTA.requestsPerDay,
    maxInputTokens: 30_000,
    maxOutputTokens: 1_000,
    timeoutMs: 1_000,
    maxTotalCalls: 10,
    maxTotalInputTokens: 100_000,
    maxTotalOutputTokens: 10_000,
    allocations: {
      benchmark: { calls: 6, inputTokens: 60_000, outputTokens: 6_000 },
      lab: { calls: 3, inputTokens: 30_000, outputTokens: 3_000 },
      smoke: { calls: 1, inputTokens: 10_000, outputTokens: 1_000 },
    },
    ...overrides,
  }
}

function successfulResponse(usageMetadata: Record<string, unknown> = {
  promptTokenCount: 120,
  candidatesTokenCount: 30,
  thoughtsTokenCount: 8,
  totalTokenCount: 158,
}): Response {
  return new Response(JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"responseText":"respuesta","claims":[]}' }] } }],
    usageMetadata,
  }))
}

function session(options: {
  directory?: string
  auth?: GeminiAuthorization
  fetcher?: typeof fetch
  allocation?: GeminiAllocation
} = {}) {
  return new GeminiGenerationSession({
    directory: options.directory ?? mkdtempSync(path.join(tmpdir(), 'gemini-session-')),
    authorization: options.auth ?? authorization(),
    allocation: options.allocation ?? 'benchmark',
    apiKey: 'synthetic-test-key',
    fetcher: options.fetcher,
  })
}

describe('autorización y generación local Gemini', () => {
  it('exige coste adicional cero, proyecto, cuota gratuita y el modelo exacto', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'gemini-auth-')), 'authorization.json')
    const valid = authorization()
    writeJson(file, valid)
    expect(readGeminiAuthorization(file)).toMatchObject({ model: GEMINI_GENERATION_MODEL, projectName: GEMINI_PROJECT_NAME, maxAdditionalCost: 0 })

    const multiDayCampaign = {
      ...valid,
      maxTotalCalls: 600,
      allocations: {
        benchmark: { ...valid.allocations.benchmark, calls: 500 },
        lab: { ...valid.allocations.lab, calls: 99 },
        smoke: { ...valid.allocations.smoke, calls: 1 },
      },
    }
    writeJson(file, multiDayCampaign)
    expect(readGeminiAuthorization(file)).toMatchObject({ maxTotalCalls: 600, requestsPerDay: GEMINI_PROJECT_QUOTA.requestsPerDay })

    for (const invalid of [
      { ...valid, maxAdditionalCost: 0.01 },
      { ...valid, model: 'gemini-3.5-flash' },
      { ...valid, projectName: 'otro proyecto' },
      { ...valid, projectNumber: '000000000000' },
      { ...valid, projectQuota: { ...GEMINI_PROJECT_QUOTA, requestsPerMinute: 16 } },
      { ...valid, requestsPerDay: GEMINI_PROJECT_QUOTA.requestsPerDay + 1 },
    ]) {
      writeJson(file, invalid)
      expect(() => readGeminiAuthorization(file)).toThrow('Autorización Gemini incompleta')
    }
  })

  it('envía únicamente al modelo autorizado y conserva todo el uso medido, incluido el pensamiento', async () => {
    let observedUrl = ''
    let observedKey = ''
    let observedBody: Record<string, unknown> = {}
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-measured-'))
    const provider = session({ directory, fetcher: async (url, init) => {
      observedUrl = String(url)
      observedKey = new Headers(init?.headers).get('x-goog-api-key') ?? ''
      observedBody = JSON.parse(String(init?.body))
      return successfulResponse()
    } })

    const result = await provider.generate('consulta de prueba', { maxOutputTokens: 120, attemptKey: 'q1' })
    expect(observedUrl).toBe(GEMINI_GENERATE_CONTENT_URL)
    expect(observedKey).toBe('synthetic-test-key')
    expect(observedBody).toMatchObject({
      generationConfig: { maxOutputTokens: 120, responseMimeType: 'application/json' },
      contents: [{ role: 'user', parts: [{ text: 'consulta de prueba' }] }],
    })
    expect(observedBody.generationConfig).not.toHaveProperty('candidateCount')
    expect(result).toEqual({
      content: '{"responseText":"respuesta","claims":[]}',
      usage: { inputTokens: 120, outputTokens: 38 },
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 8, totalTokenCount: 158 },
    })
    expect(provider.report()).toMatchObject({ calls: 1, allocationCalls: 1, measuredCalls: 1, uncertainCalls: 0, inputTokens: 120, outputTokens: 38 })
    const ledger = JSON.parse(readFileSync(path.join(directory, 'ledger.json'), 'utf8'))
    expect(Object.values(ledger.attempts)[0]).toMatchObject({ model: GEMINI_GENERATION_MODEL, measured: true, usageMetadata: result.usageMetadata })
  })

  it('conserva en el ledger la procedencia de una reemisión explícita del benchmark', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-retry-provenance-'))
    const provenance = {
      kind: 'benchmark-invalid-response-retry-v1' as const,
      priorAttemptKey: 'a'.repeat(64),
      priorResponseSha256: 'c'.repeat(64),
      reason: 'empty-responseText' as const,
    }
    await session({ directory, fetcher: async () => successfulResponse() }).generate('prompt nuevo', {
      maxOutputTokens: 120,
      attemptKey: 'b'.repeat(64),
      attemptProvenance: provenance,
    })

    const ledger = JSON.parse(readFileSync(path.join(directory, 'ledger.json'), 'utf8')) as { attempts: Record<string, { attemptProvenance?: typeof provenance }> }
    expect(Object.values(ledger.attempts)).toHaveLength(1)
    expect(Object.values(ledger.attempts)[0].attemptProvenance).toEqual(provenance)
  })

  it('reutiliza el checkpoint medido sin volver a llamar a Gemini', async () => {
    let calls = 0
    const provider = session({ fetcher: async () => { calls += 1; return successfulResponse() } })
    const options = { maxOutputTokens: 120, attemptKey: 'stable-benchmark-row' }
    const first = await provider.generate('consulta', options)
    const resumed = await provider.generate('consulta', options)
    expect(resumed).toEqual(first)
    expect(calls).toBe(1)
  })

  it('reanuda una respuesta después de un 429 con Retry-After y registra cada envío', async () => {
    let calls = 0
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-retry-'))
    const provider = session({ directory, fetcher: async () => {
      calls += 1
      return calls === 1 ? new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }) : successfulResponse()
    } })
    const answer = await provider.generate('consulta', { maxOutputTokens: 120, attemptKey: 'retry-q1' })
    expect(answer.content).toContain('respuesta')
    expect(provider.report()).toMatchObject({ calls: 2, measuredCalls: 1, rejectedCalls: 1, uncertainCalls: 0 })
    const attempts = Object.values(JSON.parse(readFileSync(path.join(directory, 'ledger.json'), 'utf8')).attempts) as Array<{ state: string; retryOf?: string }>
    expect(attempts).toHaveLength(2)
    expect(attempts.filter((attempt) => attempt.state === 'rejected')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.retryOf).length).toBe(1)
  })

  it('bloquea futuras llamadas si la respuesta no incluye uso medible y no rellena campos ausentes', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-unmeasured-'))
    const provider = session({ directory, fetcher: async () => successfulResponse({ promptTokenCount: 14, candidatesTokenCount: 7 }) })
    await expect(provider.generate('consulta', { maxOutputTokens: 120, attemptKey: 'missing-total' })).rejects.toMatchObject({ code: 'GEMINI_UNMEASURED_USAGE' })
    await expect(provider.generate('otra consulta', { maxOutputTokens: 120, attemptKey: 'after-unmeasured' })).rejects.toThrow('consumo incierto')
    const attempt = Object.values(JSON.parse(readFileSync(path.join(directory, 'ledger.json'), 'utf8')).attempts as Record<string, { state: string; measured: boolean; usageMetadata: Record<string, unknown> }>)[0]
    expect(attempt).toMatchObject({ state: 'completed', measured: false, usageMetadata: { promptTokenCount: 14, candidatesTokenCount: 7 } })
    expect(attempt.usageMetadata).not.toHaveProperty('thoughtsTokenCount')
    expect(provider.report()).toMatchObject({ calls: 1, measuredCalls: 0, uncertainCalls: 1 })
  })

  it('bloquea nuevos envíos después de una salida de red incierta', async () => {
    let calls = 0
    const provider = session({ fetcher: async () => { calls += 1; throw new Error('synthetic network failure') } })
    await expect(provider.generate('consulta', { maxOutputTokens: 120, attemptKey: 'network-q1' })).rejects.toThrow('synthetic network failure')
    await expect(provider.generate('otra consulta', { maxOutputTokens: 120, attemptKey: 'network-q2' })).rejects.toThrow('consumo incierto')
    expect(calls).toBe(1)
    expect(provider.report()).toMatchObject({ calls: 1, uncertainCalls: 1 })
  })

  it('requiere la ruta comun para llamadas reales y mantiene directorios aislados solo con fetcher inyectado', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-real-ledger-'))
    expect(() => new GeminiGenerationSession({
      directory, authorization: authorization(), allocation: 'benchmark', apiKey: 'synthetic-test-key',
    })).toThrow('deben compartir el diario')
    expect(session({ directory, fetcher: async () => successfulResponse() }).report().calls).toBe(0)
  })

  it('reinicia el limite diario al cruzar medianoche del Pacifico y conserva el mismo dia durante el retroceso DST', async () => {
    vi.useFakeTimers()
    try {
      const springDirectory = mkdtempSync(path.join(tmpdir(), 'gemini-pacific-spring-'))
      vi.setSystemTime(new Date('2026-03-08T07:59:00.000Z'))
      const springAuth = authorization({ requestsPerDay: 1 })
      let springCalls = 0
      const spring = session({ directory: springDirectory, auth: springAuth, fetcher: async () => { springCalls += 1; return successfulResponse() } })
      await spring.generate('antes de medianoche', { maxOutputTokens: 120, attemptKey: 'spring-before' })
      vi.setSystemTime(new Date('2026-03-08T08:01:00.000Z'))
      await spring.generate('despues de medianoche', { maxOutputTokens: 120, attemptKey: 'spring-after' })
      expect(springCalls).toBe(2)

      const fallDirectory = mkdtempSync(path.join(tmpdir(), 'gemini-pacific-fall-'))
      vi.setSystemTime(new Date('2026-11-01T08:59:00.000Z'))
      const fallAuth = authorization({ requestsPerDay: 1 })
      let fallCalls = 0
      const fall = session({ directory: fallDirectory, auth: fallAuth, fetcher: async () => { fallCalls += 1; return successfulResponse() } })
      await fall.generate('primera hora repetida', { maxOutputTokens: 120, attemptKey: 'fall-first' })
      vi.setSystemTime(new Date('2026-11-01T09:01:00.000Z'))
      await expect(fall.generate('misma fecha Pacifico', { maxOutputTokens: 120, attemptKey: 'fall-second' }))
        .rejects.toMatchObject({ code: 'GEMINI_LOCAL_QUOTA' })
      expect(fallCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('no despacha si se solicita una respuesta de checkpoint cacheada que falta', async () => {
    let calls = 0
    const provider = session({ fetcher: async () => { calls += 1; return successfulResponse() } })
    await expect(provider.generate('consulta cacheada', { maxOutputTokens: 120, attemptKey: 'cache-only', requireCached: true }))
      .rejects.toThrow('requiere una respuesta cacheada medida')
    expect(calls).toBe(0)
    await provider.generate('consulta cacheada', { maxOutputTokens: 120, attemptKey: 'cache-only' })
    await provider.generate('consulta cacheada', { maxOutputTokens: 120, attemptKey: 'cache-only', requireCached: true })
    expect(calls).toBe(1)
  })

  it('persiste y vuelve a rechazar un sobreconsumo aunque la respuesta permanezca cacheada', async () => {
    let calls = 0
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-overrun-'))
    const provider = session({ directory, fetcher: async () => { calls += 1; return successfulResponse() } })
    const options = { maxOutputTokens: 25, attemptKey: 'overrun-q1' }
    await expect(provider.generate('consulta larga', options)).rejects.toMatchObject({ code: 'GEMINI_CALL_LIMIT_OVERRUN' })
    await expect(provider.generate('consulta larga', options)).rejects.toMatchObject({ code: 'GEMINI_CALL_LIMIT_OVERRUN' })
    expect(calls).toBe(1)
    const ledger = JSON.parse(readFileSync(path.join(directory, 'ledger.json'), 'utf8'))
    const saved = Object.values(ledger.attempts as Record<string, { terminalOverrun?: string }>)[0]
    expect(saved.terminalOverrun).toBe('GEMINI_CALL_LIMIT_OVERRUN')
  })

  it('no reintenta un 429 clasificado como cuota diaria agotada', async () => {
    let calls = 0
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-daily-429-'))
    const provider = session({ directory, fetcher: async () => {
      calls += 1
      return new Response(JSON.stringify({
        error: {
          message: 'Quota exceeded',
          details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
        },
      }), { status: 429, headers: { 'Retry-After': '0' } })
    } })
    const options = { maxOutputTokens: 120, attemptKey: 'daily-quota' }
    await expect(provider.generate('consulta', options)).rejects.toMatchObject({ code: 'GEMINI_DAILY_QUOTA_EXHAUSTED' })
    await expect(provider.generate('consulta', options)).rejects.toMatchObject({ code: 'GEMINI_DAILY_QUOTA_EXHAUSTED' })
    expect(calls).toBe(1)
  })

  it('detiene el reintento diario durante el mismo dia y permite reanudar tras el cambio Pacifico', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-03-08T07:59:00.000Z'))
      const directory = mkdtempSync(path.join(tmpdir(), 'gemini-daily-retry-'))
      let calls = 0
      const provider = session({ directory, auth: authorization(), fetcher: async () => {
        calls += 1
        return calls === 1
          ? new Response(JSON.stringify({ error: { message: 'quota exceeded for GenerateRequestsPerDayPerProject' } }), { status: 429, headers: { 'Retry-After': '0' } })
          : successfulResponse()
      } })
      const options = { maxOutputTokens: 120, attemptKey: 'retry-after-pacific-reset' }
      await expect(provider.generate('consulta', options)).rejects.toMatchObject({ code: 'GEMINI_DAILY_QUOTA_EXHAUSTED' })
      await expect(provider.generate('consulta', options)).rejects.toMatchObject({ code: 'GEMINI_DAILY_QUOTA_EXHAUSTED' })
      expect(calls).toBe(1)
      vi.setSystemTime(new Date('2026-03-08T08:01:00.000Z'))
      await expect(provider.generate('consulta', options)).resolves.toMatchObject({ content: expect.stringContaining('respuesta') })
      expect(calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('falla sin repetir cuando el ledger tiene exito medido pero falta el artefacto', async () => {
    let calls = 0
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-missing-response-'))
    const provider = session({ directory, fetcher: async () => { calls += 1; return successfulResponse() } })
    const options = { maxOutputTokens: 120, attemptKey: 'missing-artifact' }
    await provider.generate('consulta', options)
    const ledger = JSON.parse(readFileSync(path.join(directory, 'ledger.json'), 'utf8'))
    const attemptId = Object.keys(ledger.attempts as Record<string, unknown>)[0]
    unlinkSync(path.join(directory, 'responses', attemptId + '.json'))
    await expect(provider.generate('consulta', options)).rejects.toThrow('sin su artefacto de respuesta')
    expect(calls).toBe(1)
  })

  it('explica como conciliar con seguridad un bloqueo que ya existe', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-stale-lock-'))
    writeFileSync(path.join(directory, 'running.lock'), JSON.stringify({ pid: 1234, projectNumber: GEMINI_PROJECT_NUMBER }))
    const provider = session({ directory, fetcher: async () => successfulResponse() })
    await expect(provider.generate('consulta', { maxOutputTokens: 120, attemptKey: 'locked' }))
      .rejects.toThrow(/no repitas intentos pendientes.*ni borres el diario/i)
  })

  it('aplica la cuota diaria Pacifica y conserva topes acumulados de campaña entre varios días', async () => {
    vi.useFakeTimers()
    try {
      const directory = mkdtempSync(path.join(tmpdir(), 'gemini-daily-budget-'))
      vi.setSystemTime(new Date('2026-03-08T07:30:00.000Z'))
      const authOverrides: Partial<GeminiAuthorization> = {
        requestsPerDay: 3,
        maxTotalCalls: 8,
        allocations: {
          benchmark: { calls: 6, inputTokens: 60_000, outputTokens: 6_000 },
          lab: { calls: 1, inputTokens: 30_000, outputTokens: 3_000 },
          smoke: { calls: 1, inputTokens: 10_000, outputTokens: 1_000 },
        },
      }
      let calls = 0
      const createProvider = (allocation: GeminiAllocation = 'benchmark') => session({ directory, auth: authorization({ ...authOverrides, verifiedAt: new Date(Date.now()).toISOString() }), allocation, fetcher: async () => { calls += 1; return successfulResponse() } })
      for (let index = 0; index < 3; index += 1) {
        await createProvider().generate('dia uno ' + index, { maxOutputTokens: 120, attemptKey: 'budget-day-one-' + index })
      }
      vi.setSystemTime(new Date('2026-03-08T08:30:00.000Z'))
      for (let index = 0; index < 3; index += 1) {
        await createProvider().generate('dia dos ' + index, { maxOutputTokens: 120, attemptKey: 'budget-day-two-' + index })
      }
      vi.setSystemTime(new Date('2026-03-09T08:30:00.000Z'))
      await createProvider('lab').generate('lab campaña', { maxOutputTokens: 120, attemptKey: 'budget-campaign-lab' })
      await createProvider('smoke').generate('smoke campaña', { maxOutputTokens: 120, attemptKey: 'budget-campaign-smoke' })
      await expect(createProvider('smoke').generate('exceso campaña', { maxOutputTokens: 120, attemptKey: 'budget-campaign-overrun' }))
        .rejects.toMatchObject({ code: 'GEMINI_CAMPAIGN_BUDGET' })
      expect(calls).toBe(8)
      expect(createProvider().report()).toMatchObject({ calls: 8, allocationCalls: 6 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('espera la cuota por minuto antes del siguiente envío', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'))
      const directory = mkdtempSync(path.join(tmpdir(), 'gemini-rate-wait-'))
      const auth = authorization({ requestsPerMinute: 1, timeoutMs: 60_000 })
      let calls = 0
      const createProvider = () => session({ directory, auth, fetcher: async () => { calls += 1; return successfulResponse() } })
      await createProvider().generate('primera', { maxOutputTokens: 120, attemptKey: 'first' })

      const second = createProvider().generate('segunda', { maxOutputTokens: 120, attemptKey: 'second' })
      await vi.advanceTimersByTimeAsync(59_999)
      expect(calls).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await expect(second).resolves.toMatchObject({ content: expect.stringContaining('respuesta') })
      expect(calls).toBe(2)
      expect(createProvider().report()).toMatchObject({ calls: 2, measuredCalls: 2, uncertainCalls: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('no espera un tope diario ni supera el timeout autorizado esperando una cuota', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-daily-cap-'))
    const dailyAuth = authorization({ requestsPerDay: 1 })
    let calls = 0
    const dailyProvider = session({ directory, auth: dailyAuth, fetcher: async () => { calls += 1; return successfulResponse() } })
    await dailyProvider.generate('primera', { maxOutputTokens: 120, attemptKey: 'daily-first' })
    await expect(dailyProvider.generate('segunda', { maxOutputTokens: 120, attemptKey: 'daily-second' }))
      .rejects.toMatchObject({ code: 'GEMINI_LOCAL_QUOTA', retryScope: 'day' })
    expect(calls).toBe(1)

    const minuteDirectory = mkdtempSync(path.join(tmpdir(), 'gemini-minute-timeout-'))
    const minuteAuth = authorization({ requestsPerMinute: 1, timeoutMs: 500 })
    const minuteProvider = session({ directory: minuteDirectory, auth: minuteAuth, fetcher: async () => { calls += 1; return successfulResponse() } })
    await minuteProvider.generate('primera', { maxOutputTokens: 120, attemptKey: 'minute-first' })
    await expect(minuteProvider.generate('segunda', { maxOutputTokens: 120, attemptKey: 'minute-second' }))
      .rejects.toMatchObject({ code: 'GEMINI_RETRY_AFTER' })
    expect(calls).toBe(2)
  })

  it('respeta AbortSignal y vuelve a validar la vigencia tras la espera local', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'))
      const abortDirectory = mkdtempSync(path.join(tmpdir(), 'gemini-rate-abort-'))
      const auth = authorization({ requestsPerMinute: 1, timeoutMs: 60_000 })
      let calls = 0
      const provider = session({ directory: abortDirectory, auth, fetcher: async () => { calls += 1; return successfulResponse() } })
      await provider.generate('primera', { maxOutputTokens: 120, attemptKey: 'abort-first' })
      const controller = new AbortController()
      const aborted = provider.generate('segunda', { maxOutputTokens: 120, attemptKey: 'abort-second', signal: controller.signal })
      const abortedExpectation = expect(aborted).rejects.toThrow('Cancelado antes del reintento Gemini')
      setTimeout(() => controller.abort(), 1)
      await vi.advanceTimersByTimeAsync(1)
      await abortedExpectation
      expect(calls).toBe(1)

      const expiringDirectory = mkdtempSync(path.join(tmpdir(), 'gemini-rate-expiring-auth-'))
      const expiringAuth = authorization({
        requestsPerMinute: 1,
        timeoutMs: 60_000,
        verifiedAt: new Date(Date.now() - 86_399_950).toISOString(),
      })
      let expiringCalls = 0
      const expiringProvider = session({ directory: expiringDirectory, auth: expiringAuth, fetcher: async () => { expiringCalls += 1; return successfulResponse() } })
      await expiringProvider.generate('primera', { maxOutputTokens: 120, attemptKey: 'expiring-first' })
      const expired = expiringProvider.generate('segunda', { maxOutputTokens: 120, attemptKey: 'expiring-second' })
      const expiredExpectation = expect(expired).rejects.toThrow('Autorización Gemini caducada')
      await vi.advanceTimersByTimeAsync(60_000)
      await expiredExpectation
      expect(expiringCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
