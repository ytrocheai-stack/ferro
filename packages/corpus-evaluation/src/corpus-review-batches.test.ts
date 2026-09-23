import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from '../../corpus-identity/src/index.mjs'
import { responseFingerprint } from './index.mjs'

const MODEL = 'gemini-3.5-flash-lite'
const script = path.resolve('scripts/corpus-review-batches.mjs')
const roots: string[] = []

type Dimensions = 512 | 1024
type Claim = { claimId: string; text: string; citedIds: string[]; rawCitedIds: string[]; invalidCitedIds: string[] }
type Context = { id: string; score: number; source: string; author: string; url: string; location: string; text: string }
type Citation = {
  queryId: string
  repetition: number
  prompt: string
  responseText: string
  rawResponse: string
  parseError: false
  providerKind: 'remote'
  retrievalSource: 'remote-vectorize'
  requestIdentity: { model: string; fingerprint: string }
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number }
  usage: { inputTokens: number; outputTokens: number }
  retrievedChunkIds: string[]
  retrievedContext: Context[]
  claims: Claim[]
}
type Fixture = {
  directory: string
  manifestPath: string
  referencePath: string
  resultsPath: string
  manifest: { corpusVersion: string; sources: Array<Record<string, string>>; chunks: Array<{ id: string; sourceId: string; text: string; textHash: string; section: string }> }
  reference: { version: string; corpusVersion: string; queries: Array<{ queryId: string; text: string; relevantChunkIds: string[]; hardNegativeChunkIds: string[]; populationApplicability: string }> }
  results: {
    schema: string
    corpusVersion: string
    benchmarkVersion: string
    generationModel: string
    repetitions: number
    execution: string
    formalRemoteResponsesRequired: number
    formalRemoteResponsesComplete: number
    authorization: { provider: string; model: string; accessVerified: boolean; budgetVerified: boolean; maxAdditionalCost: number }
    provider: { calls: number; inputTokens: number; outputTokens: number; uncertainCalls: number }
    runs: Array<{ repetition: number; citations: Record<Dimensions, Citation[]> }>
    citations: Record<Dimensions, Citation[]>
    fingerprints?: { results?: string }
  }
}
type ReviewTemplate = {
  queryId: string
  repetition: number
  dimensions: Dimensions
  responseFingerprint: string
  reviewerId: string | null
  generatorId: string
  justification: string | null
  notes: string | null
  contextFaithful: boolean | null
  sportsCoherent: boolean | null
  applicable: boolean | null
  uncertaintyHandled: boolean | null
  allNewClaimsReviewed: boolean | null
  claims: Array<{ claimId: string; supportedChunkIds: string[] | null }>
}
type ReviewCase = {
  reviewTemplate: ReviewTemplate
  query: Record<string, unknown> & { queryId: string }
  retrieval: { retrievedChunkIds: string[]; context: Array<{ chunkId: string; source: { title: string }; text: string }> }
}
type ReviewPacket = {
  schema: string
  batchId: string
  reviewer: { reviewerId: string; reviewerType: string; independent: boolean }
  generatorId: string
  fingerprints: { corpus: string; benchmark: string; results: string }
  cases: ReviewCase[]
}

