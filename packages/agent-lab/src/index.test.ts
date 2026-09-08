import { describe, expect, it } from 'vitest'
import { changeSetSchema } from '../../adaptation-core/src/contract'
import { evaluateAcceptance, evaluateRagQueries } from './evaluation'
import { runLab, runOrchestrator } from './orchestrator'
import { acceptanceScenarios, createScenario, developmentScenarios, emptyLabCorpus, safetyScenarios } from './scenarios'
import { calculateRecords, calculateVolume, searchEvidence } from './tools'

describe('agent lab', () => {
  it('keeps the frozen scenario sets complete', () => {
    expect(developmentScenarios).toHaveLength(14)
    expect(acceptanceScenarios).toHaveLength(28)
    expect(safetyScenarios).toHaveLength(10)
    expect(new Set(acceptanceScenarios.map((scenario) => scenario.caseNumber)).size).toBe(14)
  })

  it('runs the first delivery without IndexedDB or provider calls', () => {
    const scenario = developmentScenarios[0]
    const result = runLab(scenario.input, emptyLabCorpus)
    expect(result.decision.kind).toBe('propose')
    if (result.decision.kind === 'propose') {
      expect(result.decision.executionMode).toBe('simulated')
      expect(result.decision.qualityEvidence).toBe(false)
      expect(changeSetSchema.parse(result.decision.changeSet).futurePlan?.sessions[0].exercises[0].order).toBe(0)
      expect(result.decision.changeSet.operations[0].kind).toBe('routine')
    }
  })

  it('maintains the plan for pain and asks for unsupported events', () => {
    const adverse = acceptanceScenarios.find((scenario) => scenario.caseNumber === 1 && scenario.variant === 'adverse')!
    expect(runOrchestrator(adverse.input, emptyLabCorpus).kind).toBe('maintain')
    const unsupported = createScenario(2, 'satisfactory', 'development')
    expect(runOrchestrator(unsupported.input, emptyLabCorpus).kind).toBe('ask')
  })

  it('reads metrics and refuses unapproved evidence', () => {
    const input = developmentScenarios[0].input
    expect(Object.keys(calculateRecords(input.history))).toContain('squat')
    expect(calculateVolume(input.history).squat).toBeGreaterThan(0)
    expect(searchEvidence({ ...emptyLabCorpus, status: 'proposal', chunks: [{ id: 'bad', sourceId: 'bad-source', text: 'carga', location: 'x' }] }, 'carga')).toEqual([])
  })

  it('reports three deterministic repetitions and a 90 percent acceptance gate', () => {
    const report = evaluateAcceptance(developmentScenarios, emptyLabCorpus, 3)
    expect(report.repetitions).toBe(3)
    expect(report.variability.decisionChanges).toBe(0)
    expect(report.passesGate).toBe(false)
    expect(report.qualityBlockers).toContain('corpus vacío o sin aprobar')
  })

  it('requires exactly fifty RAG queries', () => {
    const report = evaluateRagQueries(Array.from({ length: 50 }, (_, index) => ({ id: `q${index + 1}`, text: 'carga', relevantChunkIds: ['missing'], hardNegativeChunkIds: ['other'] })), emptyLabCorpus)
    expect(report.queryCount).toBe(50)
    expect(report.passesGate).toBe(false)
  })
})
