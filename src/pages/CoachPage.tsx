import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import { db } from '../db/db'
import type { CoachRunRecord } from '../db/types'
import { getCoachAccountId } from '../lib/coachAccount'
import { getCoachConsent } from '../lib/coachConsent'
import { applyCoachChangeSet, cancelCoachRun, refreshCoachRun, retryCoachRun, startCoachRun } from '../lib/coachClient'
import type { FutureSession } from '../../packages/adaptation-core/src/contract'

const runLabels: Record<CoachRunRecord['status'], string> = { queued: 'En espera', running: 'Analizando', completed: 'Listo', failed: 'No se pudo completar', cancelled: 'Cancelado' }
function runError(error: string): string {
  if (error === 'unknown-outcome' || error === 'uncertain-outcome') return 'Se perdió la respuesta del proveedor. No se ha aplicado ningún cambio.'
  if (error.includes('deadline') || error.includes('timeout')) return 'El proveedor tardó demasiado en responder. Puedes volver a intentarlo más tarde.'
  if (error.includes('budget') || error.includes('Presupuesto')) return 'Se alcanzó el límite de consultas del coach. No se ha aplicado ningún cambio.'
  if (error.startsWith('[') || error.includes('invalid')) return 'El coach devolvió una respuesta que no pudimos validar. No se ha aplicado ningún cambio.'
  return error
}

function planDiffs(run: CoachRunRecord): string[] {
  if (run.decision?.kind !== 'propose' || !run.decision.changeSet.futurePlan) return []
  const before = new Map(((run.request.context.snapshot?.plan ?? []) as FutureSession[]).map((session) => [session.sessionId, session]))
  const after = new Map(run.decision.changeSet.futurePlan.sessions.map((session) => [session.sessionId, session]))
  const lines: string[] = []
  for (const session of after.values()) {
    const previous = before.get(session.sessionId)
    if (!previous) { lines.push(`Añadir sesión: ${session.name}`); continue }
    if (previous.name !== session.name || previous.scheduledAt !== session.scheduledAt) lines.push(`Actualizar programación o nombre: ${previous.name} → ${session.name}`)
    const previousExercises = new Map(previous.exercises.map((exercise) => [exercise.occurrenceId, exercise]))
    const nextExercises = new Map(session.exercises.map((exercise) => [exercise.occurrenceId, exercise]))
    for (const exercise of session.exercises) {
      const old = previousExercises.get(exercise.occurrenceId)
      if (!old) lines.push(`${session.name}: añadir ejercicio ${exercise.exerciseId}`)
      else if (JSON.stringify(old) !== JSON.stringify(exercise)) lines.push(`${session.name}: actualizar ${old.exerciseId} (${exercise.plannedSets} series)`)
    }
    for (const exercise of previous.exercises) if (!nextExercises.has(exercise.occurrenceId)) lines.push(`${session.name}: retirar ejercicio ${exercise.exerciseId}`)
  }
  for (const session of before.values()) if (!after.has(session.sessionId)) lines.push(`Retirar sesión: ${session.name}`)
  return lines
}

