import { describe, expect, it } from 'vitest'
import { canonicalJson, corpusMetadataKey, corpusNamespace, corpusSourceKey, sha256Base64url, sha256Hex, vectorPhysicalId } from './index.mjs'

describe('physical corpus identity', () => {
  it('uses full SHA-256 base64url and canonicalizes object keys', () => {
    expect(sha256Base64url('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('separates version and dimension within the official byte limit', () => {
    const version = 'versión/🔥/'.repeat(100)
    const namespace512 = corpusNamespace(version, 512)
    const namespace1024 = corpusNamespace(version, 1024)
    const vector = vectorPhysicalId(version, 'chunk-ñ'.repeat(100))
    expect(namespace512).not.toBe(namespace1024)
    expect(new TextEncoder().encode(namespace512).byteLength).toBeLessThanOrEqual(64)
    expect(new TextEncoder().encode(vector).byteLength).toBeLessThanOrEqual(64)
    expect(new TextEncoder().encode(corpusMetadataKey(version)).byteLength).toBeLessThanOrEqual(64)
  })

  it('usa la misma identidad fuente:corpus que D1 y el verificador remoto', () => {
    expect(corpusSourceKey('source-1', 'corpus-v2')).toBe('source-1:corpus-v2')
  })
})
