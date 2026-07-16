import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { PRKind, Workout } from '../db/types'
import { useCatalog } from '../data/exercises'
import { useActive } from '../stores/activeWorkout'
import { useSettings } from '../stores/settings'
import {
  formatDay,
  formatDuration,
  formatTime,
  formatVolume,
  formatWeight,
  kgToDisplay,
} from '../lib/format'
import { ExerciseThumb } from '../components/ExerciseThumb'
import { ActionSheet, Confirm } from '../components/Sheet'
import {
  IconChevronLeft,
  IconDots,
  IconDumbbell,
  IconPencil,
  IconTimer,
  IconTrash,
  IconTrophy,
} from '../components/icons'

const PR_LABEL: Record<PRKind, string> = {
  weight: 'Peso máximo',
  e1rm: '1RM estimado',
  setVolume: 'Volumen en una serie',
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmEdit, setConfirmEdit] = useState(false)

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

  const prValue = (kind: PRKind, value: number) =>
    kind === 'setVolume' ? formatVolume(value, units) : formatWeight(value, units)

  return (
    <div className="px-4 pt-4">
      <header className="flex items-center justify-between pb-3">
        <button
          className="-ml-2 rounded-lg p-1.5 text-muted active:bg-surface-2"
          onClick={() => navigate(-1)}
          aria-label="Volver"
        >
          <IconChevronLeft size={22} />
        </button>
        <button
          className="rounded-lg p-1.5 text-muted active:bg-surface-2"
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
          return (
            <div key={`${ex.exerciseId}-${i}`} className="card px-4 py-3">
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
                      <span className="font-semibold">
                        {kgToDisplay(s.weightKg, units)} {units} × {s.reps}
                      </span>
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
            label: 'Editar entreno',
            icon: <IconPencil size={18} />,
            onClick: () => (session ? setConfirmEdit(true) : void startEdit()),
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
        message="Se borrará del historial y de las estadísticas. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        danger
        onConfirm={() => {
          void db.workouts.delete(workout.id).then(() => navigate('/historial', { replace: true }))
        }}
      />

      <Confirm
        open={confirmEdit}
        onClose={() => setConfirmEdit(false)}
        title="Entreno en curso"
        message="Tienes un entreno en curso. Para editar este, el entreno en curso se descartará."
        confirmLabel="Descartar y editar"
        danger
        onConfirm={() => {
          useActive.getState().discard()
          void startEdit()
        }}
      />
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card px-2 py-2.5 text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
        {icon}
        {label}
      </div>
      <div className="pt-1 text-sm font-bold">{value}</div>
    </div>
  )
}
