import { describe, expect, it } from 'vitest'
import { runLab } from './orchestrator'
import { developmentScenarios, emptyLabCorpus } from './scenarios'
import { calculateHistoryMetrics, calculateRecords, calculateTrends } from './tools'
import { evaluateRagQueries } from './evaluation'

const fixture = () => structuredClone(developmentScenarios[0].input)

describe('regresiones auditoría H1/H2/H5/H6/H7', () => {
  it.each(['excluded', 'equipment', 'catalog'] as const)('no propone un plan incompatible: %s', (restriction) => {
    const input = fixture()
    if (restriction === 'excluded') input.restrictions.excludedExercises = ['squat']
    if (restriction === 'equipment') input.restrictions.unavailableEquipment = ['barra', 'rack']
    if (restriction === 'catalog') input.catalog = []
    expect(runLab(input, emptyLabCorpus).decision.kind).not.toBe('propose')
  })
  it('pide aclaración ante feedback contradictorio', () => {
    const input = fixture()
    input.history.workouts.at(-1)!.feedback!.contradictory = true
    expect(runLab(input, emptyLabCorpus).decision.kind).toBe('ask')
  })
  it.each([-1, NaN, Infinity])('rechaza pesos inválidos incluso en historial antiguo: %s', (weight) => {
    const input = fixture()
    input.history.workouts[0].exercises[0].sets[0].weightKg = weight
    expect(() => runLab(input, emptyLabCorpus)).toThrow()
  })
  it('conserva calentamiento y cargas por serie y respeta incremento de 5 kg', () => {
    const input = fixture()
    const planned = input.plan.sessions[0].exercises[0]
    planned.setTargets = [{ type: 'warmup', weightKg: 20, reps: 10 }, { type: 'normal', weightKg: 100, reps: 5 }, { type: 'normal', weightKg: 90, reps: 6 }]
    input.history.workouts.at(-1)!.exercises[0].loadIncrementKg = 5
    const result = runLab(input, emptyLabCorpus)
    expect(result.decision.kind).toBe('propose')
    if (result.decision.kind !== 'propose') return
    expect(result.decision.changeSet.futurePlan!.sessions[0].exercises[0].setTargets).toEqual([
      { type: 'warmup', weightKg: 20, reps: 10 }, { type: 'normal', weightKg: 105, reps: 5 }, { type: 'normal', weightKg: 95, reps: 6 },
    ])
    expect(result.decision.changeSet.operations[0]).not.toHaveProperty('patch.loadKg')
  })
  it('no colapsa sesiones ni confunde ocurrencias repetidas', () => {
    const input = fixture()
    const second = structuredClone(input.plan.sessions[0])
    second.sessionId = 'second'
    second.exercises[0].occurrenceId = 'other-occurrence'
    second.exercises[0].setTargets[0].weightKg = 40
    input.plan.sessions.push(second)
    const result = runLab(input, emptyLabCorpus)
    expect(result.decision.kind).toBe('propose')
    if (result.decision.kind !== 'propose') return
    expect(result.decision.changeSet.futurePlan!.sessions[1]).toEqual(second)
  })
  it('excluye series no realizadas de récords y conteos', () => {
    const input = fixture()
    const before = calculateHistoryMetrics(input.history)
    input.history.workouts[0].exercises[0].sets.push({ type: 'normal', weightKg: 1000, reps: 10, completed: false })
    expect(calculateRecords(input.history).squat.weightKg).toBe(100)
    expect(calculateHistoryMetrics(input.history).workingSetCount).toBe(before.workingSetCount)
  })
  it('ordena exposiciones por fecha, no por posición', () => {
    const input = fixture()
    input.history.workouts = input.history.workouts.slice(0, 2).reverse()
    const [recent, old] = input.history.workouts
    recent.exercises[0].order = 0
    old.exercises[0].order = 1
    old.exercises[0].sets.forEach(s => { s.weightKg = 50 })
    expect(calculateTrends(input.history, 'squat')).toMatchObject({ direction: 'improving', priorMedianWeightKg: 50, recentMedianWeightKg: 100 })
  })
  it('no suma kilos y repeticiones para cambios compensados', () => {
    const input = fixture()
    input.history.workouts = input.history.workouts.slice(0, 2)
    input.history.workouts[1].exercises[0].sets.forEach(s => { s.weightKg = 110; s.reps = 3 })
    expect(calculateTrends(input.history, 'squat').direction).toBe('unknown')
  })
  it('nunca presenta reglas locales como ejecución del proveedor', () => {
    expect(runLab(fixture(), emptyLabCorpus, { mode: 'provider', providerAvailable: true }).decision.kind).toBe('unavailable')
  })
  it('no cuenta funciones locales como llamadas facturables', () => {
    expect(runLab(fixture(), emptyLabCorpus, { budget: { maxCalls: 1 } }).calls).toBe(0)
  })
  it('incluye el historial completo en el límite de entrada', () => {
    const input = fixture()
    input.history.workouts[0].name = 'x'.repeat(40000)
    expect(runLab(input, emptyLabCorpus, { budget: { maxInputTokens: 8000 } }).decision.kind).toBe('unavailable')
  })
})

it('H4: RAG no puede aprobar fuentes prohibidas ni ocultar el fallo', () => {
  const corpus = { version: 'test', status: 'proposal' as const, sources: [{ id: 's', author: 'fixture', title: 'fixture', url: 'https://example.com', license: 'pending', approved: false }], chunks: [{ id: 'c', sourceId: 's', text: 'carga', location: 'fixture' }] }
  const result = evaluateRagQueries(Array.from({ length: 50 }, (_, i) => ({ id: `q${i}`, text: 'carga', relevantChunkIds: ['c'], hardNegativeChunkIds: [] })), corpus)
  expect(result.passesGate).toBe(false)
  expect(result.recallAt5).toBe(0)
  expect(result.failures.length).toBeGreaterThan(0)
})
