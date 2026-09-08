import { describe, expect, it } from 'vitest'
import { corpusMetadataKey } from '../../packages/corpus-identity/src/index.mjs'
import { sha256Hex } from '../../packages/corpus-identity/src/index.mjs'
import { corpusNamespace, deriveNormalizedPrefixes, importApprovedCorpus, vectorPhysicalId, type ApprovedChunk } from './rag'

const chunk: ApprovedChunk = { id: 'c1', sourceId: 's1', text: 'progression', corpusVersion: 'v1', source: { id: 's1', author: 'Author', title: 'Evidence', url: 'https://example.test', license: 'CC-BY', evidenceLevel: 3, language: 'en', approvedAt: 1, approved: true } }

describe('RAG corpus importer', () => {
  it('derives normalized 768 and 1024 prefixes from one 2048 vector', () => {
    const values = deriveNormalizedPrefixes(Array.from({ length: 2048 }, (_, index) => index === 0 ? 1 : 0))
    expect(values.values512).toHaveLength(512)
    expect(values.values768).toHaveLength(768)
    expect(values.values1024).toHaveLength(1024)
    expect(values.values768[0]).toBe(1)
  })

  it('embeds every passage once and writes the approved metadata', async () => {
    const calls: string[] = []
    const writes: { id: string; values: number[]; metadata: Record<string, string>; namespace?: string }[][] = []
    const count = await importApprovedCorpus([chunk], { embed: async (text, inputType) => { calls.push(`${text}:${inputType}`); return [1, ...Array.from({ length: 2047 }, () => 0)] } }, { primary: { upsert: async (items) => { writes.push(items) } } })
    expect(count).toBe(1)
    expect(calls).toEqual(['progression:passage'])
    expect(writes[0][0].id).toBe(vectorPhysicalId('v1', 'c1'))
    expect(writes[0][0].metadata.license).toBe('CC-BY')
    expect(writes[0][0].metadata.chunkId).toBe('c1')
    expect(writes[0][0].metadata.corpusKey).toBe(corpusMetadataKey('v1'))
    expect(writes[0][0].namespace).toBe(corpusNamespace('v1', 512))
  })

  it('usa la misma huella SHA-256 de texto que el importador remoto', async () => {
    const values: unknown[] = []
    const db = { prepare() { return { bind(...params: unknown[]) { values.push(...params); return this }, async run() { return { success: true } } } } }
    await importApprovedCorpus([chunk], { embed: async () => [1, ...Array.from({ length: 2047 }, () => 0)] }, { primary: { upsert: async () => undefined } }, db as never)
    expect(values).toContain(sha256Hex(chunk.text))
  })

  it('separa versiones y dimensiones con IDs físicos acotados', () => {
    const version = 'versión/Unicode/🔥/'.repeat(100)
    const first = corpusNamespace(version, 512)
    const second = corpusNamespace(version, 1024)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^nr2:[A-Za-z0-9_-]+:512$/)
    expect(vectorPhysicalId(version, 'chunk-ñ'.repeat(100))).toMatch(/^v2:[A-Za-z0-9_-]+$/)
    expect(new TextEncoder().encode(first).byteLength).toBeLessThanOrEqual(64)
    expect(new TextEncoder().encode(vectorPhysicalId(version, 'chunk-ñ'.repeat(100))).byteLength).toBeLessThanOrEqual(64)
  })

  it('devuelve el total importado y confirma también el lote final parcial', async () => {
    const checkpoints: string[][] = []
    const writes: { namespace?: string; count: number }[] = []
    const count = await importApprovedCorpus([chunk, { ...chunk, id: 'c2' }, { ...chunk, id: 'c3' }], { embed: async () => [1, ...Array.from({ length: 2047 }, () => 0)] }, { primary: { upsert: async (items) => { writes.push({ namespace: items[0]?.namespace, count: items.length }) } } }, undefined, { batchSize: 2, onBatch: async (ids) => { checkpoints.push(ids) } })
    expect(count).toBe(3)
    expect(checkpoints).toEqual([['c1', 'c2'], ['c3']])
    expect(writes).toEqual([{ namespace: corpusNamespace('v1'), count: 2 }, { namespace: corpusNamespace('v1'), count: 1 }])
  })

  it('rollback borra los IDs de ambos índices antes de borrar D1', async () => {
    const primaryDeleted: string[][] = []
    const evaluationDeleted: string[][] = []
    const db = {
      prepare(sql: string) {
        return {
          bind() { return this },
          async all() { return sql.includes('adaptation_chunks') ? { results: [{ id: 'v1:c1' }, { id: 'v1:c2' }] } : { results: [] } },
          async run() { return { success: true } },
        }
      },
    }
    const indexes = {
      primary: { upsert: async () => undefined, delete: async (ids: string[]) => { primaryDeleted.push(ids) } },
      evaluation1024: { upsert: async () => undefined, delete: async (ids: string[]) => { evaluationDeleted.push(ids) } },
    }
    await (await import('./rag')).rollbackCorpusVersion('v1', indexes, db as never)
    expect(primaryDeleted).toEqual([['v1:c1', 'v1:c2']])
    expect(evaluationDeleted).toEqual([['v1:c1', 'v1:c2']])
  })

  it('rollback usa vector_id nuevo y conserva fallback para legacy', async () => {
    const deleted: string[][] = []
    const db = {
      prepare(sql: string) {
        return {
          bind() { return this },
          async all() { return sql.includes('adaptation_chunks') ? { results: [{ id: 'v1:logical-1', vector_id: vectorPhysicalId('v1', 'logical-1') }, { id: 'v1:legacy-2' }] } : { results: [] } },
          async run() { return { success: true } },
        }
      },
    }
    await (await import('./rag')).rollbackCorpusVersion('v1', { primary: { upsert: async () => undefined, delete: async (ids: string[]) => { deleted.push(ids) } } }, db as never)
    expect(deleted).toEqual([[vectorPhysicalId('v1', 'logical-1'), 'v1:legacy-2']])
  })

  it('rollback por namespace sigue acotado cuando el adaptador no expone delete por IDs', async () => {
    const namespaces: string[] = []
    const db = {
      prepare(sql: string) {
        return {
          bind() { return this },
          async all() { return sql.includes('adaptation_chunks') ? { results: [] } : { results: [] } },
          async run() { return { success: true } },
        }
      },
    }
    await (await import('./rag')).rollbackCorpusVersion('v1', { primary: { upsert: async () => undefined, deleteByNamespace: async (namespace: string) => { namespaces.push(namespace) } } }, db as never)
    expect(namespaces).toEqual([corpusNamespace('v1', 512)])
  })
})
