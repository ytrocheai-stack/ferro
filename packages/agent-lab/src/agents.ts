import { changeSetSchema, type ChangeSet, type PlannedExercise } from '../../adaptation-core/src/contract.ts'
import { fnv1a64 } from '../../adaptation-core/src/index.ts'
import type { AgentTrace, LabCorpus, LabDecision, LabEvidence, LabInput, LabObservation, ModelBudget } from './types.ts'
import { calculateTrends, explainMetrics, planExercises, readGoals, readHistory, readRestrictions, searchEvidence } from './tools.ts'

function trace(agent: AgentTrace['agent'], status: AgentTrace['status'], observations: LabObservation[], evidence: LabEvidence[] = []): AgentTrace {
  return { agent, status, observations, evidence, durationMs: 0 }
}

function base(_kind: LabDecision['kind'], explanation: string, observations: LabObservation[], evidence: LabEvidence[], traces: AgentTrace[]): Omit<LabDecision, 'kind'> {
  return { explanation, observations, evidence, trace: traces, executionMode: 'simulated', qualityEvidence: false } as Omit<LabDecision, 'kind'>
}

function safePayloadString(input: LabInput, key: string): string | undefined {
  const value = input.event.payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function safePayloadNumber(input: LabInput, key: string, fallback: number): number {
  const value = input.event.payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function targetForExercise(exercise: PlannedExercise, kind: 'load' | 'reps', loadIncrement: number): PlannedExercise {
  const setTargets = exercise.setTargets.map(previous => previous.type === 'warmup' ? { ...previous } : {
    ...previous,
    ...(kind === 'load' && previous.weightKg !== undefined ? { weightKg: previous.weightKg + loadIncrement } : {}),
    ...(kind === 'reps' && previous.reps !== undefined ? { reps: previous.reps + 1 } : {}),
  })
  return { ...exercise, setTargets, ...(kind === 'reps' ? {
    repRangeMin: (exercise.repRangeMin ?? 1) + 1,
    repRangeMax: (exercise.repRangeMax ?? exercise.repRangeMin ?? 1) + 1,
  } : {}) }
}

function buildChangeSet(input: LabInput, exercise: PlannedExercise, next: PlannedExercise, kind: 'load' | 'reps' | 'set', observation: string, evidence: LabEvidence[]): ChangeSet {
  const routineId = safePayloadString(input, 'routineId') ?? 'fictional-routine'
  const expectedRevision = safePayloadNumber(input, 'routineRevision', 1)
  const operation = {
    operationId: `op-${fnv1a64(`${input.event.id}:${exercise.occurrenceId}:${kind}`)}`,
    expectedRevision,
    kind: 'routine' as const,
    routineId,
    occurrenceId: exercise.occurrenceId,
    patch: {
      plannedSets: next.plannedSets,
      ...(next.repRangeMin !== undefined ? { repRangeMin: next.repRangeMin } : {}),
      ...(next.repRangeMax !== undefined ? { repRangeMax: next.repRangeMax } : {}),
    },
  }
  const changeSet = {
    id: `changeset-${input.event.id}`,
    accountId: input.permissions.accountId,
    eventId: input.event.id,
    domain: 'training' as const,
    expectedContextVersion: input.context.version,
    explanation: observation,
    observations: [observation],
    evidence: evidence.map((item) => ({ claim: item.claim, sourceId: item.sourceId, location: item.location, ...(item.excerpt ? { excerpt: item.excerpt } : {}) })),
    operations: [operation],
    futurePlan: {
      horizon: input.plan.sessions.length > 1 ? 'microcycle' as const : 'next-session' as const,
      sessions: input.plan.sessions.map((session) => ({
        sessionId: session.sessionId,
        name: session.name,
        ...(session.scheduledAt !== undefined ? { scheduledAt: session.scheduledAt } : {}),
        exercises: session.exercises.map((candidate) => candidate.occurrenceId === exercise.occurrenceId ? next : candidate),
      })),
    },
    createdAt: input.event.occurredAt,
    policyVersion: 'agent-lab-training-v1',
  }
  return changeSetSchema.parse(changeSet)
}

export function runTrainingAgent(input: LabInput, _budget: ModelBudget): LabDecision {
  void _budget
  const observations: LabObservation[] = []
  if (!input.context.isCurrent) return { ...base('abstain', 'No propongo cambios porque el contexto capturado ya no es vigente.', [{ text: 'El contexto está obsoleto.', kind: 'limitation', source: 'context' }], [], [trace('training', 'blocked', [{ text: 'Contexto obsoleto.', kind: 'limitation', source: 'context' }])]), kind: 'abstain', reason: 'contexto-obsoleto' }
  if (!input.permissions.canReadHistory || !input.permissions.canReadGoals || !input.permissions.canReadCatalog || !input.permissions.canPropose) return { ...base('abstain', 'No propongo cambios porque faltan permisos simulados para leer el contexto o crear una propuesta.', [{ text: 'Permisos insuficientes.', kind: 'limitation', source: 'permissions' }], [], [trace('training', 'blocked', [{ text: 'Permisos insuficientes.', kind: 'limitation', source: 'permissions' }])]), kind: 'abstain', reason: 'permisos-insuficientes' }
  const history = readHistory(input.history, input.permissions)
  const current = history.workouts.find((workout) => workout.id === safePayloadString(input, 'workoutId')) ?? [...history.workouts].sort((a, b) => a.startedAt - b.startedAt).at(-1)
  if (!current || current.endedAt === undefined || current.feedback?.completed === false) return { ...base('ask', 'Necesito una sesión terminada y su estado de finalización antes de evaluar ajustes.', [{ text: 'La sesión no está completa.', kind: 'limitation', source: 'history' }], [], [trace('training', 'blocked', [{ text: 'Sesión incompleta.', kind: 'limitation', source: 'history' }])]), kind: 'ask', questions: ['¿La sesión terminó completa o se interrumpió?'] }
  if (current.feedback?.contradictory) return { ...base('ask', 'Necesito aclarar el feedback contradictorio antes de proponer cambios.', [], [], [trace('training', 'blocked', [])]), kind: 'ask', questions: ['¿Cuál es el objetivo y feedback correcto para esta sesión?'] }
  const restrictions = readRestrictions(input)
  if (current.feedback?.generalPain || (current.feedback?.exercisePain?.length ?? 0) > 0 || restrictions.injuriesOrPain.length > 0) return { ...base('maintain', 'Mantengo el plan y no incremento la carga cuando hay dolor declarado; esto no es un diagnóstico.', [{ text: 'Hay dolor declarado o una restricción física activa.', kind: 'observation', source: 'feedback' }], [], [trace('training', 'completed', [{ text: 'Bloqueo preventivo por dolor.', kind: 'limitation', source: 'feedback' }])]), kind: 'maintain' }
  const missingRir = current.exercises.some((exercise) => workingSetCount(exercise) > 0 && workingSetsWithoutWarmup(exercise).some((set) => set.rir === undefined))
  if (missingRir) return { ...base('ask', 'Antes de ajustar el esfuerzo necesito el RIR registrado; no lo infiero desde RPE.', [{ text: 'Falta RIR explícito en una o más series de trabajo.', kind: 'limitation', source: 'history' }], [], [trace('training', 'blocked', [{ text: 'RIR ausente.', kind: 'limitation', source: 'history' }])]), kind: 'ask', questions: ['¿Qué RIR registraste en las series de trabajo?'] }
  const goals = readGoals(input)
  const exercises = planExercises(input.plan)
  if (!exercises.length) return { ...base('abstain', 'No propongo cambios porque no hay una planificación futura estructurada.', [{ text: 'El plan no contiene sesiones futuras.', kind: 'limitation', source: 'plan' }], [], [trace('training', 'blocked', [{ text: 'Plan futuro ausente.', kind: 'limitation', source: 'plan' }])]), kind: 'abstain', reason: 'plan-ausente' }
  const metrics = explainMetrics(input)
  const currentExercise = current.exercises.find((exercise) => exercise.occurrenceId === exercises[0].occurrenceId && exercise.exerciseId === exercises[0].exerciseId)
  const planned = exercises.find((exercise) => exercise.occurrenceId === currentExercise?.occurrenceId) ?? exercises[0]
  const trend = calculateTrends(history, planned.exerciseId, planned.occurrenceId)
  const performance = currentExercise ? workingSetsWithoutWarmup(currentExercise) : []
  const allUpper = performance.length >= planned.setTargets.filter(t => t.type !== 'warmup').length && performance.every((set) => set.completed && set.reps >= (planned.repRangeMax ?? planned.repRangeMin ?? 1))
  const complete = performance.length >= planned.setTargets.filter(t => t.type !== 'warmup').length && performance.every((set) => set.completed)
  const observation = allUpper
    ? `Observación: se completó el límite superior en ${planned.exerciseId}; propongo una progresión pequeña compatible con el objetivo ${goals[0] ?? 'actual'}.`
    : complete
      ? `Observación: la sesión se completó sin alcanzar el límite superior; propongo progresar repeticiones antes que carga.`
      : `Observación: la ejecución no cubre toda la prescripción; mantengo el plan.`
  observations.push({ text: observation, kind: 'observation', source: 'history' })
  observations.push({ text: `Estimación: tendencia ${trend.direction}; volumen acumulado ${Math.round(metrics.metrics.totalVolumeKg)} kg.`, kind: 'estimate', source: 'metrics' })
  if (trend.direction === 'declining' || !complete) return { ...base('maintain', `${observation} No hay base suficiente para incrementar ahora.`, observations, [], [trace('training', 'completed', observations)]), kind: 'maintain' }
  const kind = allUpper ? 'load' : 'reps'
  const next = targetForExercise(planned, kind, currentExercise!.loadIncrementKg)
  const changeSet = buildChangeSet(input, planned, next, kind, observation, [])

  return { ...base('propose', observation, observations, [], [trace('training', 'completed', observations)]), kind: 'propose', changeSet }
}

function workingSetsWithoutWarmup(exercise: { sets: Array<{ type: string; completed: boolean; reps: number; rir?: number }> }) { return exercise.sets.filter((set) => set.type !== 'warmup') }
function workingSetCount(exercise: { sets: Array<{ type: string }> }) { return exercise.sets.filter((set) => set.type !== 'warmup').length }

export function runResearchAgent(_input: LabInput, corpus: LabCorpus, query: string): AgentTrace {
  const evidence = searchEvidence(corpus, query, 5)
  const observations: LabObservation[] = evidence.length
    ? [{ text: `Se recuperaron ${evidence.length} fragmentos del corpus aprobado.`, kind: 'observation', source: 'corpus' }]
    : [{ text: 'No hay fragmentos aprobados relevantes; no se inventa una cita.', kind: 'limitation', source: 'corpus' }]
  return trace('research', 'completed', observations, evidence)
}

export function runNutritionAgent(_input: LabInput): LabDecision {
  void _input
  return { ...base('unavailable', 'Nutrition Agent queda fuera de la entrega inicial del laboratorio.', [{ text: 'Dominio reservado para una entrega posterior.', kind: 'limitation', source: 'scope' }], [], [trace('nutrition', 'skipped', [{ text: 'Fuera de alcance inicial.', kind: 'limitation', source: 'scope' }])]), kind: 'unavailable', reason: 'future-delivery' }
}

export function runTechniqueAgent(_input: LabInput): LabDecision {
  void _input
  return { ...base('ask', 'Puedo ofrecer técnica educativa respaldada por el corpus, pero no analizaré videos personales.', [{ text: 'La técnica del laboratorio es educativa y no visual.', kind: 'limitation', source: 'scope' }], [], [trace('technique', 'completed', [{ text: 'Sin análisis de videos personales.', kind: 'limitation', source: 'scope' }])]), kind: 'ask', questions: ['¿Qué ejercicio y qué fase del movimiento quieres revisar?'] }
}
