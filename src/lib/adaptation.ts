import { db } from '../db/db'
import type { AdaptationCandidateRecord, AdaptationProposal, Routine, RoutineExercise, RoutineRevisionSnapshot } from '../db/types'
import { isRoutineContextCurrent, readCurrentAdaptationContext } from './adaptationContext'
import { getCoachAccountId } from './coachAccount'

export interface ProposalDecision {
  proposalId: string
  decision: 'accept' | 'reject'
  candidateId?: string
}

export interface ApplyResult {
  status: 'applied' | 'stale'
  routineId: string
  routineRevision?: number
  appliedProposalIds: string[]
}

export function normalizeRoutine(routine: Routine): Routine {
  const trainingRole = routine.trainingRole ?? 'hypertrophy'
  const loadIncrementKg = routine.loadIncrementKg ?? 2.5
  return {
    ...routine,
    revision: routine.revision ?? 1,
    trainingRole,
    loadIncrementKg,
    coachReviewed: routine.coachReviewed ?? false,
    exercises: routine.exercises.map((exercise, index) => ({
      ...exercise,
      occurrenceId: exercise.occurrenceId ?? `${routine.id}:${index}:${exercise.exerciseId}`,
      trainingRole: exercise.trainingRole ?? exercise.role ?? trainingRole,
      role: undefined,
      loadIncrementKg: exercise.loadIncrementKg ?? loadIncrementKg,
    })),
  }
}

function workingLoad(exercise: RoutineExercise): number | undefined {
  const load = exercise.setTargets?.find((set) => set.type !== 'warmup' && set.weightKg !== undefined)?.weightKg
  return load === undefined ? undefined : load
}

function currentSnapshot(exercise: RoutineExercise) {
  return {
    plannedSets: exercise.plannedSets,
    repsMin: exercise.repRangeMin ?? exercise.setTargets?.find((set) => set.type !== 'warmup' && set.reps !== undefined)?.reps ?? 8,
    repsMax: exercise.repRangeMax ?? exercise.setTargets?.find((set) => set.type !== 'warmup' && set.reps !== undefined)?.reps ?? 12,
    loadKg: workingLoad(exercise),
  }
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  return a === b || (a === undefined && b === undefined)
}

function matchesCandidate(exercise: RoutineExercise, candidate: AdaptationCandidateRecord): boolean {
  const current = currentSnapshot(exercise)
  return current.plannedSets === candidate.previous.plannedSets &&
    current.repsMin === candidate.previous.repsMin &&
    current.repsMax === candidate.previous.repsMax &&
    sameNumber(current.loadKg, candidate.previous.loadKg)
}

function setTargetsFor(candidate: AdaptationCandidateRecord, current: RoutineExercise) {
  const source = current.setTargets ?? []
  const working = source.filter((set) => set.type !== 'warmup')
  const fallback = working[working.length - 1] ?? { type: 'normal' as const }
  const nextWorking = Array.from({ length: candidate.next.plannedSets }, (_, index) => {
    const previous = working[index] ?? fallback
    return {
      ...previous,
      ...(candidate.next.loadKg !== undefined ? { weightKg: candidate.next.loadKg } : {}),
      ...(candidate.kind === 'increase-reps' ? { reps: candidate.next.repsMin } : {}),
    }
  })
  const result: typeof source = []
  let workingIndex = 0
  for (const set of source) {
    if (set.type === 'warmup') result.push(set)
    else if (workingIndex < nextWorking.length) result.push(nextWorking[workingIndex++])
  }
  while (workingIndex < nextWorking.length) result.push(nextWorking[workingIndex++])
  return result
}

function applyCandidate(exercise: RoutineExercise, candidate: AdaptationCandidateRecord): RoutineExercise {
  return {
    ...exercise,
    plannedSets: candidate.next.plannedSets,
    repRangeMin: candidate.next.repsMin,
    repRangeMax: candidate.next.repsMax,
    // También para increase-reps: el candidato conserva la carga actual, pero
    // los objetivos por serie deben reflejar el nuevo mínimo de repeticiones.
    ...(candidate.kind !== 'maintain' ? { setTargets: setTargetsFor(candidate, exercise) } : {}),
  }
}

