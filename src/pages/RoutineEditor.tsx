import { useEffect, useRef, useState } from 'react'
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
  IconChevronUp,
  IconFolder,
  IconPlus,
  IconTrash,
} from '../components/icons'
import { parseDec, uid } from '../lib/format'
import { REST_OPTIONS, restLabel } from '../lib/constants'
import { invalidateStaleAdaptationJobsInTransaction } from '../lib/adaptationContext'
import { getCoachAccountId } from '../lib/coachAccount'
import { PageHeader } from '../components/PageHeader'
import { useToasts } from '../stores/toasts'
import { putRoutineWithExpectedRevision, RoutineRevisionConflictError, RoutineUnavailableError, withPlannedSetCount } from '../lib/routineEditing'

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
  const [targetRpeFor, setTargetRpeFor] = useState<number | null>(null)
  const [confirmCoach, setConfirmCoach] = useState(isNew ? false : false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [saveSuccess, setSaveSuccess] = useState<string>()
  const [exerciseErrors, setExerciseErrors] = useState<Record<number, string>>({})
  const openingRevision = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (isNew) return
    void db.routines.get(id!).then((r) => {
      if (!r) {
        navigate('/', { replace: true })
        return
      }
      const normalizedExercises = r.exercises.map((exercise, index) => ({
        ...exercise,
        occurrenceId: exercise.occurrenceId ?? `${r.id}:${index}:${exercise.exerciseId}`,
        trainingRole: exercise.trainingRole ?? exercise.role ?? r.trainingRole,
      }))
      setName(r.name)
      setExercises(normalizedExercises)
      setFolderId(r.folderId)
      setConfirmCoach(r.coachReviewed ?? false)
      openingRevision.current = r.revision
      setOriginal(JSON.stringify({ name: r.name, exercises: normalizedExercises, folderId: r.folderId }))
      setLoaded(true)
    })
  }, [id, isNew, navigate])

  const dirty = loaded && JSON.stringify({ name, exercises, folderId }) !== original
  const canSave = name.trim().length > 0 && exercises.length > 0 && confirmCoach

  const save = async () => {
    if (!canSave || saving) return
    setSaving(true)
    setSaveError(undefined)
    setSaveSuccess(undefined)
    try {
      const routineId = isNew ? uid() : id!
      const now = Date.now()
      await db.transaction('rw', [db.routines, db.workouts, db.adaptationJobs, db.adaptationProposals], async () => {
        const existing = isNew ? undefined : await db.routines.get(routineId)
        const nextRoutine = {
          ...(existing ?? {}),
          id: routineId,
          name: name.trim(),
          sortOrder: existing?.sortOrder ?? now,
          createdAt: existing?.createdAt ?? now,
          exercises: exercises.map((exercise, index) => ({
            ...exercise,
            occurrenceId: exercise.occurrenceId ?? `${routineId}:${index}:${exercise.exerciseId}`,
            trainingRole: exercise.trainingRole ?? exercise.role ?? existing?.trainingRole ?? 'hypertrophy',
          })),
          folderId,
          revision: existing?.revision ?? 1,
          trainingRole: exercises[0]?.trainingRole ?? exercises[0]?.role ?? existing?.trainingRole ?? 'hypertrophy',
          loadIncrementKg: exercises[0]?.loadIncrementKg ?? existing?.loadIncrementKg ?? 2.5,
          coachReviewed: confirmCoach,
        }
        await putRoutineWithExpectedRevision(db.routines, nextRoutine, isNew ? undefined : openingRevision.current)
        await invalidateStaleAdaptationJobsInTransaction(getCoachAccountId())
      })
      setSaveSuccess('Rutina guardada correctamente.')
      useToasts.getState().show('Rutina guardada')
      navigate('/', { replace: true })
    } catch (cause) {
      if (cause instanceof RoutineRevisionConflictError) setSaveError('La rutina cambió mientras la editabas. Tu borrador sigue aquí: recarga para ver la versión nueva o descarta tus cambios.')
      else if (cause instanceof RoutineUnavailableError) setSaveError('La rutina fue retirada o eliminada mientras la editabas. Tu borrador sigue aquí; puedes copiarlo o descartarlo.')
      else setSaveError(cause instanceof Error ? `No se pudo guardar: ${cause.message}. Tu borrador sigue aquí; inténtalo de nuevo.` : 'No se pudo guardar la rutina. Tu borrador sigue aquí; inténtalo de nuevo.')
    } finally { setSaving(false) }
  }

  const update = (i: number, patch: Partial<RoutineExercise>) =>
    setExercises((arr) => arr.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  const updatePlannedSets = (index: number, plannedSets: number) => {
    try {
      const next = withPlannedSetCount(exercises[index], plannedSets)
      setExercises((arr) => arr.map((exercise, current) => current === index ? next : exercise))
      setExerciseErrors((current) => { const nextErrors = { ...current }; delete nextErrors[index]; return nextErrors })
    } catch (cause) {
      setExerciseErrors((current) => ({ ...current, [index]: cause instanceof Error ? cause.message : 'No se pudo ajustar los objetivos por serie.' }))
    }
  }

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
    <div className="page-content pt-3">
      <PageHeader
        title={isNew ? 'Nueva rutina' : 'Editar rutina'}
        back
        showProfile={false}
        onBack={() => {
          if (dirty) setConfirmExit(true)
          else navigate(-1)
        }}
        action={(
          <button className="btn btn-primary min-h-11 px-4 text-sm disabled:opacity-40" disabled={!canSave || saving} onClick={() => void save()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      />

      {saveError && <div role="alert" className="mt-3 rounded-xl bg-surface-2 p-3 text-sm text-danger"><p>{saveError}</p>{!isNew && <div className="mt-2 flex gap-2"><button className="btn btn-surface" onClick={() => navigate(0)}>Recargar</button><button className="btn btn-surface" onClick={() => navigate('/', { replace: true })}>Descartar borrador</button></div>}</div>}
      {saveSuccess && <p role="status" className="mt-3 rounded-xl bg-surface-2 p-3 text-sm text-primary">{saveSuccess}</p>}

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
                    onChange={(e) => updatePlannedSets(i, Math.max(1, Math.floor(e.target.valueAsNumber || 1)))}
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
              {exerciseErrors[i] && <p role="alert" className="pt-2 text-xs text-danger">{exerciseErrors[i]}</p>}
              <details className="mt-3 border-t border-border/70 pt-3">
                <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold text-muted">Opciones avanzadas</summary>
                <div className="grid grid-cols-2 gap-3 pt-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase text-muted">Rol</span>
                  <Select
                    value={re.trainingRole ?? re.role ?? 'hypertrophy'}
                    onChange={(value) => update(i, { trainingRole: value, role: undefined })}
                    options={[
                      { value: 'strength' as const, label: 'Fuerza' },
                      { value: 'hypertrophy' as const, label: 'Hipertrofia' },
                      { value: 'accessory' as const, label: 'Accesorio' },
                    ]}
                    sheetTitle="Rol de entrenamiento"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase text-muted">Incremento (kg)</span>
                  <input className="input" inputMode="decimal" value={re.loadIncrementKg ?? 2.5} onChange={(event) => update(i, { loadIncrementKg: Math.max(0.25, parseDec(event.target.value)) })} />
                </label>
                </div>
                <button className="pressable mt-3 min-h-11 text-left text-sm font-semibold text-muted" onClick={() => setTargetRpeFor(i)}>
                  RPE objetivo: {re.targetRpeMin !== undefined && re.targetRpeMax !== undefined ? `${re.targetRpeMin}–${re.targetRpeMax}` : 'sin objetivo (RIR libre)'}
                </button>
              </details>
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
              trainingRole: 'hypertrophy' as const,
              occurrenceId: uid(),
              loadIncrementKg: 2.5,
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

      <Sheet open={targetRpeFor !== null} onClose={() => setTargetRpeFor(null)} title="RPE objetivo">
        {targetRpeFor !== null && (
          <TargetRpeEditor
            min={exercises[targetRpeFor]?.targetRpeMin}
            max={exercises[targetRpeFor]?.targetRpeMax}
            onChange={(min, max) => update(targetRpeFor, { targetRpeMin: min, targetRpeMax: max })}
          />
        )}
      </Sheet>

      <label className="card mt-4 flex items-start gap-3 px-3 py-3 text-sm">
        <input type="checkbox" checked={confirmCoach} onChange={(event) => setConfirmCoach(event.target.checked)} />
        <span><strong>Confirmar configuración del coach</strong><br /><span className="text-xs text-muted">Revisa rol, incremento y RPE de cada ejercicio. El análisis se mantendrá bloqueado hasta confirmar.</span></span>
      </label>

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
        tope del rango, NextRep sugiere +2.5 kg.
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

function TargetRpeEditor({ min, max, onChange }: { min?: number; max?: number; onChange: (min?: number, max?: number) => void }) {
  const [minText, setMinText] = useState(min === undefined ? '' : String(min))
  const [maxText, setMaxText] = useState(max === undefined ? '' : String(max))
  return (
    <div className="flex flex-col gap-3 pb-4">
      <p className="text-xs text-muted">RPE 10 equivale a RIR 0; RPE 7 equivale aproximadamente a RIR 3. Déjalo vacío si no quieres usarlo.</p>
      <div className="grid grid-cols-2 gap-3">
        <input className="input" inputMode="decimal" placeholder="Mín. RPE" value={minText} onChange={(event) => setMinText(event.target.value)} />
        <input className="input" inputMode="decimal" placeholder="Máx. RPE" value={maxText} onChange={(event) => setMaxText(event.target.value)} />
      </div>
      <button className="btn btn-primary" onClick={() => onChange(minText.trim() ? parseDec(minText) : undefined, maxText.trim() ? parseDec(maxText) : undefined)}>Aplicar</button>
      <button className="btn btn-surface" onClick={() => onChange(undefined, undefined)}>Quitar objetivo</button>
    </div>
  )
}
