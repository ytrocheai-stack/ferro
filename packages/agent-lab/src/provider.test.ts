import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runProviderLab, createFlashProvider, createResumableFlashProvider } from './provider'
import { developmentScenarios } from './scenarios'
import type { LabCorpus } from './types'
import { runLab } from './orchestrator'

const corpus: LabCorpus = { version: 'synthetic-v1', status: 'approved', sources: [{ id: 'source', title: 'Fixture', author: 'Fixture', url: 'https://example.com', license: 'fixture', approved: true }], chunks: [{ id: 'chunk', sourceId: 'source', text: 'carga entrenamiento progresión', location: 'fixture:1' }] }
const input = () => structuredClone(developmentScenarios[0].input)
const config = { providerAvailable: true, budgetVerified: true }
const maintain = { type: 'decision', decision: { kind: 'maintain', explanation: 'La evidencia no justifica cambiar el plan.', observations: [], evidence: [] } }

describe('H1/H7: decisión por modelo y límites antes de facturar', () => {
  it('en modo solicitudes limita cada salida y los turnos sin agotar un saldo acumulado de tokens', async () => {
    let calls = 0
    const provider = { id: 'fixture-kimi', kind: 'stub' as const, generate: async (request: { maxOutputTokens: number }) => {
      expect(request.maxOutputTokens).toBe(1000)
      calls++
      return { content: JSON.stringify(calls === 1 ? { type: 'tool', name: 'metrics', arguments: {} } : maintain), usage: { inputTokens: 1000, outputTokens: 900 } }
    } }
    const result = await runProviderLab(input(), corpus, provider, { ...config, accountingMode: 'requests', budget: { maxCalls: 2, maxOutputTokens: 1000 } })
    expect(result.decision.kind).toBe('maintain')
    expect(result.usage?.outputTokens).toBe(1800)
  })
  it('permite Kimi explícito con parámetros compatibles en el adaptador del laboratorio', async () => {
    let body: Record<string, unknown> = {}
    const provider = createFlashProvider('test', 'moonshotai/kimi-k3', async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(maintain) } }] })
    })
    await provider.generate({ prompt: 'consulta', maxOutputTokens: 4000, signal: new AbortController().signal })
    expect(body).toMatchObject({ model: 'moonshotai/kimi-k3', reasoning_effort: 'low', temperature: 1 })
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
  it('el adaptador transmite el límite de salida y el modelo Flash fijado', async () => {
    let body: Record<string, unknown> = {}
    const provider = createFlashProvider('fictitious-key', 'deepseek-ai/deepseek-v4-flash-0731', async (_url, init) => {
      body = JSON.parse(init!.body as string)
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(maintain) } }], usage: { prompt_tokens: 30, completion_tokens: 20 } }))
    })
    const result = await provider.generate({ prompt: '{}', maxOutputTokens: 123, signal: new AbortController().signal })
    expect(body).toMatchObject({ model: 'deepseek-ai/deepseek-v4-flash-0731', max_tokens: 123 })
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 20 })
  })
  it('reanuda una respuesta Flash confirmada sin repetir la llamada', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextrep-lab-provider-cache-'))
    const authorization = {
      accessVerified: true as const, budgetVerified: true as const, maxAdditionalCost: 0 as const,
      verifiedAt: new Date().toISOString(), reviewer: 'capacity-reviewer', evidence: 'quota snapshot',
      model: 'deepseek-ai/deepseek-v4-flash-0731' as const, embeddingModel: 'nvidia/nemotron-3-embed-1b' as const,
      maxCalls: 2, maxInputTokens: 10_000, maxOutputTokens: 2_000, timeoutMs: 10_000,
      maxTotalCalls: 2, maxTotalInputTokens: 20_000, maxTotalOutputTokens: 4_000,
    }
    let calls = 0
    const fetcher: typeof fetch = async (_url, init) => {
      calls++
      expect(JSON.parse(init?.body as string).messages[0].content).toContain('No inventes citas')
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(maintain) } }], usage: { prompt_tokens: 30, completion_tokens: 20 } }))
    }
    const first = createResumableFlashProvider({ apiKey: 'fictitious-key', authorization, directory, fetcher })
    const second = createResumableFlashProvider({ apiKey: 'fictitious-key', authorization, directory, fetcher })
    const request = { prompt: '{"case":"same"}', maxOutputTokens: 123, signal: new AbortController().signal, attemptKey: 'stable-attempt' }
    const firstResult = await first.generate(request)
    const resumedResult = await second.generate(request)
    expect(resumedResult).toEqual(firstResult)
    expect(calls).toBe(1)
  })
})