export async function applyAdaptationDecisions(analysisId: string, decisions: ProposalDecision[]): Promise<ApplyResult> {
  return db.transaction('rw', [db.workouts, db.routines, db.adaptationProposals, db.routineRevisionSnapshots], async () => {
    const ownerId = getCoachAccountId()
    if (!ownerId) throw new Error('Se requiere una cuenta para aplicar una adaptación')
    const proposals = await db.adaptationProposals.where('analysisId').equals(analysisId).filter((proposal) => proposal.ownerId === ownerId).toArray()
    const active = proposals.filter((proposal) => proposal.status === 'pending')
    if (!active.length || decisions.length !== active.length || new Set(decisions.map((decision) => decision.proposalId)).size !== active.length || active.some((proposal) => !decisions.some((decision) => decision.proposalId === proposal.id))) {
      throw new Error('Debes tomar una decisión explícita sobre todas las propuestas activas')
    }
    const routineIds = new Set(active.map((proposal) => proposal.baseRoutineId))
    const revisions = new Set(active.map((proposal) => proposal.baseRoutineRevision))
    const workoutIds = new Set(active.map((proposal) => proposal.workoutId))
    const requestIds = new Set(active.map((proposal) => proposal.requestId))
    const contextKeys = new Set(active.map((proposal) => proposal.contextKey))
    if (routineIds.size !== 1 || revisions.size !== 1) throw new Error('Las propuestas no pertenecen a una misma rutina y revisión')
    if (workoutIds.size !== 1 || requestIds.size !== 1 || contextKeys.size !== 1 || !active[0].workoutId || !active[0].requestId || !active[0].contextKey) {
      await db.adaptationProposals.bulkPut(active.map((proposal) => ({ ...proposal, status: 'stale' as const })))
      return { status: 'stale', routineId: active[0].baseRoutineId, appliedProposalIds: [] }
    }
    const routineId = active[0].baseRoutineId
    const current = await readCurrentAdaptationContext(active[0].workoutId)
    if (!current || !current.routine || !isRoutineContextCurrent(current.workout, current.routine) || current.context.contextKey !== active[0].contextKey || current.workout.routineId !== routineId || current.workout.routineRevision !== active[0].baseRoutineRevision) {
      await db.adaptationProposals.bulkPut(active.map((proposal) => ({ ...proposal, status: 'stale' as const })))
      return { status: 'stale', routineId, appliedProposalIds: [] }
    }
    const routine = current.routine!
    const normalized = normalizeRoutine(routine)
    const choices = new Map(decisions.map((decision) => [decision.proposalId, decision]))
    const accepted = active.filter((proposal) => choices.get(proposal.id)?.decision === 'accept')
    if (accepted.some((proposal) => {
      const selected = choices.get(proposal.id)
      return selected?.candidateId === undefined || !proposal.candidateOptions.some((candidate) => candidate.candidateId === selected.candidateId)
    })) throw new Error('El candidato seleccionado no coincide con la propuesta cerrada')
    const mismatched = accepted.some((proposal) => {
      const exercise = normalized.exercises.find((item) => proposal.occurrenceId === undefined ? item.exerciseId === proposal.exerciseId : item.occurrenceId === proposal.occurrenceId)
      const selection = choices.get(proposal.id)?.candidateId
      const candidate = proposal.candidateOptions.find((item) => item.candidateId === selection)
      return !exercise || !candidate || (candidate.occurrenceId !== undefined && candidate.occurrenceId !== exercise.occurrenceId) || !matchesCandidate(exercise, candidate)
    })
    if (mismatched) {
      await db.adaptationProposals.bulkPut(active.map((proposal) => ({ ...proposal, status: 'stale' as const })))
      return { status: 'stale', routineId, appliedProposalIds: [] }
    }
    const exercises = normalized.exercises.map((exercise) => {
      const proposal = accepted.find((item) => item.occurrenceId === undefined ? item.exerciseId === exercise.exerciseId : item.occurrenceId === exercise.occurrenceId)
      const selected = proposal ? proposal.candidateOptions.find((candidate) => candidate.candidateId === choices.get(proposal.id)?.candidateId) : undefined
      return proposal && selected && selected.kind !== 'maintain' ? applyCandidate(exercise, selected) : exercise
    })
    const changed = JSON.stringify(exercises) !== JSON.stringify(normalized.exercises)
    const nextRevision = changed ? normalized.revision + 1 : normalized.revision
    let snapshotId: string | undefined
    if (changed) {
      snapshotId = `${normalized.id}:revision:${normalized.revision}`
      const snapshot: RoutineRevisionSnapshot = { id: snapshotId, routineId: normalized.id, revision: normalized.revision, createdAt: Date.now(), analysisId, routine: normalized }
      await db.routineRevisionSnapshots.put(snapshot)
      await db.routines.put({ ...normalized, exercises, revision: nextRevision })
    }
    await db.adaptationProposals.bulkPut(active.map((proposal) => {
      const acceptedDecision = choices.get(proposal.id)?.decision === 'accept'
      return {
        ...proposal,
        status: acceptedDecision ? 'accepted' as const : 'rejected' as const,
        ...(acceptedDecision && snapshotId ? { appliedRoutineRevision: nextRevision, routineSnapshotId: snapshotId } : {}),
      }
    }))
    return { status: 'applied', routineId, routineRevision: nextRevision, appliedProposalIds: accepted.map((proposal) => proposal.id) }
  })
}

