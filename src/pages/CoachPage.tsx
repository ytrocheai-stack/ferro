import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import { db } from '../db/db'
import type { CoachRunRecord } from '../db/types'
import { getCoachAccountId } from '../lib/coachAccount'
import { getCoachConsent } from '../lib/coachConsent'
import { applyCoachChangeSet, cancelCoachRun, isRetryableCoachError, refreshCoachRun, retryCoachRun, startCoachRun } from '../lib/coachClient'
import type { FutureSession } from '../../packages/adaptation-core/src/contract'
import { useCatalog } from '../data/exercises'
import { useLiveQuery } from 'dexie-react-hooks'
import { PageHeader } from '../components/PageHeader'
import { useBottomDock } from '../components/BottomDock'

const runLabels: Record<CoachRunRecord['status'], string> = { queued: 'En espera', running: 'Analizando', completed: 'Listo', failed: 'No se pudo completar', cancelled: 'Cancelado' }
function runLabel(run: CoachRunRecord): string { return run.status === 'queued' && run.id.startsWith('coach-local-') ? 'En espera local' : runLabels[run.status] }
function runError(error: string): string {
  if (error === 'unknown-outcome' || error === 'uncertain-outcome') return 'Se perdió la respuesta del proveedor. No se ha aplicado ningún cambio.'
  if (error.includes('deadline') || error.includes('timeout')) return 'El proveedor tardó demasiado en responder. No se ha aplicado ningún cambio; puedes solicitar un nuevo intento.'
  if (error.includes('budget') || error.includes('Presupuesto')) return 'Se alcanzó el límite de consultas del coach. No se ha aplicado ningún cambio.'
  if (error === 'provider-rate-limited') return 'El proveedor limitó temporalmente la consulta. No se ha aplicado ningún cambio; puedes solicitar un nuevo intento.'
  if (error === 'provider-server-error' || error === 'server-error') return 'El proveedor tuvo un error temporal. No se ha aplicado ningún cambio; puedes solicitar un nuevo intento.'
  if (error === 'workflow-create-failed' || error === 'workflow-not-configured') return 'El servicio del coach no pudo iniciar la ejecución. No se ha aplicado ningún cambio.'
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
  const consent = Boolean(ownerId && getCoachConsent(ownerId))
  const [runs, setRuns] = useState<CoachRunRecord[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [selection, setSelected] = useState<CoachRunRecord | undefined>()
  const [recentOpen, setRecentOpen] = useState(false)
  const { setSlot } = useBottomDock()
  const { byId } = useCatalog()
  const routines = useLiveQuery(() => db.routines.toArray(), [], [])
  const selected = selection?.ownerId === ownerId ? selection : undefined
  const activeRunId = runs.find((run) => run.status === 'queued' || run.status === 'running')?.id
  const loadInFlight = useRef(false)
  const refreshInFlight = useRef<string | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (loadInFlight.current) return
      loadInFlight.current = true
      try {
        const next = ownerId ? await db.coachRuns.where('ownerId').equals(ownerId).reverse().sortBy('updatedAt') : []
        if (mounted) setRuns(next)
      } catch (cause) {
        if (mounted) setActionError(cause instanceof Error ? cause.message : 'No se pudieron consultar tus conversaciones del coach.')
      } finally { loadInFlight.current = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 2_000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [ownerId])

  useEffect(() => {
    if (!activeRunId) return
    let mounted = true
    const poll = async () => {
      if (refreshInFlight.current) return
      refreshInFlight.current = activeRunId
      try { await refreshCoachRun(getToken, activeRunId) } catch (cause) {
        if (mounted) setActionError(cause instanceof Error ? cause.message : 'No se pudo consultar el estado del coach.')
      } finally {
        if (refreshInFlight.current === activeRunId) refreshInFlight.current = null
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2_000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [activeRunId, getToken])

  useEffect(() => {
    if (!selected && runs?.[0]?.ownerId === ownerId) setSelected(runs[0])
    if (selected) setSelected(runs?.find((run) => run.id === selected.id) ?? selected)
  }, [runs, selected, ownerId])

  const send = useCallback(async () => {
    if (!message.trim() || busy) return
    setBusy(true)
    setActionError(undefined)
    try {
      const causedByEventId = selected?.decision?.kind === 'ask' ? selected.eventId : undefined
      const next = await startCoachRun(getToken, message, { causedByEventId })
      setRuns((current) => [next, ...current.filter((run) => run.id !== next.id)])
      setSelected(next)
      if (next.status !== 'failed') setMessage('')
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'No se pudo enviar el mensaje. Inténtalo de nuevo.') } finally { setBusy(false) }
  }, [busy, getToken, message, selected])

  const apply = async () => {
    if (!selected || applying) return
    setApplying(true)
    setActionError(undefined)
    try { await applyCoachChangeSet(selected.id); setSelected(await db.coachRuns.get(selected.id)) } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'No se pudo aplicar la propuesta.') } finally { setApplying(false) }
  }

  const cancel = async () => {
    if (!selected || cancelling) return
    setCancelling(true)
    setActionError(undefined)
    try {
      await cancelCoachRun(getToken, selected.id)
      const next = await db.coachRuns.get(selected.id)
      if (next) {
        setRuns((current) => current.map((run) => run.id === next.id ? next : run))
        setSelected(next)
      }
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'No se pudo cancelar la ejecución del coach.') } finally { setCancelling(false) }
  }

  const retry = async () => {
    if (!selected || busy) return
    setBusy(true)
    setActionError(undefined)
    try {
      const next = await retryCoachRun(getToken, selected.id)
      setRuns((current) => [next, ...current.filter((run) => run.id !== next.id)])
      setSelected(next)
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'No se pudo solicitar un nuevo intento.') } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!isSignedIn || !consent) {
      setSlot('coach', null)
      return
    }
    setSlot('coach', <CoachComposer message={message} busy={busy} disabled={Boolean(activeRunId)} followUp={selected?.decision?.kind === 'ask'} onChange={setMessage} onSend={() => void send()} />)
    return () => setSlot('coach', null)
  }, [activeRunId, busy, consent, isSignedIn, message, selected?.decision?.kind, send, setSlot])

  if (!isSignedIn) return <section className="page-content pt-3"><PageHeader title="Coach" /><p className="mt-4 text-base leading-6 text-muted">Inicia sesión para usar el coach privado.</p><Link className="btn btn-primary mt-4 w-full" to="/perfil">Ir a Perfil</Link></section>
  if (!consent) return <section className="page-content pt-3"><PageHeader title="Coach" /><p className="mt-4 text-base leading-6 text-muted">Activa el consentimiento desde Perfil para enviar contexto al coach.</p><Link className="btn btn-primary mt-4 w-full" to="/perfil">Resolver en Perfil</Link></section>

  const decision = selected?.decision
  return (
    <div className="page-content pb-4 pt-3">
      <PageHeader title="Coach" action={<button className="page-header__profile pressable text-xs" onClick={() => setRecentOpen((open) => !open)} aria-label="Conversaciones recientes">{runs.length}</button>} />
      <p className="mt-4 text-base leading-6 text-muted">Revisa tu entrenamiento y pregunta al coach. Tú confirmas cada cambio antes de aplicarlo.</p>
      {actionError && <p role="alert" className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">{actionError}</p>}
      {runs.length === 0 && <section className="mt-5" aria-labelledby="coach-suggestions-title"><h2 id="coach-suggestions-title" className="text-xl font-semibold">¿Qué quieres revisar?</h2><div className="mt-3 grid gap-2">{['Revisar mi último entreno', 'Ajustar mi rutina', 'Resolver una duda'].map((suggestion) => <button key={suggestion} className="btn btn-surface justify-start text-left" onClick={() => setMessage(suggestion)}>{suggestion}</button>)}</div></section>}

      {selected && (
        <section className="card mt-4 p-4" aria-live="polite">
          <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Respuesta del coach</h2><span className="text-sm text-muted">{runLabels[selected.status]}</span></div>
          <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm"><span className="font-semibold">Tu pregunta</span><p className="pt-1 text-muted">{String(selected.request.event.payload?.message ?? '—')}</p></div>
          {selected.status === 'queued' || selected.status === 'running' ? <p className="mt-3 text-sm text-muted">{selected.status === 'queued' && selected.id.startsWith('coach-local-') ? 'Guardado localmente; se enviará cuando haya conexión y sesión disponible.' : 'El coach está procesando tu contexto. Puede tardar unos minutos…'}</p> : selected.error && <p className="mt-3 text-sm text-danger">{runError(selected.error)}</p>}
          {selected.status === 'failed' && isRetryableCoachError(selected.error) && <button className="btn btn-surface mt-3 w-full" type="button" disabled={busy} onClick={() => void retry()}>Solicitar un nuevo intento</button>}
          {decision && <>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{decision.explanation}</p>
            {decision.kind === 'ask' && <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm"><p className="font-semibold">Necesito saber:</p><ul className="mt-2 list-disc pl-5">{decision.questions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
            {decision.kind === 'propose' && <>
              <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm"><p className="font-semibold">Cambios propuestos</p><ul className="mt-2 list-disc space-y-1 pl-5">{decision.changeSet.operations.map((operation) => <li key={operation.operationId}>{operation.kind === 'routine' ? `Actualizar rutina ${routines.find((routine) => routine.id === operation.routineId)?.name ?? operation.routineId}` : operation.kind === 'exercise-substitution' ? `Sustituir ${byId.get(operation.exerciseId)?.name ?? operation.exerciseId} en ${routines.find((routine) => routine.id === operation.routineId)?.name ?? operation.routineId}` : operation.kind === 'routine-create' ? `Añadir rutina ${operation.name}` : operation.kind === 'routine-retire' ? `Retirar rutina ${routines.find((routine) => routine.id === operation.routineId)?.name ?? operation.routineId}` : 'Objetivos nutricionales'}</li>)}</ul></div>
              {planDiffs(selected).length > 0 && <div className="mt-3 rounded-xl border border-border p-3 text-sm"><p className="font-semibold">Diferencias reales de sesiones</p><ul className="mt-2 list-disc space-y-1 pl-5">{planDiffs(selected).map((line) => <li key={line}>{line}</li>)}</ul></div>}
              {decision.evidence.length > 0 && <details className="mt-3 rounded-xl border border-border px-3 py-2 text-xs text-muted"><summary className="cursor-pointer font-semibold text-text">Evidencia</summary>{decision.evidence.map((item) => <p className="mt-2" key={`${item.sourceId}:${item.location}`}>{item.sourceId} · {item.location}</p>)}</details>}
              <button className="btn btn-primary mt-4 w-full" type="button" disabled={applying || !!selected.appliedAt} onClick={() => void apply()}>{selected.appliedAt ? 'Aplicado' : applying ? 'Aplicando…' : 'Confirmar y aplicar'}</button>
            </>}
            {(decision.kind === 'abstain' || decision.kind === 'unavailable') && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-xs text-muted">{decision.reason}</p>}
          </>}
          <div className="mt-3 flex gap-2"><button className="btn btn-surface flex-1" type="button" onClick={() => void cancel()} disabled={cancelling || selected.status === 'completed' || selected.status === 'failed' || selected.status === 'cancelled'}>{cancelling ? 'Cancelando…' : 'Cancelar'}</button></div>
        </section>
      )}
      {recentOpen && runs && runs.length > 0 && <div className="mt-5"><h2 className="text-xl font-semibold">Conversaciones recientes</h2><div className="mt-2 flex flex-col gap-2">{runs.filter((run) => run.ownerId === ownerId).slice(0, 8).map((run) => <button className="card flex items-center justify-between px-3 py-3 text-left text-sm" key={run.id} type="button" onClick={() => { setSelected(run); setRecentOpen(false) }}><span className="line-clamp-2">{String(run.request.event.payload?.message ?? 'Ejecución del coach')}</span><span className="ml-2 shrink-0 text-xs text-muted">{runLabel(run)}</span></button>)}</div></div>}
    </div>
  )
}

function CoachComposer({ message, busy, disabled, followUp, onChange, onSend }: { message: string; busy: boolean; disabled: boolean; followUp: boolean; onChange: (value: string) => void; onSend: () => void }) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(128, Math.max(44, input.scrollHeight))}px`
  }, [message])
  return <div className="dock-card bg-surface px-3 py-2"><label className="sr-only" htmlFor="coach-message">Mensaje para el coach</label><div className="flex items-end gap-2"><textarea ref={inputRef} id="coach-message" rows={1} maxLength={4000} disabled={disabled || busy} className="min-h-11 max-h-32 min-w-0 flex-1 resize-none rounded-[12px] border border-border bg-surface-2 px-3 py-2 text-base leading-6 outline-none focus:border-primary disabled:opacity-60" value={message} onChange={(event) => onChange(event.target.value)} placeholder={disabled ? 'El coach está procesando…' : 'Pregunta al coach…'} /><button className="btn btn-primary min-h-11 shrink-0 px-4 text-sm" type="button" disabled={disabled || busy || !message.trim()} onClick={onSend}>{busy ? 'Enviando…' : followUp ? 'Continuar' : 'Enviar'}</button></div>{followUp && <p className="pt-1 text-xs text-muted">Tu respuesta continuará la ejecución.</p>}</div>
}