function makeFixture() : Fixture {
  const directory = mkdtempSync(path.join(tmpdir(), 'corpus-review-batches-'))
  roots.push(directory)
  const corpusVersion = 'fixture-corpus-v1'
  const benchmarkVersion = 'fixture-benchmark-v1'
  const manifest: Fixture['manifest'] = {
    corpusVersion,
    sources: [{ id: 'source-1', title: 'Fixture study', author: 'Test author', url: 'https://example.test/study', license: 'fixture' }],
    chunks: Array.from({ length: 5 }, (_, index) => ({ id: `chunk-${index + 1}`, sourceId: 'source-1', text: `Evidence text ${index + 1}`, textHash: sha256Hex(`Evidence text ${index + 1}`), section: 'Abstract' })),
  }
  const reference: Fixture['reference'] = {
    version: benchmarkVersion,
    corpusVersion,
    queries: Array.from({ length: 50 }, (_, index) => ({ queryId: `q-${String(index + 1).padStart(2, '0')}`, text: `Consulta fixture ${index + 1}`, relevantChunkIds: ['chunk-1'], hardNegativeChunkIds: ['chunk-2'], populationApplicability: 'Use only for this fixture.' })),
  }
  const makeDimension = (repetition: number, dimensions: Dimensions): Citation[] => reference.queries.map(query => {
    const retrievedChunkIds = manifest.chunks.map(chunk => chunk.id)
    const retrievedContext = manifest.chunks.map((chunk, index) => ({ id: chunk.id, score: 0.99 - index / 100, source: 'Fixture study', author: 'Test author', url: 'https://example.test/study', location: 'Abstract', text: chunk.text }))
    const claim: Claim = { claimId: `${query.queryId}-c1`, text: 'Fixture claim.', citedIds: ['chunk-1'], rawCitedIds: ['chunk-1'], invalidCitedIds: [] }
    return {
      queryId: query.queryId,
      repetition,
      prompt: `Fixture prompt ${query.queryId}`,
      responseText: 'Fixture response.',
      rawResponse: JSON.stringify({ responseText: 'Fixture response.', claims: [{ claimId: claim.claimId, text: claim.text, citedIds: claim.citedIds }] }),
      parseError: false,
      providerKind: 'remote',
      retrievalSource: 'remote-vectorize',
      requestIdentity: { model: MODEL, fingerprint: sha256Hex(`${query.queryId}:${repetition}:${dimensions}`) },
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      usage: { inputTokens: 10, outputTokens: 5 },
      retrievedChunkIds,
      retrievedContext,
      claims: [claim],
    }
  })
  const runs = Array.from({ length: 3 }, (_, repetition) => ({ repetition, citations: { 512: makeDimension(repetition, 512), 1024: makeDimension(repetition, 1024) } }))
  const results: Fixture['results'] = {
    schema: 'generated-benchmark-v1',
    corpusVersion,
    benchmarkVersion,
    generationModel: MODEL,
    repetitions: 3,
    execution: 'remote-gemini-complete',
    formalRemoteResponsesRequired: 300,
    formalRemoteResponsesComplete: 300,
    authorization: { provider: 'google-ai-studio', model: MODEL, accessVerified: true, budgetVerified: true, maxAdditionalCost: 0 },
    provider: { calls: 300, inputTokens: 3000, outputTokens: 1500, uncertainCalls: 0 },
    runs,
    citations: runs[0].citations,
  }
  results.fingerprints = { results: sha256Hex(canonicalJson(results)) }
  const manifestPath = path.join(directory, 'manifest.json')
  const referencePath = path.join(directory, 'reference.json')
  const resultsPath = path.join(directory, 'results.json')
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')
  writeFileSync(referencePath, JSON.stringify(reference), 'utf8')
  writeFileSync(resultsPath, JSON.stringify(results), 'utf8')
  return { directory, manifestPath, referencePath, resultsPath, manifest, reference, results }
}

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

