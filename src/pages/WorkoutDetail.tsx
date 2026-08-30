import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { LoggedSet, PRKind, Workout } from '../db/types'
import type { AdaptationProposal } from '../db/types'
import { useCatalog } from '../data/exercises'
import { useActive } from '../stores/activeWorkout'
import { useSettings } from '../stores/settings'
import { toastUndo } from '../stores/toasts'
import {
  formatDay,
  formatDuration,
  formatTime,
  formatVolume,
  formatWeight,
  kgToDisplay,
} from '../lib/format'
import { fireConfetti } from '../lib/confetti'
import { applyAdaptationDecisions, createEditedProposal, revertAdaptationAnalysis, type ProposalDecision } from '../lib/adaptation'
import { enqueueAdaptationEvent, retryFailedAdaptationJob } from '../lib/adaptationClient'
import { ExerciseThumb } from '../components/ExerciseThumb'
import { ActionSheet, Confirm } from '../components/Sheet'
import {
  IconChevronLeft,
  IconDots,
  IconDumbbell,
  IconPencil,
  IconRepeat,
  IconTimer,
  IconTrash,
  IconTrophy,
} from '../components/icons'

const PR_LABEL: Record<PRKind, string> = {
  weight: 'Peso máximo',
  e1rm: '1RM estimado',
  setVolume: 'Volumen en una serie',
}

const SUPERSET_COLORS = ['#3d8bfd', '#a78bfa', '#f2a33c', '#33c076']

function setLine(s: LoggedSet, units: 'kg' | 'lb'): string {
  if (s.durationSec || s.distanceM) {
    const parts = []
    if (s.durationSec) parts.push(`${Math.round(s.durationSec / 60)} min`)
    if (s.distanceM) parts.push(`${(s.distanceM / 1000).toFixed(2)} km`)
    return parts.join(' · ')
  }
  return `${kgToDisplay(s.weightKg, units)} ${units} × ${s.reps}`
}

