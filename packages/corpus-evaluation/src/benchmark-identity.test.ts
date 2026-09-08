import { describe, expect, it } from 'vitest'
import { benchmarkRequestIdentity, benchmarkResponseUsage } from '../../../scripts/corpus-benchmark'
import { canonicalJson, sha256Hex } from '../../corpus-identity/src/index.mjs'

const context = [{ id: 'chunk-1', score: 0.9, source: 'Evidence', author: 'Author', url: 'https://example.test', location: 'p.1', text: 'support' }]

describe('benchmark response identity', () => {
  it('counts only benchmark responses and exposes missing usage without substituting estimates', () => {
    expect(benchmarkResponseUsage([{ providerKind: 'remote', usage: { inputTokens: 12, outputTokens: 8 } }, { providerKind: 'blocked' }, { providerKind: 'remote' }])).toEqual({ calls: 2, inputTokens: 12, outputTokens: 8, uncertainCalls: 1 })
  })
  it('binds Kimi wire parameters to prevent resuming DeepSeek generation policies', () => {
    const result = benchmarkRequestIdentity({ queryId: 'q1', text: 'consulta', mode: 'research', dimensions: 512, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: context })
    expect(result.parametersHash).toBe(sha256Hex(canonicalJson({ dimensions: 512, repetition: 0, maxOutputTokens: 4000, temperature: 1, model: 'moonshotai/kimi-k3', corpusVersion: 'v1', benchmarkVersion: 'b1', reasoning_effort: 'low' })))
  })
  it('cambia si cambia la consulta, el contexto, el modelo/instrucciones o los parámetros', () => {
    const base = benchmarkRequestIdentity({ queryId: 'q1', text: 'consulta', mode: 'research', dimensions: 512, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: context })
    expect(benchmarkRequestIdentity({ queryId: 'q1', text: 'otra consulta', mode: 'research', dimensions: 512, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: context }).fingerprint).not.toBe(base.fingerprint)
    expect(benchmarkRequestIdentity({ queryId: 'q1', text: 'consulta', mode: 'research', dimensions: 1024, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: context }).fingerprint).not.toBe(base.fingerprint)
    expect(benchmarkRequestIdentity({ queryId: 'q1', text: 'consulta', mode: 'research', dimensions: 512, repetition: 0, corpusVersion: 'v1', benchmarkVersion: 'b1', evidence: [{ ...context[0], text: 'altered' }] }).fingerprint).not.toBe(base.fingerprint)
  })
})
