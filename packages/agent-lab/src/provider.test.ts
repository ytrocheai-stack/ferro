import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runProviderLab, createGeminiLabProvider } from './provider'
import { developmentScenarios } from './scenarios'
import type { LabCorpus } from './types'
import { runLab } from './orchestrator'
import { GEMINI_GENERATION_MODEL, GEMINI_PROJECT_NAME, GEMINI_PROJECT_NUMBER, GEMINI_PROJECT_QUOTA } from '../../corpus-pipeline/src/gemini-session'
import type { GeminiAuthorization } from '../../corpus-pipeline/src/gemini-session'

const corpus: LabCorpus = { version: 'synthetic-v1', status: 'approved', sources: [{ id: 'source', title: 'Fixture', author: 'Fixture', url: 'https://example.com', license: 'fixture', approved: true }], chunks: [{ id: 'chunk', sourceId: 'source', text: 'carga entrenamiento progresión', location: 'fixture:1' }] }
const input = () => structuredClone(developmentScenarios[0].input)
const config = { providerAvailable: true, budgetVerified: true }
const maintain = { type: 'decision', decision: { kind: 'maintain', explanation: 'La evidencia no justifica cambiar el plan.', observations: [], evidence: [] } }
const geminiAuthorization = (): GeminiAuthorization => ({
  provider: 'google-ai-studio', projectName: GEMINI_PROJECT_NAME, projectNumber: GEMINI_PROJECT_NUMBER,
  accessVerified: true, budgetVerified: true, maxAdditionalCost: 0, verifiedAt: new Date().toISOString(),
  reviewer: 'fixture-reviewer', evidence: 'fixture free-tier quota review', projectQuota: GEMINI_PROJECT_QUOTA,
  model: GEMINI_GENERATION_MODEL, embeddingModel: 'nvidia/nemotron-3-embed-1b',
  requestsPerMinute: 10, tokensPerMinute: 250_000, requestsPerDay: 100,
  maxInputTokens: 50_000, maxOutputTokens: 2_000, timeoutMs: 10_000,
  maxTotalCalls: 10, maxTotalInputTokens: 100_000, maxTotalOutputTokens: 10_000,
  allocations: {
    benchmark: { calls: 2, inputTokens: 1_000, outputTokens: 1_000 },
    lab: { calls: 4, inputTokens: 50_000, outputTokens: 4_000 },
    smoke: { calls: 2, inputTokens: 1_000, outputTokens: 1_000 },
  },
})

