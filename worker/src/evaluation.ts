export interface RetrievalFixture { query: number[]; relevantIds: string[]; documents: { id: string; vector: number[] }[] }

function cosine(a: number[], b: number[]): number { const length = Math.min(a.length, b.length); let dot = 0; let an = 0; let bn = 0; for (let i = 0; i < length; i += 1) { dot += a[i] * b[i]; an += a[i] ** 2; bn += b[i] ** 2 } return an && bn ? dot / Math.sqrt(an * bn) : 0 }
export function evaluateRecallAt5(fixtures: RetrievalFixture[], dimensions: 768 | 1024): number {
  if (!fixtures.length) return 0
  let hits = 0
  for (const fixture of fixtures) {
    const top = fixture.documents.map((document) => ({ id: document.id, score: cosine(fixture.query.slice(0, dimensions), document.vector.slice(0, dimensions)) })).sort((a, b) => b.score - a.score).slice(0, 5)
    if (top.some((item) => fixture.relevantIds.includes(item.id))) hits += 1
  }
  return hits / fixtures.length
}

export interface CitationFixture { citedIds: string[]; validIds: string[] }
export function evaluateCitationPrecision(fixtures: CitationFixture[]): number {
  const cited = fixtures.flatMap((fixture) => fixture.citedIds)
  if (!cited.length) return 1
  const valid = fixtures.reduce((total, fixture) => total + fixture.citedIds.filter((id) => fixture.validIds.includes(id)).length, 0)
  return valid / cited.length
}

/** Gate conservador: 1024 solo se activa si mejora Recall@5 ≥3 pp sin perder precisión. */
export function passesDimensionGate(fixtures: RetrievalFixture[], citationPrecision768: number, citationPrecision1024: number): boolean {
  const recall768 = evaluateRecallAt5(fixtures, 768)
  const recall1024 = evaluateRecallAt5(fixtures, 1024)
  return recall1024 - recall768 >= 0.03 && citationPrecision1024 >= citationPrecision768
}

/** Fixtures sintéticos para comparar 768/1024 sin descargar ni seleccionar el corpus real. */
export const SYNTHETIC_FIXTURES: RetrievalFixture[] = [
  { query: [1, 0, 0, 0], relevantIds: ['safety'], documents: [{ id: 'safety', vector: [1, 0, 0, 0] }, { id: 'noise', vector: [0, 1, 0, 0] }] },
  { query: [0, 1, 0, 0], relevantIds: ['progression'], documents: [{ id: 'progression', vector: [0, 1, 0, 0] }, { id: 'noise-2', vector: [0, 0, 1, 0] }] },
]
