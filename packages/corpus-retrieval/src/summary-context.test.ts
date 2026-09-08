import { expect, it } from 'vitest'
import { enrichWithSourceSummaries } from './summary-context.mjs'

it('adds the complete abstract of retrieved sources before background passages without using relevance labels', () => {
  const chunks = [
    { id: 's1-intro', sourceId: 's1', location: 'Introduction' },
    { id: 's1-abstract-a', sourceId: 's1', location: 'Abstract' },
    { id: 's1-abstract-b', sourceId: 's1', location: 'Abstract' },
    { id: 'unretrieved', sourceId: 's2', location: 'Abstract' },
  ]
  expect(enrichWithSourceSummaries([{ id: 's1-intro', score: 0.9 }], chunks).map(x => x.id)).toEqual(['s1-abstract-a', 's1-abstract-b', 's1-intro'])
})

it('keeps source ranking and refuses excluded summaries or duplicate passages', () => {
  const chunks = [{ id: 'a', sourceId: 'one', location: 'Abstract' }, { id: 'b', sourceId: 'two', location: 'Introduction' }, { id: 'excluded', sourceId: 'two', location: 'Abstract' }]
  const matches = [{ id: 'b', score: 0.95 }, { id: 'a', score: 0.8 }]
  expect(enrichWithSourceSummaries(matches, chunks, c => c.id !== 'excluded').map(x => x.id)).toEqual(['b', 'a'])
})
