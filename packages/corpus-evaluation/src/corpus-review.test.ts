import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from '../../corpus-identity/src/index.mjs'
import { responseFingerprint } from './index.mjs'

const GEMINI = 'gemini-3.5-flash-lite'
const roots: string[] = []
const script = path.resolve('scripts/corpus-review.mjs')

type Dimensions = 512 | 1024
type Claim = { claimId: string; text: string; citedIds: string[]; rawCitedIds: string[]; invalidCitedIds: string[] }
type Citation = {
  queryId: string
  repetition: number
  responseText: string
  rawResponse: string
  parseError: false
  providerKind: 'remote'
  retrievalSource: 'remote-vectorize'
  requestIdentity: { model: string; fingerprint: string }
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number }
  usage: { inputTokens: number; outputTokens: number }
  retrievedChunkIds: string[]
  retrievedContext: Array<{ id: string; text: string }>
  claims: Claim[]
}
type Run = { repetition: number; citations: Record<Dimensions, Citation[]> }
type ResponseReview = {
  queryId: string
  repetition: number
  dimensions: Dimensions
  responseFingerprint: string
  reviewerId: string
  generatorId: string
  justification: string
  notes: string
  contextFaithful: boolean
  sportsCoherent: boolean
  applicable: boolean
  uncertaintyHandled: boolean
  allNewClaimsReviewed: boolean
  claims: Array<{ claimId: string; supportedChunkIds: string[] }>
}
type Fixture = {
  manifest: { corpusVersion: string; sources: Array<{ id: string }>; chunks: Array<{ id: string; sourceId: string; text: string }> }
  reference: { version: string; corpusVersion: string; queries: Array<{ queryId: string; relevantChunkIds: string[] }> }
  results: {
    schema: string
    corpusVersion: string
    benchmarkVersion: string
    generationModel: string
    repetitions: number
    formalRemoteResponsesRequired: number
    formalRemoteResponsesComplete: number
    execution: string
    authorization: { provider: string; model: string; accessVerified: boolean; budgetVerified: boolean; maxAdditionalCost: number }
    provider: { calls: number; inputTokens: number; outputTokens: number; uncertainCalls: number }
    runs: Run[]
    citations: Record<Dimensions, Citation[]>
    fingerprints?: { results?: string }
  }
  reviews: {
    reviewerId: string
    reviewerType: string
    independent: boolean
    generatorId: string
    responses: ResponseReview[]
    fingerprints?: { corpus?: string; benchmark?: string; results?: string }
  }
}
type ReviewReport = { complete: boolean; reviewComplete: boolean; responses: number; reviewedResponses: number; reviewerType: string; independentReviewer: boolean; fingerprints: Record<string, string>; semanticQuality: { passed: boolean; score: number; checks: Record<string, { passed: number; failed: number; missing: number }>; findings: Array<{ queryId: string; failedChecks: string[] }> }; ragGates: Array<{ dimensions: Dimensions; recallAt5: number; citationPrecision: number; passes: boolean }>; failures: string[] }

