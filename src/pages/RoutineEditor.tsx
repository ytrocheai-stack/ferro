import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db/db'
import type { RoutineExercise } from '../db/types'
import { useCatalog } from '../data/exercises'
import { useSettings } from '../stores/settings'
import { ExercisePicker } from '../components/ExercisePicker'
import { ExerciseThumb } from '../components/ExerciseThumb'
import { Confirm } from '../components/Sheet'
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronUp,
  IconPlus,
  IconTrash,
} from '../components/icons'
import { uid } from '../lib/format'
import { REST_OPTIONS, restLabel } from '../lib/constants'

export default function RoutineEditor() {
  const { id } = useParams()
  const isNew = id === 'nueva'
  const navigate = useNavigate()
  const { byId } = useCatalog()
  const defaultRestSec = useSettings((s) => s.defaultRestSec)

  const [name, setName] = useState('')
  const [exercises, setExercises] = useState<RoutineExercise[]>([])
  const [loaded, setLoaded] = useState(isNew)
  const [original, setOriginal] = useState(isNew ? JSON.stringify({ name: '', exercises: [] }) : '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)

  useEffect(() => {
    if (isNew) return
    void db.routines.get(id!).then((r) => {
      if (!r) {
        navigate('/', { replace: true })
        return
      }
      setName(r.name)
      setExercises(r.exercises)
      setOriginal(JSON.stringify({ name: r.name, exercises: r.exercises }))
      setLoaded(true)
    })
  }, [id, isNew, navigate])

  const dirty = loaded && JSON.stringify({ name, exercises }) !== original
  const canSave = name.trim().length > 0 && exercises.length > 0

  const save = async () => {
    if (!canSave) return
    const existing = isNew ? undefined : await db.routines.get(id!)
    await db.routines.put({
      id: existing?.id ?? uid(),
      name: name.trim(),
      sortOrder: existing?.sortOrder ?? Date.now(),
      createdAt: existing?.createdAt ?? Date.now(),
      exercises,
    })
    navigate('/', { replace: true })
  }

  const update = (i: number, patch: Partial<RoutineExercise>) =>
    setExercises((arr) => arr.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  const move = (i: number, delta: number) =>
    setExercises((arr) => {
      const j = i + delta
      if (j < 0 || j >= arr.length) return arr
      const copy = [...arr]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })

  if (!loaded) return null

  return (
    <div className="px-4 pt-4">
      <header className="flex items-center justify-between pb-4">
        <button
          className="-ml-2 rounded-lg p-1.5 text-muted active:bg-surface-2"
          onClick={() => (dirty ? setConfirmExit(true) : navigate(-1))}
          aria-label="Volver"
        >
          <IconChevronLeft size={22} />
        </button>
        <h1 className="text-lg font-bold">{isNew ? 'Nueva rutina' : 'Editar rutina'}</h1>
        <button
          className="rounded-xl bg-primary px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
          disabled={!canSave}
          onClick={() => void save()}
        >
          Guardar
        </button>
      </header>

      <input
        className="input mb-4 text-base font-semibold"
        placeholder="Nombre de la rutina (p. ej. Push día 1)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="flex flex-col gap-3">
        {exercises.map((re, i) => {
          const info = byId.get(re.exerciseId)
          return (
            <div key={`${re.exerciseId}-${i}`} className="card px-3 py-3">
              <div className="flex items-center gap-3">
                <ExerciseThumb exercise={info} size={44} />
                <div className="min-w-0 flex-1 text-sm font-semibold">
                  {info?.name ?? 'Ejercicio eliminado'}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    className="rounded-lg p-1.5 text-muted active:bg-surface-2 disabled:opacity-30"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Subir"
                  >
                    <IconChevronUp size={17} />
                  </button>
                  <button
                    className="rounded-lg p-1.5 text-muted active:bg-surface-2 disabled:opacity-30"
                    onClick={() => move(i, 1)}
                    disabled={i === exercises.length - 1}
                    aria-label="Bajar"
                  >
                    <IconChevronDown size={17} />
                  </button>
                  <button
                    className="rounded-lg p-1.5 text-danger active:bg-surface-2"
                    onClick={() => setExercises((arr) => arr.filter((_, j) => j !== i))}
                    aria-label="Quitar"
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>
              <div className="flex gap-3 pt-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase text-muted">Series</span>
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={20}
                    value={re.plannedSets}
                    onChange={(e) =>
                      update(i, { plannedSets: Math.max(1, Math.floor(e.target.valueAsNumber || 1)) })
                    }
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase text-muted">Descanso</span>
                  <select
                    className="input"
                    value={re.restSec}
                    onChange={(e) => update(i, { restSec: Number(e.target.value) })}
                  >
                    {REST_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {restLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <button
        className="btn mt-4 w-full bg-primary/15 text-primary"
        onClick={() => setPickerOpen(true)}
      >
        <IconPlus size={17} />
        Añadir ejercicios
      </button>

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={(ids) =>
          setExercises((arr) => [
            ...arr,
            ...ids.map((exerciseId) => ({ exerciseId, plannedSets: 3, restSec: defaultRestSec })),
          ])
        }
      />

      <Confirm
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="¿Salir sin guardar?"
        message="Los cambios de esta rutina se perderán."
        confirmLabel="Salir"
        danger
        onConfirm={() => navigate(-1)}
      />
    </div>
  )
}
