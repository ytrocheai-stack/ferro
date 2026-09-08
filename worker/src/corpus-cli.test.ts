import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('corpus evaluation CLI', () => {
  it('rechaza una evaluación sin las 50 consultas, dimensiones y claims etiquetados', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nextrep-corpus-'))
    try {
      const manifestPath = path.join(directory, 'manifest.json')
      const resultsPath = path.join(directory, 'results.json')
      const queriesPath = path.join(directory, 'evaluation-queries.json')
      await writeFile(manifestPath, JSON.stringify({ status: 'approved', corpusVersion: 'test-v1', sources: [{ id: 's1', author: 'Author', title: 'Evidence', url: 'https://example.test', license: 'CC-BY', language: 'en', approved: true }], chunks: [{ id: 'chunk-1', sourceId: 's1', text: 'support' }] }))
      await writeFile(queriesPath, JSON.stringify({ queries: Array.from({ length: 50 }, (_, index) => ({ id: `q-${index}` })) }))
      await writeFile(resultsPath, JSON.stringify({ corpusVersion: 'test-v1', retrieval: [{ query: [1, 0], relevantIds: ['chunk-1'], documents: [{ id: 'chunk-1', vector: [1, 0] }] }], citations: [{ citedIds: ['chunk-1'], validIds: ['chunk-1'] }] }))
      const scriptPath = path.resolve(process.cwd(), path.basename(process.cwd()) === 'worker' ? '..' : '.', 'scripts', 'corpus-cli.mjs')
      await expect(execFileAsync(process.execPath, [scriptPath, manifestPath, 'evaluate', '--results', resultsPath])).rejects.toBeTruthy()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rechaza reanudar un checkpoint con otro esquema físico', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nextrep-corpus-checkpoint-'))
    try {
      const manifestPath = path.join(directory, 'manifest.json')
      const checkpointPath = path.join(directory, 'checkpoint.json')
      await writeFile(manifestPath, JSON.stringify({ status: 'approved', corpusVersion: 'test-v1', sources: [{ id: 's1', author: 'Author', title: 'Evidence', url: 'https://example.test', license: 'CC-BY', language: 'en', approved: true }], chunks: [{ id: 'chunk-1', sourceId: 's1', text: 'support' }] }))
      await writeFile(checkpointPath, JSON.stringify({ schema: 'v1', corpusVersion: 'test-v1', completedIds: [] }))
      const scriptPath = path.resolve(process.cwd(), path.basename(process.cwd()) === 'worker' ? '..' : '.', 'scripts', 'corpus-cli.mjs')
      await expect(execFileAsync(process.execPath, [scriptPath, manifestPath, 'import', '--checkpoint', checkpointPath])).rejects.toBeTruthy()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
