import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import type { SetType } from '../db/types'
import { placeholderFor, useActive, type ActiveExercise } from '../stores/activeWorkout'
import { useSettings } from '../stores/settings'
import { useCatalog } from '../data/exercises'
import { useNow } from '../lib/useNow'
import { useWakeLock } from '../lib/wakeLock'
import { clock, displayToKg, formatDuration, formatVolume, kgToDisplay } from '../lib/format'
import { REST_OPTIONS, restLabel } from '../lib/constants'
import { ExercisePicker } from '../components/ExercisePicker'
import { ExerciseThumb } from '../components/ExerciseThumb'
import { ActionSheet, Confirm, Sheet } from '../components/Sheet'
import {
  IconCheck,
  IconChevronDown,
  IconDots,
  IconDumbbell,
  IconPlus,
  IconTimer,
} from '../components/icons'

const SET_TYPE_META: Record<SetType, { label: string; badge: string; className: string }> = {
  warmup: { label: 'Calentamiento', badge: 'W', className: 'text-warning' },
  normal: { label: 'Normal', badge: '', className: 'text-muted' },
  failure: { label: 'Al fallo', badge: 'F', className: 'text-danger' },
  drop: { label: 'Drop set', badge: 'D', className: 'text-purple-400' },
}

export default function ActiveWorkoutPage() {
  const session = useActive((s) => s.session)
  const keepAwake = useSettings((s) => s.keepAwake)
  useWakeLock(!!session && keepAwake)
  const navigate = useNavigate()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  if (!session) return <Navigate to="/" replace />
  const isEdit = !!session.editingWorkoutId
  const completed = session.exercises.reduce(
    (a, e) => a + e.sets.filter((s) => s.completed).length,
    0,
  )

  const doFinish = async () => {
    const editing = session.editingWorkoutId
    const wid = await useActive.getState().finish()
    if (wid) navigate(`/historial/${wid}${editing ? '' : '?nuevo=1'}`, { replace: true })
  }

  return (
    <div className="px-4">
      <header className="sticky top-0 z-30 -mx-4 flex items-center justify-between gap-2 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur">
        <button
          onClick={() => navigate('/')}
          className="-ml-1.5 rounded-lg p-1.5 text-muted active:bg-surface-2"
          aria-label="Minimizar"
        >
          <IconChevronDown size={22} />
        </button>
        <Elapsed isEdit={isEdit} startedAt={session.startedAt} />
        <button
          className="rounded-xl bg-primary px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
          onClick={() => setFinishOpen(true)}
          disabled={completed === 0}
        >
          {isEdit ? 'Guardar' : 'Finalizar'}
        </button>
      </header>

      <input
        className="w-full bg-transparent pt-3 text-xl font-extrabold outline-none placeholder:text-muted"
        value={session.name}
        onChange={(e) => useActive.getState().setName(e.target.value)}
        placeholder="Nombre del entreno"
      />

      {session.exercises.length === 0 && (
        <div className="card mt-4 flex flex-col items-center gap-2 px-4 py-10 text-center">
          <IconDumbbell size={32} className="text-muted" />
          <p className="font-semibold">Empieza añadiendo un ejercicio</p>
          <p className="text-sm text-muted">Toca «Añadir ejercicios» para buscar en la biblioteca.</p>
        </div>
      )}

      {session.exercises.map((ex, idx) => (
        <ExerciseBlock key={ex.uid} ex={ex} index={idx} count={session.exercises.length} />
      ))}

      <button
        className="btn mt-4 w-full bg-primary/15 text-primary"
        onClick={() => setPickerOpen(true)}
      >
        <IconPlus size={17} />
        Añadir ejercicios
      </button>
      <button className="btn btn-danger mt-3 w-full" onClick={() => setConfirmDiscard(true)}>
        {isEdit ? 'Cancelar edición' : 'Descartar entreno'}
      </button>

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={(ids) =>
          void useActive.getState().addExercises(ids, useSettings.getState().defaultRestSec)
        }
      />

      <FinishSheet open={finishOpen} onClose={() => setFinishOpen(false)} onFinish={doFinish} />

      <Confirm
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title={isEdit ? '¿Cancelar la edición?' : '¿Descartar el entreno?'}
        message={
          isEdit
            ? 'Los cambios no guardados se perderán.'
            : 'Se perderán todas las series de esta sesión.'
        }
        confirmLabel={isEdit ? 'Cancelar edición' : 'Descartar'}
        danger
        onConfirm={() => {
          const back = session.editingWorkoutId
          useActive.getState().discard()
          navigate(back ? `/historial/${back}` : '/', { replace: true })
        }}
      />
    </div>
  )
}

