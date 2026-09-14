import { agentWireResponseSchema, type AgentWireResponse } from './agent.ts'
import type { AgentDecision } from './contract.ts'

export interface SseEvent {
  data: string
}

/** Decodifica eventos SSE incluso cuando las líneas llegan partidas entre chunks. */
export function parseSseEvents(chunks: Iterable<string>): SseEvent[] {
  const events: SseEvent[] = []
  let pending = ''
  let data: string[] = []
  const flush = () => {
    if (data.length) events.push({ data: data.join('\n') })
    data = []
  }
  for (const chunk of chunks) {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) { flush(); continue }
      if (line.startsWith(':')) continue
      if (line.startsWith('data:')) data.push(line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5))
    }
  }
  if (pending) {
    if (pending.startsWith('data:')) data.push(pending.slice(5).startsWith(' ') ? pending.slice(6) : pending.slice(5))
  }
  flush()
  return events
}

function completeJsonValues(buffer: string): { values: string[]; rest: string } {
  const values: string[] = []
  let start = 0
  while (start < buffer.length) {
    while (start < buffer.length && /\s/.test(buffer[start]!)) start++
    if (start >= buffer.length) return { values, rest: '' }
    if (buffer[start] !== '{' && buffer[start] !== '[') return { values, rest: buffer.slice(start) }
    const opening = buffer[start]
    const closing = opening === '{' ? '}' : ']'
    let depth = 0
    let escaped = false
    let inString = false
    let end = -1
    for (let index = start; index < buffer.length; index++) {
      const char = buffer[index]!
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') { inString = true; continue }
      if (char === opening) depth++
      else if (char === closing && --depth === 0) { end = index + 1; break }
    }
    if (end < 0) return { values, rest: buffer.slice(start) }
    values.push(buffer.slice(start, end))
    start = end
  }
  return { values, rest: '' }
}

function sseContent(data: string): string | null {
  if (data === '[DONE]') return null
  try {
    const value = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> }
    const choice = value.choices?.[0]
    const content = choice?.delta?.content ?? choice?.message?.content
    return typeof content === 'string' ? content : ''
  } catch {
    return ''
  }
}

export interface ValidatedStreamResult {
  response: AgentWireResponse
  explanation: string
}

/**
 * Buffers model fragments, ignores complete tool messages, and only publishes
 * explanation text after a complete final decision passes the real schema.
 */
export class SafeDecisionExplanationParser {
  private sseBuffer = ''
  private jsonBuffer = ''
  private result?: ValidatedStreamResult
  private done = false
  private truncated = false
  constructor(private readonly onExplanation?: (text: string) => void) {}

  push(chunk: string): void {
    if (this.done) return
    this.sseBuffer += chunk
    const lines = this.sseBuffer.split(/\r?\n/)
    this.sseBuffer = lines.pop() ?? ''
    for (const line of lines) this.consumeLine(line)
  }

  finish(): ValidatedStreamResult {
    if (this.sseBuffer) this.consumeLine(this.sseBuffer)
    if (this.truncated || !this.result) throw new Error(this.truncated ? 'stream-final-decision-truncated' : 'stream-final-decision-missing-or-invalid')
    this.done = true
    return this.result
  }

  private consumeLine(line: string): void {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5)
    try {
      const envelope = JSON.parse(data) as { choices?: Array<{ finish_reason?: unknown }> }
      if (envelope.choices?.[0]?.finish_reason === 'length') this.truncated = true
    } catch { /* content parsing below handles malformed envelopes */ }
    const content = sseContent(data)
    if (content === null) return
    if (this.result) return
    this.jsonBuffer += content
    const parsed = completeJsonValues(this.jsonBuffer)
    this.jsonBuffer = parsed.rest
    for (const raw of parsed.values) {
      let wire: AgentWireResponse
      try { wire = agentWireResponseSchema.parse(JSON.parse(raw)) } catch { continue }
      if (wire.type === 'tool') continue
      this.result = { response: wire, explanation: wire.decision.explanation }
      this.onExplanation?.(wire.decision.explanation)
      return
    }
  }
}

export function validateStreamDecision(value: unknown): AgentDecision {
  const wire = agentWireResponseSchema.parse(value)
  if (wire.type !== 'decision') throw new Error('stream-final-decision-required')
  return wire.decision
}
