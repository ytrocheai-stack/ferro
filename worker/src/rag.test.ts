import { describe, expect, it } from 'vitest'
import { deriveNormalizedPrefixes, importApprovedCorpus, type ApprovedChunk } from './rag'

const chunk: ApprovedChunk = { id: 'c1', sourceId: 's1', text: 'progression', corpusVersion: 'v1', source: { id: 's1', title: 'Evidence', url: 'https://example.test', license: 'CC-BY', evidenceLevel: 3, approvedAt: 1 } }

describe('RAG corpus importer', () => {
  it('derives normalized 768 and 1024 prefixes from one 2048 vector', () => {
    const values = deriveNormalizedPrefixes(Array.from({ length: 2048 }, (_, index) => index === 0 ? 1 : 0))
    expect(values.values768).toHaveLength(768)
    expect(values.values1024).toHaveLength(1024)
    expect(values.values768[0]).toBe(1)
  })

  it('embeds every passage once and writes the approved metadata', async () => {
    const calls: string[] = []
    const writes: { id: string; values: number[]; metadata: Record<string, string> }[][] = []
    const count = await importApprovedCorpus([chunk], { embed: async (text, inputType) => { calls.push(`${text}:${inputType}`); return [1, ...Array.from({ length: 2047 }, () => 0)] } }, { primary: { upsert: async (items) => { writes.push(items) } } })
    expect(count).toBe(1)
    expect(calls).toEqual(['progression:passage'])
    expect(writes[0][0].metadata.license).toBe('CC-BY')
  })
})