export async function revertAdaptationAnalysis(analysisId: string): Promise<number> {
  return db.transaction('rw', [db.routines, db.adaptationProposals, db.routineRevisionSnapshots], async () => {
    const ownerId = getCoachAccountId()
    if (!ownerId) throw new Error('Se requiere una cuenta para revertir una adaptación')
    const proposals = await db.adaptationProposals.where('analysisId').equals(analysisId).filter((proposal) => proposal.ownerId === ownerId).toArray()
    const applied = proposals.filter((proposal) => proposal.status === 'accepted' && proposal.appliedRoutineRevision !== undefined)
    if (!applied.length) throw new Error('No hay un lote aplicado que revertir')
    const routineId = applied[0].baseRoutineId
    const routine = await db.routines.get(routineId)
    const appliedRevision = applied[0].appliedRoutineRevision
    if (!routine || applied.some((proposal) => proposal.baseRoutineId !== routineId || proposal.appliedRoutineRevision !== appliedRevision) || (routine.revision ?? 1) !== appliedRevision) {
      throw new Error('La rutina cambió después de aplicar este lote; no se puede revertir')
    }
    const snapshot = await db.routineRevisionSnapshots.get(applied[0].routineSnapshotId ?? `${routineId}:revision:${applied[0].baseRoutineRevision}`)
    if (!snapshot) throw new Error('No existe el snapshot completo de la rutina para revertir')
    const nextRevision = (routine.revision ?? 1) + 1
    await db.routines.put({ ...snapshot.routine, revision: nextRevision })
    await db.adaptationProposals.bulkPut(applied.map((proposal) => ({ ...proposal, status: 'reverted' as const })))
    return nextRevision
  })
}

export async function createEditedProposal(proposalId: string, candidateId: string): Promise<AdaptationProposal> {
  return db.transaction('rw', db.adaptationProposals, async () => {
    const ownerId = getCoachAccountId()
    if (!ownerId) throw new Error('Se requiere una cuenta para editar una adaptación')
    const original = await db.adaptationProposals.get(proposalId)
    if (!original || original.ownerId !== ownerId || original.status !== 'pending') throw new Error('Solo se puede editar una propuesta pendiente de tu cuenta')
    const candidate = original.candidateOptions.find((option) => option.candidateId === candidateId)
    if (!candidate) throw new Error('El candidato no pertenece a esta propuesta')
    const edited: AdaptationProposal = {
      ...original,
      id: `${original.id}-r${original.proposalRevision + 1}`,
      candidateId: candidate.candidateId,
      candidate,
      status: 'pending',
      createdAt: Date.now(),
      proposalRevision: original.proposalRevision + 1,
      supersedesProposalId: original.id,
      // Estos campos históricos se mantienen por compatibilidad con backups,
      // pero siempre se derivan del mismo candidato que se va a confirmar.
      previousValues: candidate.previous,
      proposedValues: candidate.next,
      rule: candidate.rule,
      confidence: candidate.confidence,
      citations: candidate.citations ?? [],
      warnings: candidate.warnings,
    }
    await db.adaptationProposals.put({ ...original, status: 'edited' })
    await db.adaptationProposals.put(edited)
    return edited
  })
}
