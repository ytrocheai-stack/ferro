import { describe, expect, it, vi } from 'vitest'
import { agentWireJsonSchema, buildAgentInstructions, buildAgentPrompt, runAgentLoop, runAgentProtocol } from './agent'
import { SCIENTIFIC_RESULTS_INTERPRETATION_INSTRUCTION } from './science-guidance'
import { coachRunRequestSchema } from './contract'

const request = coachRunRequestSchema.parse({
  event: { id: 'event-agent', accountId: 'user-agent', deviceId: 'device-agent', type: 'message-sent', occurredAt: 1, contextVersion: 'ctx-agent', payload: { message: 'Revisa la rutina' } },
  context: { version: 'ctx-agent', capturedAt: 99, timezone: 'UTC', isCurrent: true, snapshot: {} },
})

describe('shared coach agent protocol', () => {
  it('includes the real decision contract and keeps fictional/private mode explicit', () => {
    const fictional = buildAgentInstructions('fictional')
    const privateMode = buildAgentInstructions('private-real')
    expect(fictional).toContain('laboratorio de datos ficticios')
    expect(privateMode).toContain('contexto consentido')
    expect(privateMode).toContain(SCIENTIFIC_RESULTS_INTERPRETATION_INSTRUCTION)
    expect(privateMode).toContain('Incluye estos matices en `responseText` del benchmark y `decision.explanation` del Coach')
    expect(privateMode).toContain('los `claims` registran respaldo y no sustituyen la explicación')
    expect(privateMode).toContain('En la primera frase de la conclusión')
    expect(privateMode).toContain('organiza la comparación por desenlace')
    expect(privateMode).toContain('Etiqueta las estimaciones globales y por subgrupo')
    expect(privateMode).toContain('presenta mecanismos plausibles como hipótesis')
    expect(privateMode).toContain('No conviertas ausencia de diferencia estadísticamente significativa en equivalencia')
    expect(fictional).toContain(JSON.stringify(agentWireJsonSchema))
    expect(buildAgentPrompt({ request, evidence: [], turns: [], mode: 'private-real' })).toContain('SNAPSHOT CONSENTIDO')
  })

  it('runs one durable protocol turn per tool and then returns a validated decision', async () => {
    const calls: string[] = []
    const result = await runAgentLoop({
      request,
      mode: 'fictional',
      maxCalls: 2,
      deadlineMs: 1_000,
      generate: async () => calls.length === 0
        ? JSON.stringify({ type: 'tool', name: 'goals', arguments: {} })
        : JSON.stringify({ type: 'decision', decision: { kind: 'maintain', explanation: 'Mantén el plan.', observations: [], evidence: [] } }),
      runTool: async (tool) => { calls.push(tool.name); return ['fuerza'] },
      now: () => 1,
    })
    expect(calls).toEqual(['goals'])
    expect(result.decision.kind).toBe('maintain')
    expect(result.turns).toHaveLength(1)
  })
})


describe('bounded protocol execution', () => {
  it('repairs malformed JSON through the public loop without bypassing validation', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('invalid JSON')
      .mockResolvedValueOnce(JSON.stringify({ type: 'decision', decision: { kind: 'maintain', explanation: 'Mantén el plan.', observations: [], evidence: [] } }))
    const result = await runAgentLoop({ request, mode: 'fictional', maxCalls: 2, deadlineMs: 1000, generate, runTool: async () => null })
    expect(result.decision.kind).toBe('maintain')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(result.attempts[0].response).toBeUndefined()
    expect(result.turns[0]).toHaveProperty('validationError')
  })
  it('repairs invalid output within the same call limit without executing a rejected change', async () => {
    let calls = 0
    const prompts: string[] = []
    const result = await runAgentProtocol({ maxCalls: 2, deadlineAt: Date.now() + 1000, prompt: turns => JSON.stringify(turns), generate: async prompt => { prompts.push(prompt); return ++calls === 1 ? 'invalid JSON' : '{"type":"decision","decision":true}' }, parse: content => JSON.parse(content), runTool: async () => { throw new Error('No tool expected') } })
    expect(result.decision).toBe(true)
    expect(calls).toBe(2)
    expect(prompts[1]).toContain('validationError')
  })
  it('bounds a provider which ignores AbortSignal to 120 seconds', async () => {
    vi.useFakeTimers()
    try {
      const generate = vi.fn(() => new Promise<string>(() => undefined))
      const pending = runAgentProtocol({ maxCalls: 4, deadlineAt: Date.now() + 600_000, prompt: () => 'prompt', generate, parse: () => ({ type: 'decision', decision: true }), runTool: async () => null })
      const assertion = expect(pending).rejects.toThrow('agent-deadline-exceeded')
      await vi.advanceTimersByTimeAsync(120_000)
      await assertion
      expect(generate).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('does not send a generation when the persisted deadline has expired', async () => {
    const generate = vi.fn(async () => '')
    await expect(runAgentProtocol({ maxCalls: 4, deadlineAt: 1, now: () => 2, prompt: () => '', generate, parse: () => ({ type: 'decision', decision: true }), runTool: async () => null })).rejects.toThrow('agent-deadline-exceeded')
    expect(generate).not.toHaveBeenCalled()
  })
})
