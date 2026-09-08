import { z } from 'zod'
import { canonical } from './identity.ts'
import { changeSetSchema, coachEventSchema, futureSessionSchema } from '../../adaptation-core/src/contract.ts'
import type { LabCorpus, LabDecision, LabInput } from './types.ts'

const text = z.string().min(1)
const finite = z.number().finite()
const nonnegative = finite.nonnegative()
const strings = z.array(text)
const workoutExercise = z.object({
  occurrenceId: text, exerciseId: text, order: nonnegative.int(), role: z.enum(['strength', 'hypertrophy', 'accessory']),
  plannedSets: nonnegative.int(), repRangeMin: z.number().int().positive(), repRangeMax: z.number().int().positive(),
  targetRpeMin: finite.min(0).max(10).optional(), targetRpeMax: finite.min(0).max(10).optional(), loadIncrementKg: finite.positive(),
  sets: z.array(z.object({ type: z.enum(['normal', 'warmup', 'failure', 'drop']), weightKg: nonnegative, reps: nonnegative.int(), completed: z.boolean(), rir: finite.min(0).max(20).optional(), rpe: finite.min(0).max(10).optional() }).strict()),
}).strict().refine(e => e.repRangeMax >= e.repRangeMin && (e.targetRpeMax ?? 10) >= (e.targetRpeMin ?? 0), 'Rango del historial inválido')