function prepareArgs(fixture: Fixture, outputDir: string, batchSize = 10) {
  return ['prepare', '--manifest', fixture.manifestPath, '--reference', fixture.referencePath, '--results', fixture.resultsPath, '--output-dir', outputDir, '--reviewer-id', 'independent-review-agent', '--reviewer-type', 'agent', '--independent', '--batch-size', String(batchSize)]
}

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('batched independent corpus review helper', () => {
  it('does not create packets before the complete benchmark result exists', () => {
    const fixture = makeFixture()
    const missingResults = path.join(fixture.directory, 'not-finished.json')
    const outputDir = path.join(fixture.directory, 'must-not-exist')
    const result = run(prepareArgs({ ...fixture, resultsPath: missingResults }, outputDir))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('cuando exista la salida completa del benchmark')
    expect(existsSync(outputDir)).toBe(false)
  })

  it('prepares 30 blind packets with full retrieved source context and exact response fingerprints', () => {
    const fixture = makeFixture()
    const outputDir = path.join(fixture.directory, 'packets')
    const result = run(prepareArgs(fixture, outputDir))
    expect(result.status).toBe(0)
    const files = readdirSync(outputDir).filter(file => /^batch-\d{3}\.json$/.test(file)).sort()
    expect(files).toHaveLength(30)
    const first = JSON.parse(readFileSync(path.join(outputDir, files[0]), 'utf8')) as ReviewPacket
    expect(first).toMatchObject({ schema: 'hevy-independent-review-packet-v1', batchId: 'batch-001', reviewer: { reviewerType: 'agent', independent: true }, generatorId: MODEL })
    expect(first.cases).toHaveLength(10)
    const packetCase = first.cases[0]
    const sourceItem = fixture.results.runs[0].citations[512][0]
    expect(packetCase.reviewTemplate.responseFingerprint).toBe(responseFingerprint(sourceItem, 512, fixture.results.corpusVersion, fixture.results.benchmarkVersion))
    expect(packetCase.retrieval.context[0]).toMatchObject({ chunkId: 'chunk-1', source: { title: 'Fixture study' }, text: 'Evidence text 1' })
    expect(packetCase.query).not.toHaveProperty('relevantChunkIds')
    expect(packetCase.query).not.toHaveProperty('hardNegativeChunkIds')
    expect(packetCase.reviewTemplate.contextFaithful).toBeNull()
    expect(packetCase.reviewTemplate.claims[0].supportedChunkIds).toBeNull()
  })

  it('accepts nonempty delivered contexts below five chunks after source eligibility filtering', () => {
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
    const unhashed = structuredClone(fixture.results)
    delete unhashed.fingerprints
    fixture.results.fingerprints = { results: sha256Hex(canonicalJson(unhashed)) }
    writeFileSync(fixture.resultsPath, JSON.stringify(fixture.results), 'utf8')

    const outputDir = path.join(fixture.directory, 'packets')
    const result = run(prepareArgs(fixture, outputDir))
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0)
    const files = readdirSync(outputDir).filter(file => /^batch-\d{3}\.json$/.test(file))
    const cases = files.flatMap(file => (JSON.parse(readFileSync(path.join(outputDir, file), 'utf8')) as ReviewPacket).cases)
    const q43 = cases.filter(item => item.query.queryId === 'q-43')
    const q50 = cases.filter(item => item.query.queryId === 'q-50')
    expect(q43).toHaveLength(6)
    expect(q43.every(item => item.retrieval.retrievedChunkIds.length === 4 && item.retrieval.context.length === 4)).toBe(true)
    expect(q50).toHaveLength(6)
    expect(q50.every(item => item.retrieval.retrievedChunkIds.length === 2 && item.retrieval.context.length === 2)).toBe(true)
  })

  it('merges only complete linked reviewer outputs and preserves adverse judgments', () => {
    const fixture = makeFixture()
    const outputDir = path.join(fixture.directory, 'packets')
    expect(run(prepareArgs(fixture, outputDir)).status).toBe(0)
    for (const file of readdirSync(outputDir).filter(name => /^batch-\d{3}\.json$/.test(name))) {
      const packet = JSON.parse(readFileSync(path.join(outputDir, file), 'utf8')) as ReviewPacket
      const responses = packet.cases.map(reviewCase => ({
        ...reviewCase.reviewTemplate,
        reviewerId: packet.reviewer.reviewerId,
        justification: 'Synthetic fixture record; no semantic result asserted.',
        notes: 'Synthetic fixture record; must not be used as a real review.',
        contextFaithful: false,
        sportsCoherent: false,
        applicable: false,
        uncertaintyHandled: false,
        allNewClaimsReviewed: true,
        claims: reviewCase.reviewTemplate.claims.map(claim => ({ claimId: claim.claimId, supportedChunkIds: [] })),
      }))
      writeFileSync(path.join(outputDir, `${packet.batchId}.reviewed.json`), JSON.stringify({ schema: 'hevy-independent-review-batch-v1', batchId: packet.batchId, reviewerId: packet.reviewer.reviewerId, reviewerType: packet.reviewer.reviewerType, independent: true, generatorId: MODEL, fingerprints: packet.fingerprints, responses }), 'utf8')
    }
    const outputPath = path.join(fixture.directory, 'response-reviews.json')
    const result = run(['merge', '--manifest', fixture.manifestPath, '--reference', fixture.referencePath, '--results', fixture.resultsPath, '--input-dir', outputDir, '--output', outputPath])
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0)
    const reviews = JSON.parse(readFileSync(outputPath, 'utf8')) as { schema: string; reviewerType: string; independent: boolean; generatorId: string; responses: Array<{ contextFaithful: boolean; applicable: boolean; allNewClaimsReviewed: boolean }> }
    expect(reviews).toMatchObject({ schema: 'hevy-response-reviews-v1', reviewerType: 'agent', independent: true, generatorId: MODEL, responses: expect.any(Array) })
    expect(reviews.responses).toHaveLength(300)
    expect(reviews.responses.every(review => review.contextFaithful === false && review.applicable === false && review.allNewClaimsReviewed === true)).toBe(true)
  })
})
