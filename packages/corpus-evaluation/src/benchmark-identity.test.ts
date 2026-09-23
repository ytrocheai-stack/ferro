import { describe, expect, it } from 'vitest'
import { BENCHMARK_CITATION_SCHEMA_VERSION, BENCHMARK_GENERATION_OPTIONS, BENCHMARK_MAX_OUTPUT_TOKENS, benchmarkRequestIdentity, benchmarkResponseUsage, benchmarkResponseJsonSchema } from '../../../scripts/corpus-benchmark'
import { GEMINI_GENERATION_MODEL } from '../../corpus-pipeline/src/gemini-session.ts'
import { canonicalJson, sha256Hex } from '../../corpus-identity/src/index.mjs'

const context = [{ id: 'chunk-1', score: 0.9, source: 'Evidence', author: 'Author', url: 'https://example.test', location: 'p.1', text: 'support' }]

describe('benchmark response identity', () => {
  it('counts only benchmark responses and exposes missing usage without substituting estimates', () => {
    expect(benchmarkResponseUsage([{ providerKind: 'remote', usage: { inputTokens: 12, outputTokens: 8 } }, { providerKind: 'blocked' }, { providerKind: 'remote' }])).toEqual({ calls: 2, inputTokens: 12, outputTokens: 8, uncertainCalls: 1 })
  })
  it('binds Gemini wire parameters to prevent resuming a different generation policy', () => {
    const result = benchmarkRequestIdentity({ queryId: 'q1', text: 'consulta', mode: 'research', dimensions: 512, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: context })
    expect(result.model).toBe(GEMINI_GENERATION_MODEL)
    expect(result.parametersHash).toBe(sha256Hex(canonicalJson({ dimensions: 512, repetition: 0, maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS, responseSchemaVersion: BENCHMARK_CITATION_SCHEMA_VERSION, ...BENCHMARK_GENERATION_OPTIONS, model: GEMINI_GENERATION_MODEL, corpusVersion: 'v1', benchmarkVersion: 'b1' })))
  })
  it('cambia si cambia la consulta, el contexto o los parámetros', () => {
    const base = benchmarkRequestIdentity({ queryId: 'q1', text: 'consulta', mode: 'research', dimensions: 512, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: context })
    expect(benchmarkRequestIdentity({ queryId: 'q1', text: 'otra consulta', mode: 'research', dimensions: 512, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: context }).fingerprint).not.toBe(base.fingerprint)
    expect(benchmarkRequestIdentity({ queryId: 'q1', text: 'consulta', mode: 'research', dimensions: 1024, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: context }).fingerprint).not.toBe(base.fingerprint)
    expect(benchmarkRequestIdentity({ queryId: 'q1', text: 'consulta', mode: 'research', dimensions: 512, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: [{ ...context[0], text: 'altered' }] }).fingerprint).not.toBe(base.fingerprint)
  })

  it('constrains citations to the exact retrieved IDs and forbids claims without evidence', () => {
    const schema = benchmarkResponseJsonSchema(['PMC13119994_0001', 'chunk-2', 'PMC13119994_0001']) as {
      properties: { claims: { items: { properties: { citedIds: { minItems: number; items: { enum: string[] } } } } } }
    }
    expect(schema.properties.claims.items.properties.citedIds).toMatchObject({ minItems: 1, items: { enum: ['PMC13119994_0001', 'chunk-2'] } })
    const noEvidence = benchmarkResponseJsonSchema([]) as { properties: { claims: { maxItems: number } } }
    expect(noEvidence.properties.claims.maxItems).toBe(0)
  })
})