function makeFixture({ badRecall = false, unsupported = false }: { badRecall?: boolean; unsupported?: boolean } = {}): Fixture {
  const manifest = {
    corpusVersion: 'corpus-v1',
    sources: [{ id: 'source-1' }],
    chunks: Array.from({ length: 6 }, (_, index) => ({ id: `chunk-${index + 1}`, sourceId: 'source-1', text: `Evidence text ${index + 1}` })),
  }
  const reference = {
    version: 'benchmark-v1',
    corpusVersion: manifest.corpusVersion,
    queries: Array.from({ length: 50 }, (_, index) => ({ queryId: `q-${index + 1}`, relevantChunkIds: ['chunk-1'] })),
  }
  const queryIds = reference.queries.map(query => query.queryId)
  const buildDimension = (dimensions: Dimensions): Citation[] => queryIds.map(queryId => {
    const retrievedChunkIds = badRecall && dimensions === 512 ? ['chunk-2', 'chunk-3', 'chunk-4', 'chunk-5', 'chunk-6'] : ['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4', 'chunk-5']
    const claim: Claim = { claimId: 'claim-1', text: 'La evidencia respalda el consejo.', citedIds: ['chunk-1'], rawCitedIds: ['chunk-1'], invalidCitedIds: [] }
    return {
      queryId,
      repetition: 0,
      responseText: 'La evidencia respalda el consejo.',
      rawResponse: JSON.stringify({ responseText: 'La evidencia respalda el consejo.', claims: [{ claimId: claim.claimId, text: claim.text, citedIds: claim.citedIds }] }),
      parseError: false,
      providerKind: 'remote',
      retrievalSource: 'remote-vectorize',
      requestIdentity: { model: GEMINI, fingerprint: sha256Hex(`${queryId}:${dimensions}`) },
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      usage: { inputTokens: 10, outputTokens: 5 },
      retrievedChunkIds,
      retrievedContext: retrievedChunkIds.map(id => ({ id, text: manifest.chunks.find(chunk => chunk.id === id)!.text })),
      claims: [claim],
    }
  })
  const runs: Run[] = Array.from({ length: 3 }, (_, repetition) => ({
    repetition,
    citations: { 512: buildDimension(512).map(item => ({ ...item, repetition })), 1024: buildDimension(1024).map(item => ({ ...item, repetition })) },
  }))
  const results: Fixture['results'] = {
    schema: 'generated-benchmark-v1',
    corpusVersion: manifest.corpusVersion,
    benchmarkVersion: reference.version,
    generationModel: GEMINI,
    repetitions: 3,
    formalRemoteResponsesRequired: 300,
    formalRemoteResponsesComplete: 300,
    execution: 'remote-gemini-complete',
    authorization: { provider: 'google-ai-studio', model: GEMINI, accessVerified: true, budgetVerified: true, maxAdditionalCost: 0 },
    provider: { calls: 300, inputTokens: 3000, outputTokens: 1500, uncertainCalls: 0 },
    runs,
    citations: runs[0].citations,
  }
  const reviews: Fixture['reviews'] = {
    reviewerId: 'researcher@example.test',
    reviewerType: 'human',
    independent: true,
    generatorId: GEMINI,
    responses: [],
  }
  for (const run of runs) for (const dimensions of [512, 1024] as const) for (const item of run.citations[dimensions]) {
    reviews.responses.push({
      queryId: item.queryId,
      repetition: run.repetition,
      dimensions,
      responseFingerprint: responseFingerprint(item, dimensions, results.corpusVersion, results.benchmarkVersion),
      reviewerId: reviews.reviewerId,
      generatorId: reviews.generatorId,
      justification: 'Revisé la respuesta frente al contexto recuperado.',
      notes: 'Las afirmaciones y las citas corresponden a la evidencia.',
      contextFaithful: true,
      sportsCoherent: true,
      applicable: true,
      uncertaintyHandled: true,
      allNewClaimsReviewed: true,
      claims: [{ claimId: 'claim-1', supportedChunkIds: unsupported ? [] : ['chunk-1'] }],
    })
  }
  return refreshLinks({ manifest, reference, results, reviews })
}

function refreshLinks(fixture: Fixture): Fixture {
  const { manifest, reference, results, reviews } = fixture
  const withoutFingerprint = structuredClone(results)
  delete withoutFingerprint.fingerprints
  const resultFingerprint = sha256Hex(canonicalJson(withoutFingerprint))
  results.fingerprints = { results: resultFingerprint }
  reviews.fingerprints = {
    corpus: sha256Hex(canonicalJson(manifest)),
    benchmark: sha256Hex(canonicalJson(reference)),
    results: resultFingerprint,
  }
  for (const review of reviews.responses) {
    const item = results.runs[review.repetition].citations[review.dimensions].find(entry => entry.queryId === review.queryId)
    review.responseFingerprint = responseFingerprint(item, review.dimensions, results.corpusVersion, results.benchmarkVersion)
  }
  return fixture
}