export default function WorkoutDetail() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const celebrate = params.get('nuevo') === '1'
  const navigate = useNavigate()
  const workout = useLiveQuery(
    () => db.workouts.get(id!).then((w) => w ?? null),
    [id],
    undefined as Workout | null | undefined,
  )
  const { byId } = useCatalog()
  const session = useActive((s) => s.session)
  const units = useSettings((s) => s.units)
  const { isSignedIn } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'edit' | 'repeat' | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const adaptation = useLiveQuery(async () => {
    if (!id) return null
    const job = await db.adaptationJobs.where('workoutId').equals(id).first()
    if (!job?.analysisId) return { job, proposals: [] as AdaptationProposal[] }
    return { job, proposals: await db.adaptationProposals.where('analysisId').equals(job.analysisId).toArray() }
  }, [id], null)
  const [proposalDecisions, setProposalDecisions] = useState<Record<string, ProposalDecision['decision']>>({})

  const hasPRs = !!workout && workout.prs.length > 0
  useEffect(() => {
    if (celebrate && hasPRs) fireConfetti()
  }, [celebrate, hasPRs])

  if (workout === undefined) return null
  if (workout === null)
    return (
      <div className="px-4 pt-10 text-center text-muted">
        Entreno no encontrado.
        <button className="btn btn-surface mx-auto mt-4" onClick={() => navigate('/historial')}>
          Volver al historial
        </button>
      </div>
    )

  const startEdit = async () => {
    await useActive.getState().startEditing(workout)
    navigate('/entreno')
  }
  const startRepeat = async () => {
    await useActive.getState().repeatWorkout(workout)
    navigate('/entreno')
  }
  const runAction = (action: 'edit' | 'repeat') => {
    if (session) setConfirmAction(action)
    else void (action === 'edit' ? startEdit() : startRepeat())
  }

  const deleteWorkout = () => {
    const snapshot = workout
    void db.workouts.delete(workout.id).then(() => {
      navigate('/historial', { replace: true })
      toastUndo('Entreno eliminado', () => void db.workouts.put(snapshot))
    })
  }

  const prValue = (kind: PRKind, value: number) =>
    kind === 'setVolume' ? formatVolume(value, units) : formatWeight(value, units)

  const pendingProposals = adaptation?.proposals.filter((proposal) => proposal.status === 'pending') ?? []
  const allDecided = pendingProposals.length > 0 && pendingProposals.every((proposal) => proposalDecisions[proposal.id])
  const applyProposals = async () => {
    const analysisId = adaptation?.job?.analysisId
    if (!analysisId || !allDecided) return
    const decisions = pendingProposals.map((proposal) => ({ proposalId: proposal.id, decision: proposalDecisions[proposal.id] === 'accept' ? 'accept' as const : 'reject' as const, candidateId: proposal.candidateId }))
    await applyAdaptationDecisions(analysisId, decisions)
    void Promise.all(decisions.map((decision) => enqueueAdaptationEvent({ analysisId, exerciseId: pendingProposals.find((proposal) => proposal.id === decision.proposalId)?.exerciseId ?? 'unknown', candidateId: decision.candidateId, event: decision.decision === 'accept' ? 'accepted' : 'rejected' })))
    setProposalDecisions({})
  }

  return (
    <div className="px-4 pt-4">
      <header className="flex items-center justify-between pb-3">
        <button
          className="pressable -ml-2 rounded-lg p-1.5 text-muted"
          onClick={() => navigate(-1)}
          aria-label="Volver"
        >
          <IconChevronLeft size={22} />
        </button>
        <button
          className="pressable rounded-lg p-1.5 text-muted"
          onClick={() => setMenuOpen(true)}
          aria-label="Opciones"
        >
          <IconDots size={20} />
        </button>
      </header>

      {celebrate && (
        <div className="mb-4 rounded-2xl border border-primary/40 bg-primary/15 px-4 py-3">
          <div className="font-bold text-primary">¡Entreno completado! 💪</div>
          {workout.prs.length > 0 && (
            <div className="pt-0.5 text-sm text-primary/90">
              Conseguiste {workout.prs.length} récord{workout.prs.length > 1 ? 's' : ''} personal
              {workout.prs.length > 1 ? 'es' : ''}.
            </div>
          )}
        </div>
      )}

      <h1 className="text-2xl font-extrabold">{workout.name}</h1>
      <p className="pt-1 text-sm text-muted">
        {formatDay(workout.startedAt)} · {formatTime(workout.startedAt)}
      </p>
      {workout.notes && <p className="pt-2 text-sm italic text-muted">“{workout.notes}”</p>}

      {isSignedIn && adaptation?.job && (
        <div className="card mt-4 px-4 py-3">
          <div className="font-bold">Coach adaptativo</div>
          {adaptation.job.status === 'pending' || adaptation.job.status === 'processing' ? <p className="pt-1 text-sm text-muted">Análisis pendiente; se procesará al recuperar conexión.</p> : null}
          {adaptation.job.status === 'failed' ? <><p className="pt-1 text-sm text-danger">No se pudo completar el análisis.</p><button className="btn btn-surface mt-2 w-full" onClick={() => void retryFailedAdaptationJob(adaptation.job!.id)}>Reintentar análisis</button></> : null}
          {adaptation.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} decision={proposalDecisions[proposal.id]} onDecision={(decision) => setProposalDecisions((current) => ({ ...current, [proposal.id]: decision }))} onEdit={(candidateId) => void createEditedProposal(proposal.id, candidateId).then(() => enqueueAdaptationEvent({ analysisId: proposal.analysisId, exerciseId: proposal.exerciseId, candidateId, event: 'edited' }))} />)}
          {allDecided && <button className="btn btn-primary mt-3 w-full" onClick={() => setConfirmApply(true)}>Aplicar decisiones</button>}
          {adaptation.proposals.some((proposal) => proposal.status === 'accepted' && proposal.appliedRoutineRevision !== undefined) && adaptation.job.analysisId && <button className="btn btn-surface mt-2 w-full" onClick={() => void revertAdaptationAnalysis(adaptation.job!.analysisId!).then(() => void enqueueAdaptationEvent({ analysisId: adaptation.job!.analysisId!, exerciseId: 'batch', event: 'reverted' }))}>Revertir lote aplicado</button>}
          <p className="pt-3 text-[11px] text-muted">Los candidatos son cambios cerrados. Editar crea una nueva revisión y conserva la propuesta original.</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 pt-4">
        <Stat
          icon={<IconTimer size={15} />}
          label="Duración"
          value={formatDuration((workout.endedAt - workout.startedAt) / 1000)}
        />
        <Stat
          icon={<IconDumbbell size={15} />}
          label="Volumen"
          value={formatVolume(workout.volumeKg, units)}
        />
        <Stat icon={<IconTrophy size={15} />} label="Series" value={String(workout.totalSets)} />
      </div>

      {workout.prs.length > 0 && (
        <div className="card mt-4 px-4 py-3">
          <div className="flex items-center gap-2 pb-2 font-bold text-warning">
            <IconTrophy size={17} />
            Récords personales
          </div>
          <div className="flex flex-col gap-1.5">
            {workout.prs.map((pr, i) => (
              <div key={i} className="text-sm">
                <span className="font-semibold">
                  {byId.get(pr.exerciseId)?.name ?? 'Ejercicio'}
                </span>{' '}
                <span className="text-muted">
                  — {PR_LABEL[pr.kind]}: {prValue(pr.kind, pr.value)}
                  {pr.prev ? ` (antes ${prValue(pr.kind, pr.prev)})` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 pt-4">
        {workout.exercises.map((ex, i) => {
          const info = byId.get(ex.exerciseId)
          let setNumber = 0
          const ssColor =
            ex.supersetGroup !== undefined
              ? SUPERSET_COLORS[ex.supersetGroup % SUPERSET_COLORS.length]
              : null
          return (
            <div
              key={`${ex.exerciseId}-${i}`}
              className="card px-4 py-3"
              style={ssColor ? { borderLeft: `3px solid ${ssColor}` } : undefined}
            >
              {ssColor && (
                <div
                  className="pb-1 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: ssColor }}
                >
                  Superserie {String.fromCharCode(65 + (ex.supersetGroup! % 26))}
                </div>
              )}
              <Link to={`/ejercicios/${ex.exerciseId}`} className="flex items-center gap-3">
                <ExerciseThumb exercise={info} size={42} />
                <div className="min-w-0 flex-1 text-sm font-bold text-primary">
                  {info?.name ?? 'Ejercicio eliminado'}
                </div>
              </Link>
              {ex.notes && <p className="pt-2 text-sm italic text-muted">“{ex.notes}”</p>}
              <div className="flex flex-col gap-1 pt-2">
                {ex.sets.map((s, j) => {
                  if (s.type !== 'warmup') setNumber++
                  return (
                    <div key={j} className="flex items-center gap-3 text-sm">
                      <span
                        className={`w-6 text-center font-bold ${
                          s.type === 'warmup'
                            ? 'text-warning'
                            : s.type === 'failure'
                              ? 'text-danger'
                              : s.type === 'drop'
                                ? 'text-purple-400'
                                : 'text-muted'
                        }`}
                      >
                        {s.type === 'warmup'
                          ? 'W'
                          : s.type === 'failure'
                            ? 'F'
                            : s.type === 'drop'
                              ? 'D'
                              : setNumber}
                      </span>
                      <span className="font-semibold tabular-nums">{setLine(s, units)}</span>
                      {s.rpe && <span className="text-xs text-warning">RPE {s.rpe}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={workout.name}
        actions={[
          {
            label: 'Repetir entreno',
            icon: <IconRepeat size={18} />,
            onClick: () => runAction('repeat'),
          },
          {
            label: 'Editar entreno',
            icon: <IconPencil size={18} />,
            onClick: () => runAction('edit'),
          },
          {
            label: 'Eliminar entreno',
            icon: <IconTrash size={18} />,
            danger: true,
            onClick: () => setConfirmDelete(true),
          },
        ]}
      />

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="¿Eliminar este entreno?"
        message="Se borrará del historial y de las estadísticas."
        confirmLabel="Eliminar"
        danger
        onConfirm={deleteWorkout}
      />

      <Confirm
        open={confirmApply}
        onClose={() => setConfirmApply(false)}
        title="¿Aplicar estas propuestas?"
        message="Se actualizará la rutina con los cambios que aceptaste. Esta acción quedará registrada y podrá revertirse desde este entreno."
        confirmLabel="Aplicar lote"
        onConfirm={() => { setConfirmApply(false); void applyProposals() }}
      />

      <Confirm
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title="Entreno en curso"
        message="Tienes un entreno en curso que se descartará para continuar."
        confirmLabel="Descartar y continuar"
        danger
        onConfirm={() => {
          const action = confirmAction
          useActive.getState().discard()
          void (action === 'edit' ? startEdit() : startRepeat())
        }}
      />
    </div>
  )
}

function ProposalCard({ proposal, decision, onDecision, onEdit }: { proposal: AdaptationProposal; decision?: ProposalDecision['decision']; onDecision: (decision: ProposalDecision['decision']) => void; onEdit: (candidateId: string) => void }) {
  return <div className="mt-3 border-t border-border pt-3 text-sm">
    <div className="flex items-center justify-between gap-2"><span className="font-semibold">{proposal.exerciseId}</span><span className="text-xs text-muted">{proposal.confidence ?? proposal.candidate.confidence} · {proposal.selectedModel ?? 'deterministic'}</span></div>
    <p className="pt-1 text-xs text-muted">{proposal.previousValues?.loadKg ?? proposal.candidate.previous.loadKg ?? '—'} kg / {proposal.previousValues?.plannedSets ?? proposal.candidate.previous.plannedSets} series → {proposal.proposedValues?.loadKg ?? proposal.candidate.next.loadKg ?? '—'} kg / {proposal.proposedValues?.plannedSets ?? proposal.candidate.next.plannedSets} series</p>
    <p className="pt-1 text-muted">{proposal.candidate.explanation}</p>
    {proposal.candidate.warnings.length > 0 && <p className="pt-1 text-xs text-warning">{proposal.candidate.warnings.join(' · ')}</p>}
    {(proposal.citations?.length ?? 0) > 0 && <p className="pt-1 text-xs text-primary">Citas: {proposal.citations!.join(' · ')}</p>}
    <div className="flex gap-2 pt-2"><button className={`btn flex-1 py-2 ${decision === 'accept' ? 'bg-success/20 text-success' : 'btn-surface'}`} onClick={() => onDecision('accept')}>Aceptar</button><button className={`btn flex-1 py-2 ${decision === 'reject' ? 'bg-danger/20 text-danger' : 'btn-surface'}`} onClick={() => onDecision('reject')}>Rechazar</button></div>
    {proposal.candidateOptions.length > 1 && <div className="flex flex-wrap gap-1 pt-2">{proposal.candidateOptions.map((candidate) => <button key={candidate.candidateId} className="chip" onClick={() => onEdit(candidate.candidateId)}>{candidate.kind}</button>)}</div>}
  </div>
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card px-2 py-2.5 text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
        {icon}
        {label}
      </div>
      <div className="pt-1 text-sm font-bold tabular-nums">{value}</div>
    </div>
  )
}
