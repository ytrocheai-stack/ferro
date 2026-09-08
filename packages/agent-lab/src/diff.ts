import type { LabInput, LabDecision } from './types.ts'
import { canonical } from './identity.ts'

/** Diferencias revisables, incluidas adiciones y retiradas, sin aplicar cambios. */
export function planDiff(input: LabInput, decision: LabDecision): Array<{ sessionId: string; occurrenceId: string; before: unknown; after: unknown }> {
  if (decision.kind !== 'propose' || !decision.changeSet.futurePlan) return []
  const before = new Map(input.plan.sessions.flatMap(s => s.exercises.map(e => [`${s.sessionId}:${e.occurrenceId}`, { sessionId: s.sessionId, exercise: e }] as const)))
  const after = new Map(decision.changeSet.futurePlan.sessions.flatMap(s => s.exercises.map(e => [`${s.sessionId}:${e.occurrenceId}`, { sessionId: s.sessionId, exercise: e }] as const)))
  return [...new Set([...before.keys(), ...after.keys()])].filter(key => canonical(before.get(key)) !== canonical(after.get(key))).map(key => {
    const item = after.get(key) ?? before.get(key)!
    return { sessionId: item.sessionId, occurrenceId: item.exercise.occurrenceId, before: before.get(key)?.exercise ?? null, after: after.get(key)?.exercise ?? null }
  })
}
