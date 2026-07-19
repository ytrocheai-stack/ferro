import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { RoutineExercise } from '../db/types'
import { useCatalog } from '../data/exercises'
import { useSettings } from '../stores/settings'
import { ExercisePicker } from '../components/ExercisePicker'
import { ExerciseThumb } from '../components/ExerciseThumb'
import { Select } from '../components/Select'
import { Confirm, Sheet } from '../components/Sheet'
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronUp,
  IconFolder,
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
  const folders = useLiveQuery(() => db.folders.orderBy('sortOrder').toArray(), [], [])

  const [name, setName] = useState('')
  const [exercises, setExercises] = useState<RoutineExercise[]>([])
  const [folderId, setFolderId] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(isNew)
  const [original, setOriginal] = useState(
    isNew ? JSON.stringify({ name: '', exercises: [], folderId: undefined }) : '',
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [repRangeFor, setRepRangeFor] = useState<number | null>(null)

  useEffect(() => {
    if (isNew) return
    void db.routines.get(id!).then((r) => {
      if (!r) {
        navigate('/', { replace: true })
        return
      }
      setName(r.name)
      setExercises(r.exercises)
      setFolderId(r.folderId)
      setOriginal(JSON.stringify({ name: r.name, exercises: r.exercises, folderId: r.folderId }))
      setLoaded(true)
    })
  }, [id, isNew, navigate])

  const dirty = loaded && JSON.stringify({ name, exercises, folderId }) !== original
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
      folderId,
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
  const currentFolder = folders?.find((f) => f.id === folderId)

  return (
    <div className="px-4 pt-4">
      <header className="flex items-center justify-between pb-4">
        <button
          className="pressable -ml-2 rounded-lg p-1.5 text-muted"
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
        className="input mb-2 text-base font-semibold"
        placeholder="Nombre de la rutina (p. ej. Push día 1)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <button
        className="pressable mb-4 flex items-center gap-2 text-sm font-semibold text-muted"
        onClick={() => setFolderOpen(true)}
      >
        <IconFolder size={15} />
        {currentFolder ? currentFolder.name : 'Sin carpeta'}
      </button>

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
                    className="pressable rounded-lg p-1.5 text-muted disabled:opacity-30"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Subir"
                  >
                    <IconChevronUp size={17} />
                  </button>
                  <button
                    className="pressable rounded-lg p-1.5 text-muted disabled:opacity-30"
                    onClick={() => move(i, 1)}
                    disabled={i === exercises.length - 1}
                    aria-label="Bajar"
                  >
                    <IconChevronDown size={17} />
                  </button>
                  <button
                    className="pressable rounded-lg p-1.5 text-danger"
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
                  <Select
                    value={re.restSec}
                    onChange={(v) => update(i, { restSec: v })}
                    options={REST_OPTIONS.map((s) => ({ value: s, label: restLabel(s) }))}
                    sheetTitle="Descanso"
                  />
                </label>
                <button
                  className="pressable flex flex-1 flex-col items-start gap-1"
                  onClick={() => setRepRangeFor(i)}
                >
                  <span className="text-[11px] font-semibold uppercase text-muted">Reps</span>
                  <span className="input flex items-center justify-center font-semibold">
                    {re.repRangeMin ?? 8}–{re.repRangeMax ?? 12}
                  </span>
                </button>
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
            ...ids.map((exerciseId) => ({
              exerciseId,
              plannedSets: 3,
              restSec: defaultRestSec,
              repRangeMin: 8,
              repRangeMax: 12,
            })),
          ])
        }
      />

      <Sheet open={folderOpen} onClose={() => setFolderOpen(false)} title="Carpeta">
        <div className="flex flex-col pb-2">
          <button
            className={`rounded-xl px-3 py-3 text-left ${!folderId ? 'font-bold text-primary' : ''}`}
            onClick={() => {
              setFolderId(undefined)
              setFolderOpen(false)
            }}
          >
            Sin carpeta
          </button>
          {(folders ?? []).map((f) => (
            <button
              key={f.id}
              className={`rounded-xl px-3 py-3 text-left ${folderId === f.id ? 'font-bold text-primary' : ''}`}
              onClick={() => {
                setFolderId(f.id)
                setFolderOpen(false)
              }}
            >
              {f.name}
            </button>
          ))}
          <NewFolderRow
            onCreate={(newId) => {
              setFolderId(newId)
              setFolderOpen(false)
            }}
          />
        </div>
      </Sheet>

      <Sheet
        open={repRangeFor !== null}
        onClose={() => setRepRangeFor(null)}
        title="Rango de repeticiones objetivo"
      >
        {repRangeFor !== null && (
          <RepRangeEditor
            min={exercises[repRangeFor]?.repRangeMin ?? 8}
            max={exercises[repRangeFor]?.repRangeMax ?? 12}
            onChange={(min, max) => update(repRangeFor, { repRangeMin: min, repRangeMax: max })}
          />
        )}
      </Sheet>

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

function NewFolderRow({ onCreate }: { onCreate: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  if (!editing)
    return (
      <button
        className="flex items-center gap-2 rounded-xl px-3 py-3 text-left text-primary"
        onClick={() => setEditing(true)}
      >
        <IconPlus size={15} />
        Nueva carpeta
      </button>
    )
  return (
    <div className="flex gap-2 px-1 py-1">
      <input
        autoFocus
        className="input"
        placeholder="Nombre de la carpeta"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        className="btn btn-primary px-3"
        disabled={!name.trim()}
        onClick={async () => {
          const id = uid()
          await db.folders.put({ id, name: name.trim(), sortOrder: Date.now() })
          onCreate(id)
        }}
      >
        Crear
      </button>
    </div>
  )
}

const REP_RANGE_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 45, 60]

function RepRangeEditor({
  min,
  max,
  onChange,
}: {
  min: number
  max: number
  onChange: (min: number, max: number) => void
}) {
  return (
    <div className="flex flex-col gap-4 pb-4">
      <p className="text-xs text-muted">
        Se usa para sugerir cuándo subir peso (doble progresión): al completar todas las series al
        tope del rango, Ferro sugiere +2.5 kg.
      </p>
      <div className="flex items-center gap-3">
        <Select
          value={min}
          onChange={(v) => onChange(Math.min(v, max), max)}
          options={REP_RANGE_STEPS.map((n) => ({ value: n, label: String(n) }))}
          sheetTitle="Repeticiones mínimas"
          className="w-20"
        />
        <span className="text-muted">a</span>
        <Select
          value={max}
          onChange={(v) => onChange(min, Math.max(min, v))}
          options={REP_RANGE_STEPS.map((n) => ({ value: n, label: String(n) }))}
          sheetTitle="Repeticiones máximas"
          className="w-20"
        />
        <span className="text-sm text-muted">reps</span>
      </div>
    </div>
  )
}
