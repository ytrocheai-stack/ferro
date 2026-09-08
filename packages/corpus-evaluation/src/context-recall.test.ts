import { expect, it } from 'vitest'
import { evaluateContextRecallAt5 } from './index.mjs'

it('measures the delivered context rather than the pre-expansion vector ranking', () => {
  const reference = { queries: [{ queryId: 'q1', relevantChunkIds: ['abstract'] }] }
  const manifest = { chunks: [{ id: 'abstract', text: 'Results' }, { id: 'intro', text: 'Background' }] }
  const citations = [{ queryId: 'q1', retrievedChunkIds: ['abstract', 'intro'], retrievedContext: [{ id: 'abstract', text: 'Results' }, { id: 'intro', text: 'Background' }], vectorRetrievedChunkIds: ['intro'] }]
  expect(evaluateContextRecallAt5(citations, reference, manifest)).toBe(1)
  expect(() => evaluateContextRecallAt5([{ ...citations[0], retrievedContext: [{ id: 'abstract', text: 'Fabricated' }] }], reference, manifest)).toThrow()
})
