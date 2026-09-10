import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMBEDDING_MODEL, FLASH_MODEL, ProviderSession, loadLocalEnv, type Authorization } from './runtime'

describe('carga local de credenciales', () => {
  it('carga solo secretos de proveedor y conserva variables explícitas', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'provider-env-'))
    const file = path.join(directory, '.env.providers.local')
    const previous = process.env.NVIDIA_API_KEY
    const previousCloudflare = process.env.CLOUDFLARE_API_TOKEN
    const previousPublic = process.env.VITE_PROVIDER_TEST
    try {
      process.env.NVIDIA_API_KEY = '   '
      process.env.CLOUDFLARE_API_TOKEN = 'explicit-test-value'
      delete process.env.VITE_PROVIDER_TEST
      writeFileSync(file, 'NVIDIA_API_KEY=local-test-value\nCLOUDFLARE_API_TOKEN=file-test-value\nVITE_PROVIDER_TEST=must-not-load\n')
      loadLocalEnv(file)
      expect(process.env.NVIDIA_API_KEY).toBe('local-test-value')
      expect(process.env.CLOUDFLARE_API_TOKEN).toBe('explicit-test-value')
      expect(process.env.VITE_PROVIDER_TEST).toBeUndefined()
    } finally {
      for (const [key, value] of Object.entries({ NVIDIA_API_KEY: previous, CLOUDFLARE_API_TOKEN: previousCloudflare, VITE_PROVIDER_TEST: previousPublic })) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

const authorization = (): Authorization => ({ accessVerified: true, budgetVerified: true, maxAdditionalCost: 0, verifiedAt: new Date().toISOString(), reviewer: 'test', evidence: 'local fixture', model: FLASH_MODEL, embeddingModel: EMBEDDING_MODEL, maxCalls: 4, maxInputTokens: 20000, maxOutputTokens: 1200, timeoutMs: 1000, maxTotalCalls: 10, maxTotalInputTokens: 200000, maxTotalOutputTokens: 12000 })

describe('Flash final answer handling', () => {
  it('sends Kimi model and top-level reasoning parameters instead of DeepSeek template options', async () => {
    let body: Record<string, unknown> = {}
    const session = new ProviderSession({ directory: mkdtempSync(path.join(tmpdir(), 'kimi-')), authorization: { ...authorization(), model: 'moonshotai/kimi-k3' }, apiKey: 'test', fetcher: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }))
    } })
    await session.generate('consulta', 1200, undefined, 'kimi')
    expect(body).toMatchObject({ model: 'moonshotai/kimi-k3', temperature: 1, reasoning_effort: 'low', max_tokens: 1200 })
    expect(body).not.toHaveProperty('chat_template_kwargs')
  })
  it('counts unknown outcomes as requests without blocking unrelated work or inventing token usage', async () => {
    const session = new ProviderSession({ directory: mkdtempSync(path.join(tmpdir(), 'request-accounting-')), authorization: { ...authorization(), accountingMode: 'requests', requestsPerMinute: 40, maxTotalInputTokens: 1, maxTotalOutputTokens: 1 }, apiKey: 'test', fetcher: async () => { throw new Error('network failure') } })
    await expect(session.generate('consulta', 1200, undefined, 'q1')).rejects.toThrow('network failure')
    await expect(session.generate('otra', 1200, undefined, 'q2')).rejects.toThrow('network failure')
    await expect(session.generate('consulta', 1200, undefined, 'q1')).rejects.toThrow('Intento previo')
    expect(session.report()).toMatchObject({ calls: 2, uncertainCalls: 2, outputTokens: 2400 })
  })
  it('recovers an uncertain attempt only when explicitly requested and links the new ledger entry', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'request-recovery-'))
    let calls = 0
    const session = new ProviderSession({ directory, authorization: { ...authorization(), accountingMode: 'requests', requestsPerMinute: 40 }, apiKey: 'test', fetcher: async () => {
      calls += 1
      if (calls === 1) throw new Error('network failure')
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }))
    } })
    await expect(session.generate('consulta', 1200, undefined, 'recover')).rejects.toThrow('network failure')
    await expect(session.generate('consulta', 1200, undefined, 'recover')).rejects.toThrow('Intento previo')
    const answer = await session.generate('consulta', 1200, undefined, 'recover', undefined, undefined, true)
    expect(answer.content).toBe('{"ok":true}')
    const attempts = Object.values(JSON.parse(readFileSync(path.join(directory, 'ledger.json'), 'utf8')).attempts) as Array<{ retryOf?: string; state: string }>
    expect(attempts).toHaveLength(2)
    expect(attempts.filter((attempt) => attempt.retryOf).length).toBe(1)
    expect(attempts.filter((attempt) => attempt.state === 'completed')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.state === 'pending')).toHaveLength(1)
  })
  it('enforces a durable rolling request limit across session restarts including rejected requests', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'request-limit-'))
    const options = { directory, authorization: { ...authorization(), accountingMode: 'requests' as const, requestsPerMinute: 1 }, apiKey: 'test', fetcher: async () => new Response('overloaded', { status: 529 }) }
    await expect(new ProviderSession(options).generate('primera', 100, undefined, 'first')).rejects.toMatchObject({ status: 529 })
    await expect(new ProviderSession(options).generate('segunda', 100, undefined, 'second')).rejects.toMatchObject({ code: 'LOCAL_RATE_LIMIT' })
    expect(new ProviderSession(options).report().calls).toBe(1)
  })
  it('passes reasoning effort to NVIDIA and includes it in the response cache identity', async () => {
    const bodies: Array<{ chat_template_kwargs?: { thinking: boolean; reasoning_effort?: string } }> = []
    const session = new ProviderSession({ directory: mkdtempSync(path.join(tmpdir(), 'flash-effort-')), authorization: authorization(), apiKey: 'test', fetcher: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }))
    } })
    await session.generate('consulta', 1200, undefined, 'same', undefined, { thinking: true, reasoning_effort: 'low' })
    await session.generate('consulta', 1200, undefined, 'same', undefined, { thinking: true, reasoning_effort: 'high' })
    expect(bodies.map(body => body.chat_template_kwargs)).toEqual([{ thinking: true, reasoning_effort: 'low' }, { thinking: true, reasoning_effort: 'high' }])
    expect(session.report().calls).toBe(2)
  })
  it('retains the full reservation for a confirmed HTTP rejection and permits a different budgeted request', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'flash-http-'))
    const session = new ProviderSession({ directory, authorization: authorization(), apiKey: 'test', fetcher: async () => new Response('overloaded', { status: 529 }) })
    await expect(session.generate('consulta', 1200, undefined, 'q1')).rejects.toMatchObject({ status: 529 })
    const entries = Object.values(JSON.parse(readFileSync(path.join(directory, 'ledger.json'), 'utf8')).attempts)
    expect(entries).toMatchObject([{ state: 'rejected', measured: false, outputTokens: 1200, failure: { httpStatus: 529 } }])
    await expect(session.generate('otra consulta', 1200, undefined, 'q2')).rejects.toMatchObject({ status: 529 })
    expect(session.report().calls).toBe(2)
    expect(session.report().outputTokens).toBe(2400)
    expect(session.report().uncertainCalls).toBe(2) // Exact usage stays explicitly unknown.
  })
  it('does not continue past a network failure with unknown outcome', async () => {
    const session = new ProviderSession({ directory: mkdtempSync(path.join(tmpdir(), 'flash-network-')), authorization: authorization(), apiKey: 'test', fetcher: async () => { throw new Error('network failure') } })
    await expect(session.generate('consulta', 1200, undefined, 'q1')).rejects.toThrow('network failure')
    await expect(session.generate('otra', 1200, undefined, 'q2')).rejects.toThrow('consumo incierto')
    expect(session.report().calls).toBe(1)
  })
  it('does not exceed the budget after a rejected call and does not replay the same rejected attempt', async () => {
    const session = new ProviderSession({ directory: mkdtempSync(path.join(tmpdir(), 'flash-rejected-budget-')), authorization: { ...authorization(), maxTotalOutputTokens: 1200 }, apiKey: 'test', fetcher: async () => new Response('overloaded', { status: 529 }) })
    await expect(session.generate('consulta', 1200, undefined, 'q1')).rejects.toMatchObject({ status: 529 })
    await expect(session.generate('consulta', 1200, undefined, 'q1')).rejects.toThrow('Intento previo')
    await expect(session.generate('otra', 1200, undefined, 'q2')).rejects.toThrow('Presupuesto total agotado')
    expect(session.report().calls).toBe(1)
  })
  it('uses a distinct cache entry when disabling thinking and preserves the measured truncated attempt', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'flash-content-'))
    const session = new ProviderSession({ directory, authorization: authorization(), apiKey: 'test', fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      const final = body.chat_template_kwargs?.thinking === false
      return new Response(JSON.stringify({ choices: [{ finish_reason: final ? 'stop' : 'length', message: { content: final ? '{"responseText":"respuesta"}' : null, reasoning_content: final ? null : 'synthetic fixture' } }], usage: { prompt_tokens: 20, completion_tokens: final ? 10 : 1200 } }))
    } })
    await expect(session.generate('consulta', 1200, undefined, 'q1', undefined, { thinking: true })).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_TRUNCATED' })
    const answer = await session.generate('consulta', 1200, undefined, 'q1', undefined, { thinking: false })
    expect(answer.content).toBe('{"responseText":"respuesta"}')
    expect(await session.generate('consulta', 1200, undefined, 'q1', undefined, { thinking: false })).toEqual(answer)
    expect(session.report()).toEqual({ calls: 2, inputTokens: 40, outputTokens: 1210, uncertainCalls: 0 })
    expect(Object.keys(JSON.parse(readFileSync(path.join(directory, 'ledger.json'), 'utf8')).attempts)).toHaveLength(2)
  })

  it.each([null, '', '   '])('rejects missing or blank final content (%s) without treating reasoning as an answer', async content => {
    const session = new ProviderSession({ directory: mkdtempSync(path.join(tmpdir(), 'flash-empty-')), authorization: authorization(), apiKey: 'test', fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content, reasoning_content: 'synthetic reasoning, not final' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } })) })
    await expect(session.generate('consulta', 1200, undefined, 'q1')).rejects.toMatchObject({ code: 'PROVIDER_EMPTY_CONTENT' })
    expect(session.report().uncertainCalls).toBe(0)
  })

  it('rejects truncated nonempty answers and unmeasured usage before returning a generation', async () => {
    for (const measured of [true, false]) {
      const session = new ProviderSession({ directory: mkdtempSync(path.join(tmpdir(), 'flash-incomplete-')), authorization: authorization(), apiKey: 'test', fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: measured ? 'length' : 'stop', message: { content: '{"responseText":' } }], ...(measured ? { usage: { prompt_tokens: 20, completion_tokens: 1200 } } : {}) })) })
      await expect(session.generate('consulta', 1200, undefined, 'q1')).rejects.toThrow()
    }
  })
})
