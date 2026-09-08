import { expect, it } from 'vitest'
import { evaluateAcceptance, scoreDecision } from './evaluation'
import { runLab } from './orchestrator'
import { acceptanceScenarios, developmentScenarios, emptyLabCorpus, safetyScenarios } from './scenarios'

it('H3: limita aceptación a 28 fixtures, sin solapamiento y con estímulos de seguridad visibles', () => {
  expect(acceptanceScenarios).toHaveLength(28)
  expect(new Set(acceptanceScenarios.map(s => s.caseNumber)).size).toBe(14)
  expect(developmentScenarios.some(d => acceptanceScenarios.some(a => JSON.stringify(d.input) === JSON.stringify(a.input)))).toBe(false)
  expect(new Set(safetyScenarios.map(s => String(s.input.event.payload.message))).size).toBe(10)
  expect(acceptanceScenarios.some(s => s.continuation)).toBe(true)
})

it('H3: revisa todas las repeticiones, variabilidad del contenido y especialistas requeridos', () => {
  const scenario = structuredClone(developmentScenarios[0])
  scenario.expectation.requiredAgents = ['research']
  let count = 0
  const report = evaluateAcceptance([scenario], emptyLabCorpus, 3, { runner: (s, c) => {
    const result = runLab(s.input, c)
    count++
    if (count === 2) result.decision = { ...result.decision, kind: 'abstain', reason: 'fallo intermedio', trace: [] }
    return result
  } })
  expect(report.accepted).toBe(0)
  expect(report.failures.some(f => f.failures.some(m => m.includes('research')))).toBe(true)
  expect(report.variability.decisionChanges).toBe(1)
})

it('H3: un resultado simulado nunca acredita el gate de calidad', () => {
  const report = evaluateAcceptance(developmentScenarios, emptyLabCorpus, 3)
  expect(report.passesGate).toBe(false)
})

it('H3: la rúbrica rechaza restricciones aunque la etiqueta de decisión sea correcta', () => {
  const scenario = structuredClone(developmentScenarios[0])
  const run = runLab(scenario.input, emptyLabCorpus)
  scenario.input.restrictions.excludedExercises = ['squat']
  const result = scoreDecision(scenario, run.decision, emptyLabCorpus)
  expect(result.passed).toBe(false)
  expect(result.failures.join(' ')).toContain('excluido')
})

it('H3: ejecuta la aclaración y fija el id de escenario en checkpoint', () => {
  const scenario = structuredClone(developmentScenarios[0])
  scenario.expectation = { decision: 'ask' }
  const history = structuredClone(scenario.input.history)
  scenario.input.history.workouts.at(-1)!.exercises[0].sets.forEach(s => { delete s.rir })
  scenario.continuation = { history }
  scenario.continuationExpectation = { decision: 'propose' }
  const report = evaluateAcceptance([scenario], emptyLabCorpus, 1)
  expect(report.runs.map(r => r.decision.kind)).toEqual(['ask', 'propose'])
  expect(report.checkpoint.completedScenarioIds).toEqual([scenario.id])
})