export default function CoachPage() {
  const { getToken, isSignedIn } = useAuth()
  const ownerId = getCoachAccountId()
  const consent = ownerId ? getCoachConsent(ownerId) : null
  const [runs, setRuns] = useState<CoachRunRecord[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [selection, setSelected] = useState<CoachRunRecord | undefined>()
  const selected = selection?.ownerId === ownerId ? selection : undefined

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const next = ownerId ? await db.coachRuns.where('ownerId').equals(ownerId).reverse().sortBy('updatedAt') : []
      if (mounted) setRuns(next)
    }
    void load()
    const timer = window.setInterval(() => void load(), 2_000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [ownerId])

  useEffect(() => {
    const active = runs?.find((run) => run.status === 'queued' || run.status === 'running')
    if (!active) return
    void refreshCoachRun(getToken, active.id)
    const timer = window.setInterval(() => void refreshCoachRun(getToken, active.id), 2_000)
    return () => window.clearInterval(timer)
  }, [getToken, runs])

  useEffect(() => {
    if (!selected && runs?.[0]?.ownerId === ownerId) setSelected(runs[0])
    if (selected) setSelected(runs?.find((run) => run.id === selected.id) ?? selected)
  }, [runs, selected, ownerId])

  const send = async () => {
    if (!message.trim() || busy) return
    setBusy(true)
    setActionError(undefined)
    try {
      const causedByEventId = selected?.decision?.kind === 'ask' ? selected.eventId : undefined
      const next = await startCoachRun(getToken, message, { causedByEventId })
      setRuns((current) => [next, ...current.filter((run) => run.id !== next.id)])
      setSelected(next)
      setMessage('')
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'No se pudo enviar el mensaje. Inténtalo de nuevo.') } finally { setBusy(false) }
  }

  const apply = async () => {
    if (!selected || applying) return
    setApplying(true)
    setActionError(undefined)
    try { await applyCoachChangeSet(selected.id); setSelected(await db.coachRuns.get(selected.id)) } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'No se pudo aplicar la propuesta.') } finally { setApplying(false) }
  }

  const cancel = async () => {
    if (!selected) return
    await cancelCoachRun(getToken, selected.id)
    const next = await db.coachRuns.get(selected.id)
    if (next) {
      setRuns((current) => current.map((run) => run.id === next.id ? next : run))
      setSelected(next)
    }
  }

  const retry = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const next = await retryCoachRun(getToken, selected.id)
      setRuns((current) => [next, ...current.filter((run) => run.id !== next.id)])
      setSelected(next)
    } finally { setBusy(false) }
  }

  if (!isSignedIn) return <section className="px-4 pt-6"><h1 className="text-2xl font-extrabold">Coach</h1><p className="mt-3 text-sm text-muted">Inicia sesión para usar el coach privado.</p></section>
  if (!consent) return <section className="px-4 pt-6"><h1 className="text-2xl font-extrabold">Coach privado</h1><p className="mt-3 text-sm text-muted">Activa el consentimiento desde tu perfil para enviar contexto al coach.</p><Link className="btn btn-primary mt-4 w-full" to="/perfil">Ir a Perfil</Link></section>

  const decision = selected?.decision
  return (
    <div className="px-4 pb-8 pt-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-extrabold">Coach privado</h1><span className="text-xs text-muted">DeepSeek Flash</span></div>
      <p className="mt-2 text-sm text-muted">Revisa tu entrenamiento y pregunta al coach. Tú confirmas cada cambio antes de aplicarlo.</p>
      {actionError && <p role="alert" className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">{actionError}</p>}
      <div className="card mt-4 p-3">
        <label className="sr-only" htmlFor="coach-message">Mensaje para el coach</label>
        <textarea id="coach-message" className="min-h-24 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="¿Qué quieres revisar de tu próximo entrenamiento?" />
        {selected?.decision?.kind === 'ask' && <p className="mt-2 text-xs text-muted">Tu respuesta continuará la ejecución que pidió más contexto.</p>}
        <button className="btn btn-primary mt-2 w-full" type="button" disabled={busy || !message.trim()} onClick={() => void send()}>{busy ? 'Enviando…' : selected?.decision?.kind === 'ask' ? 'Continuar conversación' : 'Enviar al coach'}</button>
      </div>

      {selected && (
        <section className="card mt-4 p-4" aria-live="polite">
          <div className="flex items-center justify-between"><h2 className="font-bold">Respuesta del coach</h2><span className="text-xs text-muted">{runLabels[selected.status]}</span></div>
          {selected.status === 'queued' || selected.status === 'running' ? <p className="mt-3 text-sm text-muted">El coach está procesando tu contexto. Puede tardar unos minutos…</p> : selected.error && <p className="mt-3 text-sm text-danger">{runError(selected.error)}</p>}
          {selected.error === 'unknown-outcome' && <button className="btn btn-surface mt-3 w-full" type="button" disabled={busy} onClick={() => void retry()}>Solicitar un nuevo intento</button>}
          {decision && <>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{decision.explanation}</p>
            {decision.kind === 'ask' && <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm"><p className="font-semibold">Necesito saber:</p><ul className="mt-2 list-disc pl-5">{decision.questions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
            {decision.kind === 'propose' && <>
              <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm"><p className="font-semibold">Cambios propuestos</p><ul className="mt-2 list-disc space-y-1 pl-5">{decision.changeSet.operations.map((operation) => <li key={operation.operationId}>{operation.kind === 'routine' ? `Actualizar rutina ${operation.routineId}` : operation.kind === 'exercise-substitution' ? `Sustituir en ${operation.routineId}` : operation.kind === 'routine-create' ? `Añadir rutina ${operation.name}` : operation.kind === 'routine-retire' ? `Retirar rutina ${operation.routineId}` : 'Objetivos nutricionales'}</li>)}</ul></div>
              {planDiffs(selected).length > 0 && <div className="mt-3 rounded-xl border border-border p-3 text-sm"><p className="font-semibold">Diferencias reales de sesiones</p><ul className="mt-2 list-disc space-y-1 pl-5">{planDiffs(selected).map((line) => <li key={line}>{line}</li>)}</ul></div>}
              {decision.evidence.length > 0 && <div className="mt-3 text-xs text-muted"><p className="font-semibold text-text">Evidencia</p>{decision.evidence.map((item) => <p className="mt-1" key={`${item.sourceId}:${item.location}`}>{item.sourceId} · {item.location}</p>)}</div>}
              <button className="btn btn-primary mt-4 w-full" type="button" disabled={applying || !!selected.appliedAt} onClick={() => void apply()}>{selected.appliedAt ? 'Aplicado' : applying ? 'Aplicando…' : 'Confirmar y aplicar'}</button>
            </>}
            {(decision.kind === 'abstain' || decision.kind === 'unavailable') && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-xs text-muted">{decision.reason}</p>}
          </>}
          <div className="mt-3 flex gap-2"><button className="btn btn-surface flex-1" type="button" onClick={() => void cancel()} disabled={selected.status === 'completed' || selected.status === 'failed' || selected.status === 'cancelled'}>Cancelar</button></div>
        </section>
      )}
      {runs && runs.length > 1 && <div className="mt-5"><h2 className="text-sm font-bold">Conversaciones recientes</h2><div className="mt-2 flex flex-col gap-2">{runs.filter((run) => run.ownerId === ownerId).slice(0, 8).map((run) => <button className="card flex items-center justify-between px-3 py-3 text-left text-sm" key={run.id} type="button" onClick={() => setSelected(run)}><span className="truncate">{String(run.request.event.payload?.message ?? 'Ejecución del coach')}</span><span className="ml-2 text-xs text-muted">{runLabels[run.status]}</span></button>)}</div></div>}
    </div>
  )
}
