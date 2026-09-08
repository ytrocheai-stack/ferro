export const SUMMARY_RETRIEVAL_POLICY = 'source-abstract-context-v1'
/** Source-level grounding: pair the retrieved passage with its own abstract.
 * No benchmark labels or query IDs enter this policy. Scores describe the
 * source's retrieval score, not a fabricated vector similarity for its abstract.
 */
export function enrichWithSourceSummaries(matches, chunks, eligible = () => true, limit = 8) {
  const byId = new Map(chunks.map(chunk => [chunk.id, chunk]))
  const sources = new Map()
  for (const match of matches) {
    const chunk = byId.get(match.id)
    if (!chunk || !eligible(chunk) || !Number.isFinite(match.score)) continue
    if (!sources.has(chunk.sourceId)) sources.set(chunk.sourceId, [])
    sources.get(chunk.sourceId).push(match)
  }
  const result = []
  const seen = new Set()
  const add = match => { if (!seen.has(match.id) && result.length < limit) { result.push(match); seen.add(match.id) } }
  for (const [sourceId, retrieved] of sources) {
    const summaries = chunks.filter(chunk => chunk.sourceId === sourceId && /^abstract$/i.test((chunk.section ?? chunk.location ?? '').trim()) && eligible(chunk)).sort((a, b) => a.id.localeCompare(b.id))
    for (const chunk of summaries) add({ id: chunk.id, score: retrieved[0].score })
    for (const match of retrieved.slice(0, summaries.length ? 1 : 2)) add(match)
  }
  return result
}
