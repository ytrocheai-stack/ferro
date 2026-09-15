import { describe, expect, it } from 'vitest'
import {
  GEMINI_GENERATE_CONTENT_URL,
  GEMINI_MODEL,
  GeminiGenerationProvider,
  geminiResponseJsonSchema,
  type GeminiResponse,
} from './gemini'

const apiKey = 'gemini-test-secret'
const wire = JSON.stringify({ type: 'tool', name: 'metrics', arguments: {} })

function response(overrides: Partial<GeminiResponse> = {}): Response {
  return Response.json({
    candidates: [{ content: { role: 'model', parts: [{ text: wire }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34, thoughtsTokenCount: 5, totalTokenCount: 51 },
    ...overrides,
  })
}

describe('Gemini 3.5 Flash Lite generation transport', () => {
  it('invoca fetch sin enlazar la instancia del proveedor como receptor de workerd', async () => {
    const runtimeFetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(response())
    } as typeof fetch
    const provider = new GeminiGenerationProvider(apiKey, runtimeFetch)
    await expect(provider.generate('canario ficticio', GEMINI_MODEL)).resolves.toMatchObject({ content: wire })
  })

  it('sends the exact structured JSON request with the API key only in x-goog-api-key', async () => {
    let url = ''
    let init: RequestInit | undefined
    const provider = new GeminiGenerationProvider(apiKey, async (requestUrl, requestInit) => {
      url = typeof requestUrl === 'string' ? requestUrl : requestUrl.toString()
      init = requestInit
      return response()
    }, undefined, undefined, 'system rules', 1_000)

    const result = await provider.generate('user prompt', GEMINI_MODEL)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>

    expect(url).toBe(GEMINI_GENERATE_CONTENT_URL)
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': apiKey })
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: 'system rules' }] },
      contents: [{ role: 'user', parts: [{ text: 'user prompt' }] }],
      generationConfig: {
        candidateCount: 1,
        maxOutputTokens: 4_000,
        responseMimeType: 'application/json',
        responseJsonSchema: geminiResponseJsonSchema,
      },
    })
    expect(JSON.stringify(body)).not.toContain(apiKey)
    const schema = body.generationConfig && typeof body.generationConfig === 'object' ? (body.generationConfig as Record<string, unknown>).responseJsonSchema : undefined
    const schemaText = JSON.stringify(schema)
    expect(schemaText).not.toContain('"$schema"')
    expect(schemaText).not.toContain('minLength')
    expect(schemaText).not.toContain('maxLength')
    expect(schemaText).not.toContain('exclusiveMinimum')
    expect(schemaText).not.toContain('"const"')
    expect(schemaText).toContain('"enum":["tool"]')
    expect(schemaText).toContain('"enum":["decision"]')
    expect(result.content).toBe(wire)
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 34 })
    expect(result.usageMetadata).toEqual({ promptTokenCount: 12, candidatesTokenCount: 34, thoughtsTokenCount: 5, totalTokenCount: 51 })
  })

  it('extracts only text parts from a completed candidate and keeps public usage names', async () => {
    const provider = new GeminiGenerationProvider(apiKey, async () => Response.json({
      candidates: [{
        content: { role: 'model', parts: [{ inlineData: { mimeType: 'text/plain', data: 'ignored' } }, { text: wire }, { functionCall: { name: 'ignored' } }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
    }))

    await expect(provider.generate('prompt', GEMINI_MODEL)).resolves.toMatchObject({ content: wire, usage: { inputTokens: 1, outputTokens: 2 } })
  })

  it('rejects a prompt blocked by Gemini without exposing the remote body', async () => {
    const remoteBody = `blocked ${apiKey}`
    const provider = new GeminiGenerationProvider(apiKey, async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' }, detail: remoteBody }))

    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ code: 'prompt-blocked' })
    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.not.toThrow(remoteBody)
  })

  it('classifies an empty candidate, safety block, and truncation', async () => {
    const cases = [
      { payload: { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }, code: 'candidate-empty' },
      { payload: { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }, code: 'safety-block' },
      { payload: { candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }] }, code: 'safety-block' },
      { payload: { candidates: [{ content: { parts: [{ text: wire }] }, finishReason: 'MAX_TOKENS' }] }, code: 'truncated' },
    ] as const

    for (const item of cases) {
      const provider = new GeminiGenerationProvider(apiKey, async () => Response.json(item.payload))
      await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ code: item.code })
    }
  })

  it('classifies IMAGE_SAFETY prompt refusals as safety blocks', async () => {
    const provider = new GeminiGenerationProvider(apiKey, async () => Response.json({ promptFeedback: { blockReason: 'IMAGE_SAFETY' } }))

    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ code: 'safety-block' })
  })

  it.each([null, 'not-an-object', 42, []])('classifies a non-object Gemini payload as invalid-response: %s', async (payload) => {
    const provider = new GeminiGenerationProvider(apiKey, async () => Response.json(payload))

    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('validates the candidate JSON against the shared wire contract', async () => {
    const provider = new GeminiGenerationProvider(apiKey, async () => Response.json({
      candidates: [{ content: { parts: [{ text: '{"type":"decision","decision":{}}' }] }, finishReason: 'STOP' }],
    }))

    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it.each([
    [408, 'timeout'],
    [401, 'authentication'],
    [403, 'authentication'],
    [429, 'rate-limit'],
    [500, 'server-error'],
    [503, 'server-error'],
  ] as const)('classifies HTTP %s without parsing or exposing the response body', async (status, code) => {
    const provider = new GeminiGenerationProvider(apiKey, async () => new Response(`remote ${apiKey}`, { status }))

    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ status, code })
    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.not.toThrow(apiKey)
  })

  it('classifies malformed remote JSON without exposing its body', async () => {
    const provider = new GeminiGenerationProvider(apiKey, async () => new Response(`not-json ${apiKey}`, { status: 200 }))

    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ code: 'invalid-json' })
    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.not.toThrow(apiKey)
  })

  it('sanitizes arbitrary network and JSON errors without exposing body, URL, or secret', async () => {
    const networkError = `network ${GEMINI_GENERATE_CONTENT_URL} ${apiKey} remote-body`
    const networkProvider = new GeminiGenerationProvider(apiKey, async () => { throw new Error(networkError) })
    await expect(networkProvider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ code: 'server-error' })
    await expect(networkProvider.generate('prompt', GEMINI_MODEL)).rejects.not.toThrow(apiKey)
    await expect(networkProvider.generate('prompt', GEMINI_MODEL)).rejects.not.toThrow(GEMINI_GENERATE_CONTENT_URL)
    await expect(networkProvider.generate('prompt', GEMINI_MODEL)).rejects.not.toThrow('remote-body')

    const jsonProvider = new GeminiGenerationProvider(apiKey, async () => {
      const response = new Response('remote-body')
      Object.defineProperty(response, 'json', { value: async () => { throw new Error(`${GEMINI_GENERATE_CONTENT_URL} ${apiKey} ${response}`) } })
      return response
    })
    await expect(jsonProvider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ code: 'invalid-json' })
    await expect(jsonProvider.generate('prompt', GEMINI_MODEL)).rejects.not.toThrow(apiKey)
    await expect(jsonProvider.generate('prompt', GEMINI_MODEL)).rejects.not.toThrow(GEMINI_GENERATE_CONTENT_URL)
  })

  it('honours an external abort before dispatch and does not stream', async () => {
    let calls = 0
    const provider = new GeminiGenerationProvider(apiKey, async () => { calls++; return response() })
    const controller = new AbortController()
    controller.abort()

    await expect(provider.generate('prompt', GEMINI_MODEL, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(calls).toBe(0)
    expect('generateStream' in provider).toBe(false)
  })

  it('aborts the fetch when the provider timeout elapses', async () => {
    let aborted = false
    const provider = new GeminiGenerationProvider(apiKey, async (_url, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('fetch aborted')) }, { once: true })
    }), undefined, undefined, undefined, 10)

    await expect(provider.generate('prompt', GEMINI_MODEL)).rejects.toMatchObject({ code: 'timeout' })
    expect(aborted).toBe(true)
  })

  it('accepts a configured Gemini model on the fixed API host', async () => {
    const requested: string[] = []
    const provider = new GeminiGenerationProvider(apiKey, async (input) => { requested.push(String(input)); return response() })
    await expect(provider.generate('prompt', 'gemini-3.7-flash')).resolves.toMatchObject({ content: wire })
    expect(requested[0]).toContain('/models/gemini-3.7-flash:generateContent')
  })

  it('rejects an invalid model identifier', async () => {
    const provider = new GeminiGenerationProvider(apiKey, async () => response())
    await expect(provider.generate('prompt', 'another model')).rejects.toMatchObject({ code: 'invalid-config' })
  })
})