describe('H1/H7: decisión por modelo y límites antes de facturar', () => {
  it('en modo solicitudes limita cada salida y los turnos sin agotar un saldo acumulado de tokens', async () => {
    let calls = 0
    const provider = { id: 'fixture-model', kind: 'stub' as const, generate: async (request: { maxOutputTokens: number }) => {
      expect(request.maxOutputTokens).toBe(1000)
      calls++
      return { content: JSON.stringify(calls === 1 ? { type: 'tool', name: 'metrics', arguments: {} } : maintain), usage: { inputTokens: 1000, outputTokens: 900 } }
    } }
    const result = await runProviderLab(input(), corpus, provider, { ...config, accountingMode: 'requests', budget: { maxCalls: 2, maxOutputTokens: 1000 } })
    expect(result.decision.kind).toBe('maintain')
    expect(result.usage?.outputTokens).toBe(1800)
  })
  it('aplica el tope de salida por turno mientras conserva un presupuesto acumulado del run', async () => {
    const limits: number[] = []
    let calls = 0
    const provider = { id: 'fixture-gemini', kind: 'stub' as const, generate: async (request: { maxOutputTokens: number }) => {
      limits.push(request.maxOutputTokens)
      calls++
      return { content: JSON.stringify(calls === 1 ? { type: 'tool', name: 'metrics', arguments: {} } : maintain), usage: { inputTokens: 100, outputTokens: 75 } }
    } }
    const result = await runProviderLab(input(), corpus, provider, { ...config, maxOutputTokensPerCall: 300, budget: { maxCalls: 2, maxOutputTokens: 1_500 } })
    expect(result.decision.kind).toBe('maintain')
    expect(limits).toEqual([300, 300])
    expect(result.usage?.outputTokens).toBe(150)
  })
  it('usa decisión libre del proveedor con evidencia previa y herramientas', async () => {
    let calls = 0
    const provider = { id: 'fixture-flash', kind: 'stub' as const, generate: async (request: { prompt: string }) => {
      calls++
      const context = JSON.parse(request.prompt)
      expect(context.research.evidence[0].sourceId).toBe('source')
      if (calls === 1) return { content: JSON.stringify({ type: 'tool', name: 'metrics', arguments: {} }), usage: { inputTokens: 100, outputTokens: 30 } }
      expect(context.turns.at(-1).result.metrics.workingSetCount).toBe(12)
      return { content: JSON.stringify(maintain), usage: { inputTokens: 150, outputTokens: 50 } }
    } }
    const result = await runProviderLab(input(), corpus, provider, config)
    expect(result.decision.kind).toBe('maintain')
    expect(result.decision.executionMode).toBe('provider')
    expect(result.calls).toBe(2)
    expect(result.usage).toEqual({ inputTokens: 250, outputTokens: 80 })
    expect(result.decision.trace.map(t => t.agent)).toEqual(['research', 'training'])
  })
  it('no llama con acceso/budget sin comprobar ni con entrada demasiado grande', async () => {
    let calls = 0
    const provider = { id: 'fixture', kind: 'stub' as const, generate: async () => { calls++; return { content: JSON.stringify(maintain) } } }
    for (const settings of [{ providerAvailable: true }, { ...config, budget: { maxCalls: 0 } }, { ...config, budget: { maxInputTokens: 1 } }]) {
      expect((await runProviderLab(input(), corpus, provider, settings)).decision.kind).toBe('unavailable')
    }
    expect(calls).toBe(0)
  })
  it('acepta un ajuste libre de series del modelo en lugar de progresión local de carga', async () => {
    const context = input()
    const baseline = runLab(context, corpus).decision
    if (baseline.kind !== 'propose') throw new Error('Fixture inválido')
    const changeSet = structuredClone(baseline.changeSet)
    const exercise = changeSet.futurePlan!.sessions[0].exercises[0]
    exercise.plannedSets = 2
    exercise.setTargets = context.plan.sessions[0].exercises[0].setTargets.slice(0, 2)
    const op = changeSet.operations[0]
    if (op.kind !== 'routine') throw new Error('Fixture inválido')
    op.patch.plannedSets = 2
    const evidence = [{ claim: 'carga entrenamiento progresión', sourceId: 'source', location: 'fixture:1', excerpt: 'carga entrenamiento progresión', relevance: 1 }]
    changeSet.evidence = evidence.map(({ claim, sourceId, location, excerpt }) => ({ claim, sourceId, location, excerpt }))
    const result = await runProviderLab(context, corpus, { id: 'fixture', kind: 'stub', generate: async () => ({ content: JSON.stringify({ type: 'decision', decision: { kind: 'propose', explanation: 'Propongo dos series por recuperación.', observations: [{ kind: 'observation', source: 'history', text: 'Se registraron tres series.' }], evidence, changeSet } }), usage: { inputTokens: 100, outputTokens: 100 } }) }, config)
    expect(result.decision.kind).toBe('propose')
    if (result.decision.kind === 'propose') expect(result.decision.changeSet.futurePlan!.sessions[0].exercises[0].setTargets).toEqual([{ type: 'normal', weightKg: 100, reps: 5 }, { type: 'normal', weightKg: 100, reps: 5 }])
  })
  it('frena bucles antes de la segunda llamada y contabiliza consumo desconocido', async () => {
    const provider = { id: 'fixture', kind: 'stub' as const, generate: async () => ({ content: JSON.stringify({ type: 'tool', name: 'metrics', arguments: {} }) }) }
    const result = await runProviderLab(input(), corpus, provider, { ...config, budget: { maxCalls: 1 } })
    expect(result.calls).toBe(1)
    expect(result.uncertainCalls).toBe(1)
    expect(result.decision.kind).toBe('unavailable')
  })
  it('cancela timeout incluso si el adaptador no resuelve y no escala', async () => {
    let signal: AbortSignal | undefined
    const provider = { id: 'fixture', kind: 'stub' as const, generate: (request: { signal: AbortSignal }) => { signal = request.signal; return new Promise<never>(() => {}) } }
    // Leave enough headroom for schema/prompt construction; the assertion is
    // about abort propagation, not a sub-10ms scheduling race.
    const result = await runProviderLab(input(), corpus, provider, { ...config, budget: { timeoutMs: 100 } })
    expect(signal?.aborted).toBe(true)
    expect(result.calls).toBe(1)
    expect(result.uncertainCalls).toBe(1)
    expect(result.decision.kind).toBe('unavailable')
  })
  it('no reintenta 429', async () => {
    let calls = 0
    const provider = { id: 'fixture', kind: 'stub' as const, generate: async () => { calls++; throw Object.assign(new Error('429'), { status: 429 }) } }
    const result = await runProviderLab(input(), corpus, provider, config)
    expect(calls).toBe(1)
    expect(result.decision).toMatchObject({ kind: 'unavailable', reason: 'provider-rate-limited' })
  })
  it('rechaza citas inventadas y JSON malformado sin fallback deportivo', async () => {
    for (const content of ['{bad', JSON.stringify({ type: 'decision', decision: { ...maintain.decision, evidence: [{ sourceId: 'invented', claim: 'x', location: 'x', relevance: 1 }] } })]) {
      const result = await runProviderLab(input(), corpus, { id: 'fixture', kind: 'stub', generate: async () => ({ content }) }, config)
      expect(result.decision.kind).toBe('unavailable')
    }
  })
  it('fija Gemini generación, pasa las instrucciones y reanuda solo el resultado medido del ledger', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextrep-lab-provider-cache-'))
    let calls = 0
    let body: Record<string, unknown> = {}
    let requestedUrl = ''
    const fetcher: typeof fetch = async (url, init) => {
      calls++
      requestedUrl = String(url)
      body = JSON.parse(String(init?.body))
      return Response.json({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(maintain) }] } }],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 20, thoughtsTokenCount: 3, totalTokenCount: 53 },
      })
    }
    const first = createGeminiLabProvider({ apiKey: 'fictitious-key', authorization: geminiAuthorization(), directory, fetcher })
    const second = createGeminiLabProvider({ apiKey: 'fictitious-key', authorization: geminiAuthorization(), directory, fetcher })
    const request = { prompt: '{"case":"same"}', maxOutputTokens: 123, signal: new AbortController().signal, attemptKey: 'stable-attempt' }
    const firstResult = await first.generate(request)
    const resumedResult = await second.generate(request)
    expect(resumedResult).toEqual(firstResult)
    expect(calls).toBe(1)
    expect(first.id).toBe(GEMINI_GENERATION_MODEL)
    expect(requestedUrl).toContain(`/models/${GEMINI_GENERATION_MODEL}:generateContent`)
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: expect.stringContaining('No inventes citas') }] },
      generationConfig: { maxOutputTokens: 123, responseMimeType: 'application/json' },
    })
    expect(body.generationConfig).not.toHaveProperty('candidateCount')
    expect(firstResult.usage).toEqual({ inputTokens: 30, outputTokens: 23 })
  })
  it('rechaza otra generación sin invocar un proveedor de respaldo', () => {
    let calls = 0
    const fetcher: typeof fetch = async () => { calls++; throw new Error('unexpected provider call') }
    const wrongAuthorization = { ...geminiAuthorization(), model: 'moonshotai/kimi-k3' } as unknown as GeminiAuthorization
    expect(() => createGeminiLabProvider({ authorization: wrongAuthorization, directory: mkdtempSync(join(tmpdir(), 'nextrep-lab-wrong-model-')), apiKey: 'fixture', fetcher })).toThrow(/gemini-3\.5-flash-lite/)
    expect(calls).toBe(0)
  })
  it('requireCached detiene el laboratorio antes de cualquier llamada sin respuesta confirmada', async () => {
    let calls = 0
    const provider = createGeminiLabProvider({
      authorization: geminiAuthorization(),
      directory: mkdtempSync(join(tmpdir(), 'nextrep-lab-cache-required-')),
      apiKey: 'fixture',
      requireCached: true,
      fetcher: async () => { calls++; throw new Error('unexpected live request') },
    })
    await expect(provider.generate({ prompt: '{}', maxOutputTokens: 50, signal: new AbortController().signal, attemptKey: 'cache-miss' })).rejects.toThrow(/respuesta cacheada medida/)
    expect(calls).toBe(0)
  })
})