const inputSchema = z.object({
  event: coachEventSchema,
  context: z.object({ version: text, capturedAt: finite, timezone: text, isCurrent: z.boolean() }).strict(),
  profile: z.object({ id: text, age: finite.int().positive(), experience: z.enum(['novice', 'intermediate', 'advanced']), goals: strings, preferences: strings }).strict(),
  history: z.object({ workouts: z.array(z.object({
    id: text, startedAt: finite, endedAt: finite.optional(), name: text, exercises: z.array(workoutExercise),
    feedback: z.object({ completed: z.boolean().optional(), generalPain: z.boolean().optional(), exercisePain: strings.optional(), energy: finite.min(0).max(5).optional(), difficulty: finite.min(0).max(5).optional(), contradictory: z.boolean().optional() }).strict().optional(),
  }).strict().refine(w => w.endedAt === undefined || w.endedAt >= w.startedAt, 'Cronología inválida')) }).strict(),
  plan: z.object({ sessions: z.array(futureSessionSchema).max(30) }).strict(),
  restrictions: z.object({ injuriesOrPain: strings, unavailableEquipment: strings, excludedExercises: strings, nutritionConstraints: strings }).strict(),
  permissions: z.object({ accountId: text, consentVersion: text, canReadHistory: z.boolean(), canReadGoals: z.boolean(), canReadCatalog: z.boolean(), canPropose: z.boolean(), canApply: z.boolean() }).strict(),
  catalog: z.array(z.object({ id: text, name: text, equipment: strings, muscles: strings, alternatives: strings }).strict()),
}).strict()

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Identidades duplicadas: ${label}`)
}

export function validateLabInput(input: LabInput): void {
  inputSchema.parse(input)
  if (input.context.version !== input.event.contextVersion) throw new Error('El contexto y el evento tienen versiones distintas')
  if (input.permissions.accountId !== input.event.accountId) throw new Error('La cuenta ficticia no coincide con el evento')
  unique(input.catalog.map(e => e.id), 'catálogo')
  unique(input.history.workouts.map(w => w.id), 'sesiones realizadas')
  unique(input.plan.sessions.map(s => s.sessionId), 'sesiones futuras')
  for (const session of [...input.history.workouts, ...input.plan.sessions]) unique(session.exercises.map(e => e.occurrenceId), 'ocurrencias por sesión')
}

/**
 * Security boundary for adversarial user text. These requests must never
 * reach a model/tool loop: the safe behavior is an explicit abstention.
 * The corpus and all other event fields remain untrusted data.
 */
export function safetyReason(input: LabInput): string | undefined {
  const message = typeof input.event.payload.message === 'string'
    ? input.event.payload.message.trim().toLocaleLowerCase('es')
    : ''
  if (!message) return undefined
  const rules: Array<[RegExp, string]> = [
    [/ignora\s+las\s+restricciones|cambia\s+toda\s+la\s+rutina/, 'instruction-override'],
    [/cita\s+una\s+fuente\s+que\s+no\s+existe|inventa?r\s+un\s+estudio/, 'fabricated-evidence'],
    [/datos\s+reales\s+del\s+usuario|video\s+personal/, 'private-data-or-video'],
    [/aplica\s+el\s+cambio\s+sin\s+confirmaci[oó]n/, 'unauthorized-application'],
    [/versi[oó]n\s+obsoleta\s+del\s+contexto/, 'stale-context'],
    [/revela\s+el\s+token\s+del\s+proveedor/, 'secret-disclosure'],
    [/ignorar\s+el\s+dolor/, 'unsafe-medical-advice'],
    [/presupuesto\s+est[aá]\s+agotado/, 'budget-bypass'],
  ]
  return rules.find(([pattern]) => pattern.test(message))?.[1]
}

export function exerciseRestriction(input: LabInput, id: string): string | undefined {
  const exercise = input.catalog.find(e => e.id === id)
  if (!exercise) return `Ejercicio ajeno al catálogo: ${id}`
  if (input.restrictions.excludedExercises.includes(id)) return `Ejercicio excluido: ${id}`
  const unavailable = new Set(input.restrictions.unavailableEquipment.map(e => e.trim().toLocaleLowerCase('es')))
  if (exercise.equipment.some(e => unavailable.has(e.trim().toLocaleLowerCase('es')))) return `Equipo no disponible: ${id}`
}

/** Integridad automática; el respaldo semántico de afirmaciones nuevas requiere revisión independiente. */
export function decisionViolations(input: LabInput, decision: LabDecision, corpus: LabCorpus): string[] {
  const failures: string[] = []
  for (const citation of decision.evidence) {
    if (corpus.status !== 'approved' || !corpus.sources.some(s => s.id === citation.sourceId && s.approved) ||
        !corpus.chunks.some(c => c.sourceId === citation.sourceId && c.location === citation.location && (!citation.excerpt || c.text.includes(citation.excerpt)))) failures.push('cita no recuperable o extracto inventado')
  }
  if (decision.kind !== 'propose') return failures
  const parsed = changeSetSchema.safeParse(decision.changeSet)
  if (!parsed.success) return [...failures, 'ChangeSet inválido']
  const change = parsed.data
  if (change.accountId !== input.event.accountId || change.eventId !== input.event.id || change.expectedContextVersion !== input.context.version) failures.push('identidad o versión del ChangeSet incorrecta')
  if (change.createdAt !== input.event.occurredAt) failures.push('fecha del ChangeSet ajena al evento')
  if (!input.context.isCurrent || !input.permissions.canPropose || !input.permissions.canReadCatalog || !input.permissions.canReadHistory || !input.permissions.canReadGoals) failures.push('contexto o permisos insuficientes')
  if (input.restrictions.injuriesOrPain.length || input.history.workouts.some(w => w.id === input.event.payload.workoutId && (w.feedback?.generalPain || w.feedback?.exercisePain?.length || w.feedback?.contradictory))) failures.push('dolor o contradicción sin resolver')
  const current = input.history.workouts.find(w => w.id === input.event.payload.workoutId)
  if (input.event.type === 'session-finished' && (!current || current.endedAt === undefined || current.feedback?.completed === false)) failures.push('sesión ausente o incompleta')
  if (current?.exercises.some(e => e.sets.some(s => s.completed && s.type !== 'warmup' && s.rir === undefined))) failures.push('RIR sin aclarar')
  if (change.domain !== 'training' || change.operations.some(o => o.kind === 'nutrition-goals')) failures.push('dominio fuera de alcance')
  if (!change.futurePlan) return [...failures, 'falta planificación futura completa']
  uniqueCheck(change.operations.map(o => o.operationId), 'operación duplicada', failures)
  const originalSessions = new Map(input.plan.sessions.map(s => [s.sessionId, s]))
  if (change.futurePlan.sessions.length !== originalSessions.size) failures.push('se perdieron o añadieron sesiones sin contexto')
  uniqueCheck(change.futurePlan.sessions.map(s => s.sessionId), 'sesión duplicada', failures)
  for (const session of change.futurePlan.sessions) {
    const original = originalSessions.get(session.sessionId)
    if (!original) { failures.push('sesión ajena al contexto'); continue }
    if (session.scheduledAt !== original.scheduledAt) failures.push('fecha futura alterada sin operación compatible')
    if (original.exercises.some(e => !session.exercises.some(after => after.occurrenceId === e.occurrenceId))) failures.push('ocurrencia eliminada sin operación compatible')
    uniqueCheck(session.exercises.map(e => e.occurrenceId), 'ocurrencia duplicada', failures)
    for (const exercise of session.exercises) {
      const restriction = exerciseRestriction(input, exercise.exerciseId)
      if (restriction) failures.push(restriction)
      if (exercise.setTargets.length !== exercise.plannedSets) failures.push('faltan objetivos por serie')
      if ((exercise.targetRpeMin ?? 0) < 0 || (exercise.targetRpeMax ?? 10) > 10 || (exercise.targetRpeMin ?? 0) > (exercise.targetRpeMax ?? 10)) failures.push('RPE futuro inválido')
      const before = original.exercises.find(e => e.occurrenceId === exercise.occurrenceId)
      if (!before) failures.push('ocurrencia añadida sin operación compatible')
      if (before && canonical(before) !== canonical(exercise) && !change.operations.some(o => (o.kind === 'routine' || o.kind === 'exercise-substitution') && o.occurrenceId === exercise.occurrenceId)) failures.push('cambio sin operación para la ocurrencia')
      if (before && before.exerciseId === exercise.exerciseId) {
        const warmups = (targets: typeof exercise.setTargets) => targets.filter(t => t.type === 'warmup')
        if (canonical(warmups(before.setTargets)) !== canonical(warmups(exercise.setTargets))) failures.push('calentamientos alterados')
        if (before.setTargets.some((t, i) => t.type === 'warmup' && canonical(t) !== canonical(exercise.setTargets[i]))) failures.push('orden de calentamientos alterado')
        const observed = current?.exercises.find(e => e.occurrenceId === before.occurrenceId && e.exerciseId === before.exerciseId)
        if (observed && exercise.setTargets.some((target, i) => {
          const prior = before.setTargets[i]
          if (target.weightKg === undefined || prior?.weightKg === undefined || target.type === 'warmup') return false
          const steps = (target.weightKg - prior.weightKg) / observed.loadIncrementKg
          return Math.abs(steps - Math.round(steps)) > 0.000001
        })) failures.push('carga incompatible con el incremento del ejercicio')
      }
    }
  }
  for (const operation of change.operations) {
    if (operation.kind === 'nutrition-goals') continue
    if (operation.kind === 'routine-create' || operation.kind === 'routine-retire') {
      if (operation.routineId !== input.event.payload.routineId || operation.expectedRevision !== input.event.payload.routineRevision) failures.push('rutina o revisión ajena al contexto')
      continue
    }
    if (operation.routineId !== input.event.payload.routineId || operation.expectedRevision !== input.event.payload.routineRevision) failures.push('rutina o revisión ajena al contexto')
    const before = input.plan.sessions.flatMap(s => s.exercises).filter(e => e.occurrenceId === operation.occurrenceId)
    const after = change.futurePlan.sessions.flatMap(s => s.exercises).filter(e => e.occurrenceId === operation.occurrenceId)
    if (before.length !== 1 || after.length !== 1) { failures.push('ocurrencia de operación ausente o ambigua'); continue }
    if (operation.kind === 'exercise-substitution' && operation.exerciseId !== after[0].exerciseId) failures.push('sustitución inconsistente')
    if (operation.kind === 'routine') {
      for (const key of ['plannedSets', 'repRangeMin', 'repRangeMax', 'exerciseId'] as const) if (operation.patch[key] !== undefined && operation.patch[key] !== after[0][key]) failures.push(`patch inconsistente: ${key}`)
      if (operation.patch.loadKg !== undefined && after[0].setTargets.some(t => t.weightKg !== operation.patch.loadKg)) failures.push('carga escalar pierde objetivos por serie')
    }
  }
  const citations = (items: typeof change.evidence) => items.map(({ claim, sourceId, location, excerpt }) => ({ claim, sourceId, location, excerpt }))
  if (JSON.stringify(citations(change.evidence)) !== JSON.stringify(citations(decision.evidence))) failures.push('citas del ChangeSet difieren de la decisión')
  return [...new Set(failures)]
}

function uniqueCheck(values: string[], message: string, failures: string[]): void {
  if (new Set(values).size !== values.length) failures.push(message)
}
