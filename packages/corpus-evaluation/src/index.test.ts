import { describe, expect, it } from 'vitest'
import { evaluateBenchmark, responseFingerprint } from './index.mjs'

function fixture() {
  const corpusVersion = 'fixture-corpus-v1'
  const source = { id: 'source-1', author: 'Author', title: 'Evidence', url: 'https://example.test/evidence', license: 'CC-BY', language: 'en', approved: true }
  const queries = Array.from({ length: 50 }, (_, index) => {
    const vector = new Array(2048).fill(0)
    if (index < 40) vector[index + 1] = 1
    else { vector[0] = 0.1; vector[600 + index - 40] = 1 }
    return { queryId: `q-${index + 1}`, text: `query ${index + 1}`, relevantChunkIds: [`relevant-${index + 1}`], hardNegativeChunkIds: [`negative-${index + 1}`], claims: [{ claimId: `claim-${index + 1}`, text: `claim ${index + 1}`, supportedChunkIds: [`relevant-${index + 1}`] }], vector }
  })
  const chunks = queries.flatMap((_query, index) => [{ id: `relevant-${index + 1}`, sourceId: source.id, text: `relevant ${index + 1}` }, { id: `negative-${index + 1}`, sourceId: source.id, text: `negative ${index + 1}` }])
  const matrix = queries.flatMap((query, index) => [{ id: `relevant-${index + 1}`, vector: query.vector }, { id: `negative-${index + 1}`, vector: (() => { const vector = new Array(2048).fill(0); if (index < 40) vector[500 - index] = 1; else vector[0] = 1; return vector })() }])
  const reference = { version: 'benchmark-v1', status: 'approved', corpusVersion, queries: queries.map((query) => Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'vector'))) }
  const citations = { 512: queries.map((query) => ({ queryId: query.queryId, claims: [{ claimId: query.claims[0].claimId, text: query.claims[0].text, citedIds: query.relevantChunkIds }] })), 1024: queries.map((query) => ({ queryId: query.queryId, claims: [{ claimId: query.claims[0].claimId, text: query.claims[0].text, citedIds: query.relevantChunkIds }] })) }
  return { reference, manifest: { corpusVersion, status: 'approved', sources: [source], chunks }, results: { benchmarkVersion: reference.version, corpusVersion, retrieval: queries.map(({ queryId, vector }) => ({ queryId, query: vector })), citations, matrix } }
}

describe('strict corpus evaluation', () => {
  it('aprueba el fixture completo y demuestra la mejora de 1024', () => {
    const value = fixture()
    const report = evaluateBenchmark(value.reference, value.manifest, value.results) as { queries: number; baseGate: boolean; dimensionGate1024: boolean; coverageComplete: boolean; recallAt5: { 512: number; 1024: number } }
    expect(report).toMatchObject({ queries: 50, baseGate: true, dimensionGate1024: true, coverageComplete: true })
    expect(report.recallAt5[512]).toBeCloseTo(0.8)
    expect(report.recallAt5[1024]).toBeCloseTo(1)
  })

  it('conserva el análisis histórico de v3 pero no lo aprueba para los gates actuales', () => {
    const value = fixture()
    const results = value.results as typeof value.results & {
      schema: string
      responseSchemaVersion: number
      reviews: Array<Record<string, unknown>>
      citations: Record<512 | 1024, Array<{
        queryId: string
        claims: Array<{ claimId: string; text: string; citedIds: string[] }>
        providerKind?: string
        responseText?: string
      }>>
    }
    results.schema = 'generated-benchmark-v3'
    results.responseSchemaVersion = 3
    results.reviews = []
    for (const dimensions of [512, 1024] as const) {
      for (const item of results.citations[dimensions]) {
        item.providerKind = 'remote'
        item.responseText = 'Respuesta histórica completa.'
        results.reviews.push({
          responseFingerprint: responseFingerprint(item, dimensions, results.corpusVersion, results.benchmarkVersion),
          dimensions,
          queryId: item.queryId,
          reviewer: 'Revisor independiente',
          notes: 'Revisión completa.',
          allNewClaimsReviewed: true,
          contextFaithful: true,
          sportsCoherent: true,
          applicable: true,
          uncertaintyHandled: true,
          claims: item.claims.map(claim => ({ claimId: claim.claimId, supportedChunkIds: [...claim.citedIds] })),
        })
      }
    }

    const report = evaluateBenchmark(value.reference, value.manifest, results) as { evidenceIdentity: string; currentGeneratedIdentity: boolean; baseGate: boolean; dimensionGate1024: boolean; generationGate: boolean; recallAt5: { 512: number; 1024: number }; citationPrecision: { 512: number; 1024: number }; generationBlockers: string[] }
    expect(report).toMatchObject({ evidenceIdentity: 'legacy-generated', currentGeneratedIdentity: false, baseGate: false, dimensionGate1024: false, generationGate: false })
    expect(report.recallAt5[512]).toBeCloseTo(0.8)
    expect(report.recallAt5[1024]).toBeCloseTo(1)
    expect(report.citationPrecision).toEqual({ 512: 1, 1024: 1 })
    expect(report.generationBlockers).toEqual([])
  })

  it('rechaza una sola etiqueta autojustificada partiendo del fixture válido', () => {
    const value = fixture()
    ;(value.results.citations[512][0].claims[0] as Record<string, unknown>).supportedIds = ['relevant-1']
    expect(() => evaluateBenchmark(value.reference, value.manifest, value.results)).toThrow(/supportedIds/)
  })

  it('rechaza una matriz recortada aunque retrieval y citas estén completos', () => {
    const value = fixture()
    value.results.matrix = value.results.matrix.slice(0, -1)
    expect(() => evaluateBenchmark(value.reference, value.manifest, value.results)).toThrow(/matriz/)
  })
})
