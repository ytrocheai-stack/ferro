import { describe, expect, it } from 'vitest'
import { NvidiaGenerationProvider, selectEvidence, VectorizeRetriever, type D1Database } from './index'
import { corpusMetadataKey, vectorPhysicalId } from '../../packages/corpus-identity/src/index.mjs'
import { buildAgentInstructions } from '../../packages/adaptation-core/src/agent'

describe('Kimi generation transport', () => {
  it('sends coach behavior as a system message separate from user data', async () => {
    let body: Record<string, unknown> = {}
    const instructions = buildAgentInstructions('private-real', { includeContract: false })
    const provider = new NvidiaGenerationProvider('test', async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ message: { content: '{}' } }] })
    }, undefined, undefined, instructions)
    await provider.generate('contexto consentido', 'deepseek-ai/deepseek-v4-flash-0731')
    expect(body.messages).toEqual([{ role: 'system', content: instructions }, { role: 'user', content: 'contexto consentido' }])
  })
  it('hydrates only eligible abstracts from retrieved sources with logical split ordering', async () => {
    const metadata = (chunkId: string, sourceId = 's1') => ({ chunkId, sourceId, corpusVersion: 'v1', corpusKey: corpusMetadataKey('v1'), retrievalClass: 'evidence', populationReviewed: 'false', population: 'unknown', section: chunkId === 'intro' ? 'Introduction' : 'Abstract', text: chunkId })
    const rows = ['abstract-0002', 'abstract-0001', 'unrelated'].map(id => ({ vector_id: vectorPhysicalId('v1', id), metadata_json: JSON.stringify(metadata(id, id === 'unrelated' ? 's2' : 's1')) }))
    const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) } as unknown as D1Database
    const retriever = new VectorizeRetriever({ query: async () => ({ matches: [{ id: vectorPhysicalId('v1', 'intro'), score: 0.9, metadata: metadata('intro') }] }) }, 'v1', db)
    expect((await retriever.retrieve([1], 20, { mode: 'research' })).map(x => x.metadata?.chunkId)).toEqual(['abstract-0001', 'abstract-0002', 'intro'])
    expect(await retriever.retrieve([1], 20, { mode: 'recommendation', population: ['adult-general'] })).toEqual([])
  })
  it('keeps enriched summary context in its intended order including split abstracts', () => {
    const matches = ['summary-a', 'summary-b', 'intro'].map((id, contextRank) => ({ id, score: contextRank === 2 ? 0.9 : 0.8, contextRank }))
    const metadata = new Map(matches.map(x => [x.id, { source: 'article', sourceId: 'same', evidenceLevel: 1, text: x.id }]))
    expect(selectEvidence(matches, metadata).map(x => x.id)).toEqual(['summary-a', 'summary-b', 'intro'])
  })
  it('bounds output and uses the Kimi reasoning protocol', async () => {
    let body: Record<string, unknown> = {}
    const provider = new NvidiaGenerationProvider('test', async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 20 } })
    })
    expect((await provider.generate('consulta', 'moonshotai/kimi-k3')).content).toBe('{"ok":true}')
    expect(body).toMatchObject({ model: 'moonshotai/kimi-k3', max_tokens: 4000, temperature: 1, reasoning_effort: 'low' })
  })
  it.each([{ finish_reason: 'length', content: '{"partial":true}' }, { finish_reason: 'stop', content: '   ' }])('rejects invalid final output %j', async ({ finish_reason, content }) => {
    const provider = new NvidiaGenerationProvider('test', async () => Response.json({ choices: [{ finish_reason, message: { content } }] }))
    await expect(provider.generate('consulta', 'moonshotai/kimi-k3')).rejects.toThrow()
  })
  it('validates fragmented SSE JSON before publishing only the final explanation', async () => {
    const wire = JSON.stringify({ type: 'decision', decision: { kind: 'maintain', explanation: 'Mantén el plan.', observations: [], evidence: [] } })
    const payload = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
    const bytes = [payload(wire.slice(0, 11)), payload(wire.slice(11)) + 'data: [DONE]\n\n'].map(value => new TextEncoder().encode(value))
    let callback = ''
    const provider = new NvidiaGenerationProvider('test', async () => new Response(new ReadableStream({
      start(controller) { for (const chunk of bytes) controller.enqueue(chunk); controller.close() },
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const result = await provider.generateStream('consulta', 'moonshotai/kimi-k3', undefined, value => { callback += value })
    expect(JSON.parse(result.content)).toEqual(JSON.parse(wire))
    expect(callback).toBe('Mantén el plan.')
  })
})