function Elapsed({ isEdit, startedAt }: { isEdit: boolean; startedAt: number }) {
  const now = useNow(1000, !isEdit)
  if (isEdit) return <span className="text-sm font-bold text-warning">Editando entreno</span>
  return (
    <span className="font-mono text-base font-bold tabular-nums">
      {clock((now - startedAt) / 1000)}
    </span>
  )
}

function ExerciseBlock({
  ex,
  index,
  count,
}: {
  ex: ActiveExercise
  index: number
  count: number
}) {
  const { byId } = useCatalog()
  const units = useSettings((s) => s.units)
  const info = byId.get(ex.exerciseId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [restOpen, setRestOpen] = useState(false)
  const [showNotes, setShowNotes] = useState(ex.notes.length > 0)

  const menuActions = [
    {
      label: showNotes ? 'Quitar nota' : 'Añadir nota',
      onClick: () => {
        if (showNotes) useActive.getState().setExerciseNotes(ex.uid, '')
        setShowNotes(!showNotes)
      },
    },
    {
      label: `Descanso entre series: ${restLabel(ex.restSec)}`,
      icon: <IconTimer size={18} />,
      onClick: () => setRestOpen(true),
    },
    ...(index > 0
      ? [{ label: 'Mover arriba', onClick: () => useActive.getState().moveExercise(ex.uid, -1) }]
      : []),
    ...(index < count - 1
      ? [{ label: 'Mover abajo', onClick: () => useActive.getState().moveExercise(ex.uid, 1) }]
      : []),
    {
      label: 'Quitar ejercicio',
      danger: true,
      onClick: () => useActive.getState().removeExercise(ex.uid),
    },
  ]

  return (
    <div className="card mt-3 px-3 py-3">
      <div className="flex items-center gap-3">
        <Link to={`/ejercicios/${ex.exerciseId}`}>
          <ExerciseThumb exercise={info} size={42} />
        </Link>
        <Link
          to={`/ejercicios/${ex.exerciseId}`}
          className="min-w-0 flex-1 text-sm font-bold text-primary"
        >
          {info?.name ?? 'Ejercicio eliminado'}
        </Link>
        <button
          className="shrink-0 rounded-lg p-1.5 text-muted active:bg-surface-2"
          onClick={() => setMenuOpen(true)}
          aria-label="Opciones del ejercicio"
        >
          <IconDots size={18} />
        </button>
      </div>

      {showNotes && (
        <input
          className="input mt-2 text-sm"
          placeholder="Nota del ejercicio…"
          value={ex.notes}
          onChange={(e) => useActive.getState().setExerciseNotes(ex.uid, e.target.value)}
        />
      )}

      <div className="grid grid-cols-[2.2rem_1fr_4.4rem_4.4rem_2.6rem] items-center gap-x-2 pb-1 pt-3 text-center text-[10px] font-bold uppercase tracking-wide text-muted">
        <span>Set</span>
        <span className="text-left">Anterior</span>
        <span>{units}</span>
        <span>Reps</span>
        <span>
          <IconCheck size={12} className="mx-auto" />
        </span>
      </div>

      {ex.sets.map((_, i) => (
        <SetRow key={i} ex={ex} i={i} />
      ))}

      <button
        className="btn btn-surface mt-2 w-full py-2 text-sm"
        onClick={() => useActive.getState().addSet(ex.uid)}
      >
        <IconPlus size={15} />
        Añadir serie
      </button>

      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={info?.name}
        actions={menuActions}
      />
      <Sheet open={restOpen} onClose={() => setRestOpen(false)} title="Descanso entre series">
        <div className="flex flex-col pb-2">
          {REST_OPTIONS.map((s) => (
            <button
              key={s}
              className={`rounded-xl px-3 py-3 text-left ${
                ex.restSec === s ? 'font-bold text-primary' : ''
              }`}
              onClick={() => {
                useActive.getState().setExerciseRest(ex.uid, s)
                setRestOpen(false)
              }}
            >
              {restLabel(s)}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  )
}

function SetRow({ ex, i }: { ex: ActiveExercise; i: number }) {
  const units = useSettings((s) => s.units)
  const [typeOpen, setTypeOpen] = useState(false)
  const st = ex.sets[i]
  if (!st) return null
  const ph = placeholderFor(ex, i)
  const prev = ex.prev[i]
  const meta = SET_TYPE_META[st.type]
  const setNumber = ex.sets.slice(0, i + 1).filter((s) => s.type !== 'warmup').length

  return (
    <div
      className={`grid grid-cols-[2.2rem_1fr_4.4rem_4.4rem_2.6rem] items-center gap-x-2 rounded-lg py-1 ${
        st.completed ? 'bg-success/10' : ''
      }`}
    >
      <button
        className={`py-1 text-center text-sm font-bold ${meta.className}`}
        onClick={() => setTypeOpen(true)}
        aria-label="Tipo de serie"
      >
        {st.type === 'normal' ? setNumber : meta.badge}
      </button>
      <span className="truncate text-xs text-muted">
        {prev ? `${kgToDisplay(prev.weightKg, units)} ${units} × ${prev.reps}` : '—'}
      </span>
      <NumInput
        decimal
        value={st.weightKg === null ? null : kgToDisplay(st.weightKg, units)}
        placeholder={String(kgToDisplay(ph.weightKg, units))}
        onValue={(v) =>
          useActive
            .getState()
            .updateSet(ex.uid, i, { weightKg: v === null ? null : displayToKg(v, units) })
        }
      />
      <NumInput
        value={st.reps}
        placeholder={String(ph.reps)}
        onValue={(v) =>
          useActive
            .getState()
            .updateSet(ex.uid, i, { reps: v === null ? null : Math.max(0, Math.round(v)) })
        }
      />
      <button
        className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          st.completed ? 'bg-success text-white' : 'bg-surface-2 text-muted'
        }`}
        onClick={() => useActive.getState().toggleSet(ex.uid, i)}
        aria-label="Completar serie"
      >
        <IconCheck size={15} />
      </button>

      <ActionSheet
        open={typeOpen}
        onClose={() => setTypeOpen(false)}
        title="Tipo de serie"
        actions={[
          {
            label: 'Calentamiento (W)',
            onClick: () => useActive.getState().setSetType(ex.uid, i, 'warmup'),
          },
          { label: 'Normal', onClick: () => useActive.getState().setSetType(ex.uid, i, 'normal') },
          {
            label: 'Al fallo (F)',
            onClick: () => useActive.getState().setSetType(ex.uid, i, 'failure'),
          },
          { label: 'Drop set (D)', onClick: () => useActive.getState().setSetType(ex.uid, i, 'drop') },
          {
            label: 'Eliminar serie',
            danger: true,
            onClick: () => useActive.getState().removeSet(ex.uid, i),
          },
        ]}
      />
    </div>
  )
}

/** Input numérico que no pelea con el tecleo de decimales. */
function NumInput({
  value,
  onValue,
  placeholder,
  decimal = false,
}: {
  value: number | null
  onValue: (v: number | null) => void
  placeholder: string
  decimal?: boolean
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(value === null ? '' : String(value))
  }, [value, focused])

  return (
    <input
      className="input px-1 py-1.5 text-center text-sm font-semibold"
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        setFocused(true)
        e.target.select()
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        if (t.trim() === '') {
          onValue(null)
          return
        }
        const n = parseFloat(t.replace(',', '.'))
        if (Number.isFinite(n)) onValue(n)
      }}
    />
  )
}

function FinishSheet({
  open,
  onClose,
  onFinish,
}: {
  open: boolean
  onClose: () => void
  onFinish: () => void
}) {
  const session = useActive((s) => s.session)
  const units = useSettings((s) => s.units)
  if (!session) return null
  const isEdit = !!session.editingWorkoutId
  const completedSets = session.exercises.reduce(
    (a, e) => a + e.sets.filter((s) => s.completed).length,
    0,
  )
  const incomplete = session.exercises.reduce(
    (a, e) => a + e.sets.filter((s) => !s.completed).length,
    0,
  )
  const volumeKg = session.exercises.reduce(
    (a, e) =>
      a +
      e.sets
        .filter((s) => s.completed && s.type !== 'warmup')
        .reduce((x, s) => x + (s.weightKg ?? 0) * (s.reps ?? 0), 0),
    0,
  )

  return (
    <Sheet open={open} onClose={onClose} title={isEdit ? 'Guardar cambios' : 'Finalizar entreno'}>
      <div className="grid grid-cols-3 gap-2 pb-3">
        <MiniStat
          label="Duración"
          value={isEdit ? '—' : formatDuration((Date.now() - session.startedAt) / 1000)}
        />
        <MiniStat label="Volumen" value={formatVolume(volumeKg, units)} />
        <MiniStat label="Series" value={String(completedSets)} />
      </div>
      {incomplete > 0 && (
        <p className="pb-3 text-sm text-warning">
          {incomplete} {incomplete === 1 ? 'serie sin completar se descartará' : 'series sin completar se descartarán'}.
        </p>
      )}
      <button
        className="btn btn-primary mb-2 w-full"
        onClick={() => {
          onClose()
          onFinish()
        }}
      >
        {isEdit ? 'Guardar cambios' : 'Finalizar entreno'}
      </button>
    </Sheet>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-2 py-2.5 text-center">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="pt-0.5 text-sm font-bold">{value}</div>
    </div>
  )
}
