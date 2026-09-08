import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('corpus readiness CLI arguments', () => {
  it.each([true, false])('reads the manifest when --stage is before it: %s', stageFirst => {
    const directory = mkdtempSync(path.join(tmpdir(), 'corpus-status-'))
    const manifest = path.join(directory, 'manifest.json')
    writeFileSync(manifest, JSON.stringify({ corpusVersion: 'fixture-corpus', status: 'approved', sources: [], chunks: [] }))
    const args = stageFirst ? ['--stage', 'preflight', manifest] : [manifest, '--stage', 'preflight']
    const result = spawnSync(process.execPath, ['scripts/corpus-status.mjs', ...args, '--gate'], { encoding: 'utf8' })
    expect(result.status).toBe(1) // Incomplete fixture must still fail its real gate.
    expect(JSON.parse(result.stdout)).toMatchObject({ corpusVersion: 'fixture-corpus', stage: 'preflight', gate: 'blocked' })
  })

  it('rejects --stage without a value rather than silently evaluating closure', () => {
    const result = spawnSync(process.execPath, ['scripts/corpus-status.mjs', '--stage'], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Falta valor de --stage')
  })
})
