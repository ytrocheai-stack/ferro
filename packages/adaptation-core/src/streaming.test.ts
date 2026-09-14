import { describe, expect, it } from 'vitest'
import { agentWireResponseSchema, runAgentProtocol } from './agent'
import { SafeDecisionExplanationParser, parseSseEvents } from './streaming'

const decision = JSON.stringify({ type: 'decision', decision: { kind: 'maintain', explanation: 'Mantén la técnica 🏋️ y el plan.', observations: [], evidence: [] } })
const event = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

describe('safe coach SSE extraction', () => {
  it('reassembles cut SSE/JSON fragments and emits only validated explanation text', () => {
    const emitted: string[] = []
    const parser = new SafeDecisionExplanationParser(text => emitted.push(text))
    const stream = event(decision.slice(0, 17)) + event(decision.slice(17, 41)) + event(decision.slice(41)) + 'data: [DONE]\n\n'
    for (const fragment of [stream.slice(0, 9), stream.slice(9, 33), stream.slice(33, 71), stream.slice(71)]) parser.push(fragment)
    expect(emitted).toEqual([])
    const result = parser.finish()
    expect(result.response.type).toBe('decision')
    expect(result.explanation).toContain('🏋️')
    expect(emitted).toEqual(['Mantén la técnica 🏋️ y el plan.'])
  })

  it('ignores a tool message before the final decision and rejects truncation', () => {
    const parser = new SafeDecisionExplanationParser()
    parser.push(event(JSON.stringify({ type: 'tool', name: 'goals', arguments: {} })) + event(decision))
    expect(parser.finish().response.type).toBe('decision')
    const truncated = new SafeDecisionExplanationParser()
    truncated.push(event(decision.slice(0, -3)))
    expect(() => truncated.finish()).toThrow('stream-final-decision-missing-or-invalid')
  })

  it('transports a tool-only turn so the durable protocol can execute it and continue', async () => {
    const calls: string[] = []
    let attempt = 0
    const result = await runAgentProtocol({
      maxCalls: 2,
      deadlineAt: Date.now() + 1_000,
      prompt: () => 'prompt',
      generate: async () => {
        attempt++
        if (attempt === 1) {
          const parser = new SafeDecisionExplanationParser()
          parser.push(event(JSON.stringify({ type: 'tool', name: 'goals', arguments: {} })))
          return JSON.stringify(parser.finish().response)
        }
        return decision
      },
      parse: content => agentWireResponseSchema.parse(JSON.parse(content)),
      runTool: async tool => { calls.push(tool.name); return { goals: ['fuerza'] } },
    })
    expect(calls).toEqual(['goals'])
    expect(result.decision.kind).toBe('maintain')
  })

  it('handles escapes split across JSON fragments and only calls back after finish validation', () => {
    const wire = JSON.stringify({ type: 'decision', decision: { kind: 'maintain', explanation: 'Dice "mantén" y sigue.', observations: [], evidence: [] } })
    const split = wire.indexOf('\\"') + 1
    const emitted: string[] = []
    const parser = new SafeDecisionExplanationParser(text => emitted.push(text))
    parser.push(event(wire.slice(0, split)))
    expect(emitted).toEqual([])
    parser.push(event(wire.slice(split)))
    expect(emitted).toEqual([])
    expect(parser.finish().explanation).toBe('Dice "mantén" y sigue.')
    expect(emitted).toEqual(['Dice "mantén" y sigue.'])
  })

  it('rejects invalid JSON without publishing an explanation', () => {
    const emitted: string[] = []
    const parser = new SafeDecisionExplanationParser(text => emitted.push(text))
    parser.push(event('{"type":"decision","decision":{"kind":'))
    expect(() => parser.finish()).toThrow('stream-final-decision-missing-or-invalid')
    expect(emitted).toEqual([])
  })

  it('handles multiple SSE events with split lines', () => {
    expect(parseSseEvents(['data: one\n', '\ndata: two', '\n\n'])).toEqual([{ data: 'one' }, { data: 'two' }])
  })
})
