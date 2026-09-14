import { describe, expect, it } from 'vitest'
import { SafeDecisionExplanationParser, parseSseEvents } from './streaming'

const decision = JSON.stringify({ type: 'decision', decision: { kind: 'maintain', explanation: 'Mantén la técnica 🏋️ y el plan.', observations: [], evidence: [] } })
const event = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

describe('safe coach SSE extraction', () => {
  it('reassembles cut SSE/JSON fragments and emits only validated explanation text', () => {
    const emitted: string[] = []
    const parser = new SafeDecisionExplanationParser(text => emitted.push(text))
    const stream = event(decision.slice(0, 17)) + event(decision.slice(17, 41)) + event(decision.slice(41)) + 'data: [DONE]\n\n'
    for (const fragment of [stream.slice(0, 9), stream.slice(9, 33), stream.slice(33, 71), stream.slice(71)]) parser.push(fragment)
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

  it('handles multiple SSE events with split lines', () => {
    expect(parseSseEvents(['data: one\n', '\ndata: two', '\n\n'])).toEqual([{ data: 'one' }, { data: 'two' }])
  })
})
