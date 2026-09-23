import { describe, expect, it } from 'vitest'
import { modelResponse } from '../../../scripts/corpus-benchmark'

describe('benchmark response validation', () => {
  it.each([
    { responseText: '', claims: [] },
    { responseText: '   ', claims: [] },
    { responseText: 42, claims: [] },
    { responseText: 'Respuesta', claims: [{ claimId: 'c1', text: '', citedIds: [] }] },
    { responseText: 'Respuesta', claims: [{ claimId: 'c1', text: 'Hecho', citedIds: 'chunk-1' }] },
    { responseText: 'Respuesta', claims: [{ claimId: 'c1', text: 'Hecho', citedIds: ['chunk-1'] }, { claimId: 'c1', text: 'Otro', citedIds: [] }] },
  ])('does not mark malformed structured output as valid: %j', payload => {
    const raw = JSON.stringify(payload)
    const result = modelResponse(raw, new Set(['chunk-1']))
    expect(result.parseError).toBe(true)
    expect(result.rawResponse).toBe(raw)
  })

  it('preserves an invented citation for rejection by the reviewer', () => {
    const result = modelResponse(JSON.stringify({ responseText: 'Hecho', claims: [{ claimId: 'c1', text: 'Hecho', citedIds: ['invented'] }] }), new Set(['chunk-1']))
    expect(result.claims[0]).toMatchObject({ citedIds: [], rawCitedIds: ['invented'], invalidCitedIds: ['invented'] })
  })

  it('does not convert a numbered citation into a chunk ID', () => {
    const result = modelResponse('{"responseText":"Hecho","claims":[{"claimId":"c1","text":"Hecho","citedIds":["1"]}]}', new Set(['PMC13119994_0001']))
    expect(result.claims[0]).toMatchObject({ citedIds: [], rawCitedIds: ['1'], invalidCitedIds: ['1'] })
  })

  it('allows a nonempty abstention without claims', () => {
    expect(modelResponse('{"responseText":"La evidencia recuperada no permite responder.","claims":[]}', new Set()).parseError).toBe(false)
  })
})
