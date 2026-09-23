import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LabJournal } from './journal'
import { runLab } from './orchestrator'
import { developmentScenarios, emptyLabCorpus } from './scenarios'
import { stableAuthorizationIdentity } from './identity'

it('H7: persiste y deduplica un evento tras reiniciar el ejecutor', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nextrep-lab-test-'))
  let executions = 0
  const action = async () => { executions++; return runLab(developmentScenarios[0].input, emptyLabCorpus) }
  const first = await new LabJournal(directory).execute('event', { corpus: 'v1' }, action)
  const second = await new LabJournal(directory).execute('event', { corpus: 'v1' }, action)
  expect(second).toEqual(first)
  expect(executions).toBe(1)
  await expect(new LabJournal(directory).execute('event', { corpus: 'changed' }, action)).rejects.toThrow(/identidad/)
})

it('H7: un intento interrumpido queda incierto y no vuelve a facturarse al reanudar', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nextrep-lab-test-'))
  const journal = new LabJournal(directory)
  await expect(journal.execute('event', {}, async beforeAttempt => {
    await beforeAttempt({ fingerprint: 'run', calls: 1, inputTokens: 100, outputTokens: 50 })
    throw new Error('interrupción')
  })).rejects.toThrow('interrupción')
  let called = false
  await expect(new LabJournal(directory).execute('event', {}, async () => { called = true; return runLab(developmentScenarios[0].input, emptyLabCorpus) })).rejects.toThrow(/incierto/)
  expect(called).toBe(false)
})

it('H7: rechaza corrupción del checkpoint en lugar de reiniciar', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nextrep-lab-test-'))
  await new LabJournal(directory).execute('event', {}, async () => runLab(developmentScenarios[0].input, emptyLabCorpus))
  const file = readdirSync(directory).find(f => f.endsWith('.json'))!
  writeFileSync(join(directory, file), '{}')
  await expect(new LabJournal(directory).execute('event', {}, async () => runLab(developmentScenarios[0].input, emptyLabCorpus))).rejects.toThrow()
})

it('H7: renovar autorización temporal no invalida un resultado confirmado', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nextrep-lab-test-'))
  let executions = 0
  const action = async () => { executions++; return runLab(developmentScenarios[0].input, emptyLabCorpus) }
  const stable = { model: 'deepseek-ai/deepseek-v4-flash-0731', maxCalls: 2 }
  const firstAuth = { ...stable, maxInputTokens: 1000, maxOutputTokens: 1000, timeoutMs: 1000, maxTotalCalls: 2, maxTotalInputTokens: 1000, maxTotalOutputTokens: 1000, verifiedAt: '2026-09-05T10:00:00.000Z' }
  const renewedAuth = { ...firstAuth, verifiedAt: '2026-09-05T11:00:00.000Z' }
  const first = await new LabJournal(directory).execute('event', { authorization: stableAuthorizationIdentity(firstAuth) }, action)
  const second = await new LabJournal(directory).execute('event', { authorization: stableAuthorizationIdentity(renewedAuth) }, action)
  expect(second).toEqual(first)
  expect(executions).toBe(1)
})

it('H7: un checkpoint con procedencia Kimi no se reanuda como Gemini', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nextrep-lab-provider-identity-'))
  const journal = new LabJournal(directory)
  const run = async () => runLab(developmentScenarios[0].input, emptyLabCorpus)
  await journal.execute('event', {
    mode: 'provider',
    providerId: 'moonshotai/kimi-k3',
    authorization: { model: 'moonshotai/kimi-k3' },
  }, run)
  await expect(journal.execute('event', {
    mode: 'provider',
    providerId: 'gemini-3.5-flash-lite',
    authorization: { provider: 'google-ai-studio', model: 'gemini-3.5-flash-lite', projectNumber: '233255822266' },
  }, run)).rejects.toThrow(/identidad distinta/)
})
