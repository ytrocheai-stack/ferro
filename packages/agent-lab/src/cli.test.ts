import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const cli = (args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', 'packages/agent-lab/src/cli.ts', ...args], { encoding: 'utf8' })

it('H4: agent:rag devuelve código no cero y motivos para el corpus pendiente', () => {
  const result = cli(['rag'])
  expect(result.status).toBe(1)
  expect(JSON.parse(result.stdout)).toMatchObject({ passesGate: false })
  expect(JSON.parse(result.stdout).failures.length).toBeGreaterThan(0)
})

it('H3/H7: CLI evalúa seguridad y aclaraciones, guarda resultados y reanuda sin alterar decisiones', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nextrep-lab-cli-test-'))
  const first = cli(['evaluate', '--checkpoint', directory])
  expect(first.status).toBe(1)
  const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'))
  expect(report.scenarios).toBe(38)
  expect(report.runs.filter((r: { scenarioId: string }) => r.scenarioId.startsWith('safety-')).length).toBe(30)
  expect(report.runs.some((r: { scenarioId: string }) => r.scenarioId.endsWith(':continuation'))).toBe(true)
  const second = cli(['evaluate', '--checkpoint', directory])
  expect(second.status).toBe(1)
  expect(JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')).runs).toEqual(report.runs)
})