function runReview(fixture: Fixture) {
  const directory = mkdtempSync(path.join(tmpdir(), 'corpus-review-'))
  roots.push(directory)
  const inputs = { manifest: path.join(directory, 'manifest.json'), reference: path.join(directory, 'reference.json'), results: path.join(directory, 'results.json'), reviews: path.join(directory, 'reviews.json'), output: path.join(directory, 'report.json') }
  writeFileSync(inputs.manifest, JSON.stringify(fixture.manifest), 'utf8')
  writeFileSync(inputs.reference, JSON.stringify(fixture.reference), 'utf8')
  writeFileSync(inputs.results, JSON.stringify(fixture.results), 'utf8')
  writeFileSync(inputs.reviews, JSON.stringify(fixture.reviews), 'utf8')
  const result = spawnSync(process.execPath, [script, '--manifest', inputs.manifest, '--reference', inputs.reference, '--results', inputs.results, '--reviews', inputs.reviews, '--output', inputs.output], { encoding: 'utf8' })
  return { ...result, output: inputs.output }
}

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Gemini independent corpus review gate', () => {
  it('accepts exactly 300 measured responses after complete independent review and reports artifact fingerprints', () => {
    const result = runReview(makeFixture())
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as ReviewReport
    expect(report).toMatchObject({ complete: true, responses: 300, reviewedResponses: 300, reviewerType: 'human', independentReviewer: true })
    expect(report.fingerprints).toMatchObject({ corpus: expect.any(String), benchmark: expect.any(String), results: expect.any(String) })
    expect(report.ragGates).toHaveLength(6)
    expect(report.ragGates.every(gate => gate.passes)).toBe(true)
  })

  it('accepts eligible delivered contexts with four chunks for q43 and two for q50', () => {
    const fixture = makeFixture()
    for (const run of fixture.results.runs) {
      for (const dimensions of [512, 1024] as const) {
        for (const item of run.citations[dimensions]) {
          const limit = item.queryId === 'q-43' ? 4 : item.queryId === 'q-50' ? 2 : undefined
          if (limit === undefined) continue
          item.retrievedChunkIds = item.retrievedChunkIds.slice(0, limit)
          item.retrievedContext = item.retrievedContext.slice(0, limit)
        }
      }
    }
    refreshLinks(fixture)

    const result = runReview(fixture)
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0)
    const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as ReviewReport
    expect(report).toMatchObject({ complete: true, responses: 300, reviewedResponses: 300 })
  })

  it('records delegated agent review as independent agent evidence', () => {
    const fixture = makeFixture()
    fixture.reviews.reviewerId = 'gpt-6-luna'
    fixture.reviews.reviewerType = 'agent'
    fixture.reviews.responses.forEach(review => { review.reviewerId = 'gpt-6-luna' })
    refreshLinks(fixture)
    const result = runReview(fixture)
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout.slice(result.stdout.indexOf('{')))).toMatchObject({ reviewerId: 'gpt-6-luna', reviewerType: 'agent', independentReviewer: true })
  })

  it('preserves a negative quality judgment as complete review evidence and fails quality separately', () => {
    const fixture = makeFixture()
    fixture.reviews.responses[0].contextFaithful = false
    const result = runReview(fixture)
    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as ReviewReport
    expect(report).toMatchObject({ complete: false, reviewComplete: true, responses: 300, reviewedResponses: 300, semanticQuality: { passed: false } })
    expect(report.semanticQuality.checks.contextFaithful.failed).toBe(1)
    expect(report.semanticQuality.findings[0]).toMatchObject({ queryId: fixture.reference.queries[0].queryId, failedChecks: ['contextFaithful'] })
    expect(report.failures).toContain('la revisión completa registra hallazgos semánticos de calidad')
    expect(report.failures.some(failure => failure.includes('revisión incompleta'))).toBe(false)
  })

  const rejectedEvidence: Array<[string, (fixture: Fixture) => void]> = [
    ['legacy Kimi result', fixture => { fixture.results.execution = 'remote-flash'; fixture.results.generationModel = 'moonshotai/kimi-k3'; refreshLinks(fixture) }],
    ['partial probe', fixture => { fixture.results.execution = 'remote-gemini-probe-incomplete'; refreshLinks(fixture) }],
    ['partial result', fixture => { fixture.results.execution = 'remote-gemini-incomplete'; fixture.results.formalRemoteResponsesComplete = 299; refreshLinks(fixture) }],
    ['unmeasured response', fixture => { delete fixture.results.runs[0].citations[512][0].usageMetadata; refreshLinks(fixture) }],
    ['reviewer self-reviewing as the generator', fixture => { fixture.reviews.reviewerId = GEMINI; fixture.reviews.responses.forEach(review => { review.reviewerId = GEMINI }); refreshLinks(fixture) }],
    ['untyped reviewer', fixture => { fixture.reviews.reviewerType = 'machine'; refreshLinks(fixture) }],
    ['stale corpus fingerprint', fixture => { fixture.reviews.fingerprints!.corpus = 'stale'; }],
    ['stale benchmark fingerprint', fixture => { fixture.reviews.fingerprints!.benchmark = 'stale'; }],
    ['stale result fingerprint', fixture => { fixture.results.runs[0].citations[512][0].responseText = 'cambio sin actualizar la huella'; }],
    ['incomplete claim review', fixture => { fixture.reviews.responses[0].claims = []; }],
    ['altered delivered context text', fixture => { fixture.results.runs[0].citations[512][0].retrievedContext[0].text = 'Texto distinto del corpus'; refreshLinks(fixture) }],
  ]
  it.each(rejectedEvidence)('rejects %s evidence', (_label, mutate) => {
    const fixture = makeFixture()
    mutate(fixture)
    expect(runReview(fixture).status).not.toBe(0)
  })

  it('fails each repetition and dimension when either RAG metric misses its threshold', () => {
    const recall = runReview(makeFixture({ badRecall: true }))
    expect(recall.status).toBe(1)
    const recallReport = JSON.parse(recall.stdout.slice(recall.stdout.indexOf('{'))) as ReviewReport
    expect(recallReport.ragGates.filter(gate => gate.dimensions === 512).every(gate => gate.recallAt5 === 0 && !gate.passes)).toBe(true)

    const precision = runReview(makeFixture({ unsupported: true }))
    expect(precision.status).toBe(1)
    const precisionReport = JSON.parse(precision.stdout.slice(precision.stdout.indexOf('{'))) as ReviewReport
    expect(precisionReport.ragGates.every(gate => gate.citationPrecision === 0 && !gate.passes)).toBe(true)
  })
})
