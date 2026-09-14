import { describe, expect, it } from 'vitest'
import { createSemanticSearchEvidence } from './tools'
import type { EmbeddingMatrix } from '../../corpus-retrieval/src/index'
import type { LabCorpus } from './types'

function vector(value: number, second = 0): number[] {
  return [value, second, ...new Array(2046).fill(0)]
}

describe('semantic lab retrieval', () => {
  it('uses the shared matrix retriever and adds the retrieved source abstract', async () => {
    const corpus: LabCorpus = {
      version: 'corpus-test-v1',
      status: 'approved',
      sources: [{ id: 'source-1', author: 'A. Researcher', title: 'Training study', url: 'https://example.test/study', license: 'CC-BY', approved: true }],
      chunks: [
        { id: 'passage-1', sourceId: 'source-1', text: 'A relevant passage about progressive overload.', location: 'Results', section: 'Results', retrievalClass: 'evidence', population: ['adult-general'], populationReviewed: true },
        { id: 'abstract-1', sourceId: 'source-1', text: 'Abstract: adults completed a resistance training protocol.', location: 'Abstract', section: 'Abstract', retrievalClass: 'evidence', population: ['adult-general'], populationReviewed: true },
      ],
    }
    const matrix: EmbeddingMatrix = { corpusVersion: corpus.version, model: 'nvidia/nemotron-3-embed-1b', documents: [{ id: 'passage-1', vector2048: vector(1) }, { id: 'abstract-1', vector2048: vector(0, 1) }] }
    const search = createSemanticSearchEvidence(corpus, matrix, async () => vector(1))
    const evidence = await search('progressive overload', ['adult-general'])
    expect(evidence.map((item) => item.chunkId)).toEqual(['abstract-1', 'passage-1'])
    expect(evidence.every((item) => item.sourceId === 'source-1')).toBe(true)
    expect(await search('progressive overload')).toEqual([])
    corpus.chunks.forEach(chunk => { chunk.populationReviewed = false })
    const unreviewed = createSemanticSearchEvidence(corpus, matrix, async () => vector(1))
    expect(await unreviewed('progressive overload', ['adult-general'])).toEqual([])
  })
})
