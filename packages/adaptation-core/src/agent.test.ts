import { describe, expect, it } from 'vitest'
import { agentDecisionJsonSchema, buildAgentInstructions, buildAgentPrompt, runAgentLoop } from './agent'
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
    expect(fictional).toContain(JSON.stringify(agentDecisionJsonSchema))
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
