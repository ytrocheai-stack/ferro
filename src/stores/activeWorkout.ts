import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db } from '../db/db'
import type { Routine, SetType, Workout, WorkoutExercise } from '../db/types'
import { completedSetCount, detectPRs, workoutVolume } from '../lib/stats'
import { uid } from '../lib/format'
import { vibrate } from '../lib/notify'
import { useSettings } from './settings'
import { useToasts } from './toasts'

export interface ActiveSet {
  type: SetType
  weightKg: number | null
  reps: number | null
  completed: boolean
  rpe?: number
  /** cardio */
  durationSec?: number | null
  distanceM?: number | null
}

export interface PrevSet {
  weightKg: number
  reps: number
  type?: SetType
  durationSec?: number
  distanceM?: number
}

export interface ActiveExercise {
  uid: string
  exerciseId: string
  restSec: number
  notes: string
  sets: ActiveSet[]
  /** sets del último entreno con este ejercicio, para placeholders y progresión */
  prev: PrevSet[]
  /** ejercicios con el mismo número forman una superserie */
  supersetGroup?: number
  /** rango de reps objetivo (doble progresión) */
  repRangeMin?: number
  repRangeMax?: number
}

export interface ActiveSession {
  startedAt: number
  name: string
  notes: string
  routineId?: string
  /** si está definido, estamos editando un entreno pasado */
  editingWorkoutId?: string
  originalStartedAt?: number
  originalEndedAt?: number
  exercises: ActiveExercise[]
}

interface ActiveState {
  session: ActiveSession | null
  rest: { endsAt: number; totalSec: number } | null
  startEmpty: () => void
  startFromRoutine: (routine: Routine) => Promise<void>
  startEditing: (workout: Workout) => Promise<void>
  /** repite un entreno pasado como sesión nueva (pesos anteriores de referencia) */
  repeatWorkout: (workout: Workout) => Promise<void>
  addExercises: (ids: string[], defaultRestSec: number) => Promise<void>
  removeExercise: (exUid: string) => void
  moveExercise: (exUid: string, delta: number) => void
  setName: (name: string) => void
  setWorkoutNotes: (notes: string) => void
  setExerciseRest: (exUid: string, sec: number) => void
  setExerciseNotes: (exUid: string, notes: string) => void
  /** agrupa el ejercicio con el siguiente en superserie, o deshace su grupo */
  toggleSuperset: (exUid: string) => void
  addSet: (exUid: string) => void
  removeSet: (exUid: string, index: number) => void
  updateSet: (exUid: string, index: number, patch: Partial<ActiveSet>) => void
  setSetType: (exUid: string, index: number, type: SetType) => void
  toggleSet: (exUid: string, index: number) => void
  /** inserta series de calentamiento al inicio del ejercicio */
  addWarmup: (exUid: string, sets: { weightKg: number; reps: number }[]) => void
  /** aplica un peso sugerido a las series normales aún vacías */
  applySuggestedWeight: (exUid: string, weightKg: number) => void
  startRest: (sec: number) => void
  adjustRest: (deltaSec: number) => void
  skipRest: () => void
  /** Guarda el entreno; null si no hay ninguna serie completada */
  finish: () => Promise<string | null>
  discard: () => void
}

export function defaultWorkoutName(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Entreno de madrugada'
  if (h < 12) return 'Entreno de mañana'
  if (h < 19) return 'Entreno de tarde'
  return 'Entreno de noche'
}

/** Historial completo, del más reciente al más antiguo. Cargar UNA vez por lote
 *  y pasar a `prevSetsIn` (evita releer toda la tabla por cada ejercicio). */
async function recentWorkouts(): Promise<Workout[]> {
  return db.workouts.orderBy('startedAt').reverse().toArray()
}

/** Sets de trabajo (completados, sin calentamientos) del último entreno con el ejercicio. */
function prevSetsIn(
  workouts: Workout[],
  exerciseId: string,
  before?: number,
  excludeId?: string,
): PrevSet[] {
  for (const w of workouts) {
    if (excludeId && w.id === excludeId) continue
    if (before !== undefined && w.startedAt >= before) continue
    const ex = w.exercises.find((e) => e.exerciseId === exerciseId)
    if (ex) {
      const sets = ex.sets.filter((s) => s.completed && s.type !== 'warmup')
      if (sets.length)
        return sets.map((s) => ({
          weightKg: s.weightKg,
          reps: s.reps,
          type: s.type,
          durationSec: s.durationSec,
          distanceM: s.distanceM,
        }))
    }
  }
  return []
}

const emptySet = (): ActiveSet => ({ type: 'normal', weightKg: null, reps: null, completed: false })

/** Serie previa que corresponde a la fila i: las filas de calentamiento de hoy no consumen
 *  índice y las series previas de calentamiento no cuentan (solo series de trabajo). */
export function prevWorkingSetFor(ex: ActiveExercise, i: number): PrevSet | undefined {
  if (ex.sets[i]?.type === 'warmup') return undefined
  const work = ex.prev.filter((p) => p.type !== 'warmup')
  const ordinal = ex.sets.slice(0, i).filter((s) => s.type !== 'warmup').length
  return work[ordinal]
}

/** Valor efectivo del placeholder de la fila i (serie de trabajo anterior o fila de arriba). */
export function placeholderFor(ex: ActiveExercise, i: number): PrevSet {
  const above = i > 0 ? ex.sets[i - 1] : null
  const prev = prevWorkingSetFor(ex, i)
  return {
    weightKg: prev?.weightKg ?? above?.weightKg ?? 0,
    reps: prev?.reps ?? above?.reps ?? 0,
    durationSec: prev?.durationSec ?? above?.durationSec ?? 0,
    distanceM: prev?.distanceM ?? above?.distanceM ?? 0,
  }
}

function mapExercise(
  session: ActiveSession,
  exUid: string,
  fn: (e: ActiveExercise) => ActiveExercise,
): ActiveSession {
  return { ...session, exercises: session.exercises.map((e) => (e.uid === exUid ? fn(e) : e)) }
}

/** ¿Es el último ejercicio de su tramo contiguo de superserie (o no está agrupado)?
 *  Por adyacencia: si reordenar partió el grupo, cada tramo contiguo descansa por su cuenta. */
function isLastOfSupersetGroup(session: ActiveSession, exUid: string): boolean {
  const list = session.exercises
  const i = list.findIndex((e) => e.uid === exUid)
  const g = list[i]?.supersetGroup
  if (g === undefined) return true
  return list[i + 1]?.supersetGroup !== g
}

export const useActive = create<ActiveState>()(
  persist(
    (set, get) => ({
      session: null,
      rest: null,

      startEmpty: () => {
        set({
          session: { startedAt: Date.now(), name: defaultWorkoutName(), notes: '', exercises: [] },
          rest: null,
        })
      },

      startFromRoutine: async (routine) => {
        const history = await recentWorkouts()
        const exercises: ActiveExercise[] = routine.exercises.map((re) => ({
          uid: uid(),
          exerciseId: re.exerciseId,
          restSec: re.restSec,
          notes: re.notes ?? '',
          sets: Array.from({ length: Math.max(1, re.plannedSets) }, emptySet),
          prev: prevSetsIn(history, re.exerciseId),
          supersetGroup: re.supersetGroup,
          repRangeMin: re.repRangeMin,
          repRangeMax: re.repRangeMax,
        }))
        set({
          session: {
            startedAt: Date.now(),
            name: routine.name,
            notes: '',
            routineId: routine.id,
            exercises,
          },
          rest: null,
        })
      },

      startEditing: async (workout) => {
        const history = await recentWorkouts()
        const exercises: ActiveExercise[] = workout.exercises.map((we) => ({
          uid: uid(),
          exerciseId: we.exerciseId,
          restSec: we.restSec,
          notes: we.notes ?? '',
          sets: we.sets.map((s) => ({
            type: s.type,
            weightKg: s.weightKg,
            reps: s.reps,
            completed: s.completed,
            rpe: s.rpe,
            durationSec: s.durationSec ?? null,
            distanceM: s.distanceM ?? null,
          })),
          prev: prevSetsIn(history, we.exerciseId, workout.startedAt, workout.id),
          supersetGroup: we.supersetGroup,
        }))
        set({
          session: {
            startedAt: Date.now(),
            name: workout.name,
            notes: workout.notes ?? '',
            editingWorkoutId: workout.id,
            originalStartedAt: workout.startedAt,
            originalEndedAt: workout.endedAt,
            exercises,
          },
          rest: null,
        })
      },

      repeatWorkout: async (workout) => {
        const exercises: ActiveExercise[] = workout.exercises.map((we) => ({
          uid: uid(),
          exerciseId: we.exerciseId,
          restSec: we.restSec,
          notes: we.notes ?? '',
          sets: Array.from({ length: Math.max(1, we.sets.length) }, emptySet),
          prev: we.sets
            .filter((s) => s.completed && s.type !== 'warmup')
            .map((s) => ({
              weightKg: s.weightKg,
              reps: s.reps,
              type: s.type,
              durationSec: s.durationSec,
              distanceM: s.distanceM,
            })),
          supersetGroup: we.supersetGroup,
        }))
        set({
          session: { startedAt: Date.now(), name: workout.name, notes: '', exercises },
          rest: null,
        })
      },

      addExercises: async (ids, defaultRestSec) => {
        const history = await recentWorkouts()
        const added: ActiveExercise[] = ids.map((id) => ({
          uid: uid(),
          exerciseId: id,
          restSec: defaultRestSec,
          notes: '',
          sets: [emptySet(), emptySet(), emptySet()],
          prev: prevSetsIn(history, id),
        }))
        const s = get().session
        if (!s) return
        set({ session: { ...s, exercises: [...s.exercises, ...added] } })
      },

      removeExercise: (exUid) => {
        const s = get().session
        if (!s) return
        set({ session: { ...s, exercises: s.exercises.filter((e) => e.uid !== exUid) } })
      },

      moveExercise: (exUid, delta) => {
        const s = get().session
        if (!s) return
        const i = s.exercises.findIndex((e) => e.uid === exUid)
        const j = i + delta
        if (i < 0 || j < 0 || j >= s.exercises.length) return
        const arr = [...s.exercises]
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
        set({ session: { ...s, exercises: arr } })
      },

      setName: (name) => {
        const s = get().session
        if (s) set({ session: { ...s, name } })
      },

      setWorkoutNotes: (notes) => {
        const s = get().session
        if (s) set({ session: { ...s, notes } })
      },

      setExerciseRest: (exUid, sec) => {
        const s = get().session
        if (s) set({ session: mapExercise(s, exUid, (e) => ({ ...e, restSec: sec })) })
      },

      setExerciseNotes: (exUid, notes) => {
        const s = get().session
        if (s) set({ session: mapExercise(s, exUid, (e) => ({ ...e, notes })) })
      },

      toggleSuperset: (exUid) => {
        const s = get().session
        if (!s) return
        const list = s.exercises
        const i = list.findIndex((e) => e.uid === exUid)
        if (i < 0) return
        const current = list[i].supersetGroup
        let exercises: ActiveExercise[]
        if (current !== undefined) {
          // deshacer el grupo entero
          exercises = list.map((e) =>
            e.supersetGroup === current ? { ...e, supersetGroup: undefined } : e,
          )
        } else {
          if (i + 1 >= list.length) return
          const next = list[i + 1]
          const used = new Set(list.map((e) => e.supersetGroup).filter((g) => g !== undefined))
          let group = 0
          while (used.has(group)) group++
          exercises = list.map((e) => {
            if (e.uid === exUid) return { ...e, supersetGroup: group }
            // si el siguiente ya pertenece a un grupo, se une todo su grupo
            if (e.uid === next.uid || (next.supersetGroup !== undefined && e.supersetGroup === next.supersetGroup))
              return { ...e, supersetGroup: group }
            return e
          })
        }
        set({ session: { ...s, exercises } })
      },

      addSet: (exUid) => {
        const s = get().session
        if (s) set({ session: mapExercise(s, exUid, (e) => ({ ...e, sets: [...e.sets, emptySet()] })) })
      },

      removeSet: (exUid, index) => {
        const s = get().session
        if (s)
          set({
            session: mapExercise(s, exUid, (e) => ({
              ...e,
              sets: e.sets.filter((_, i) => i !== index),
            })),
          })
      },

      updateSet: (exUid, index, patch) => {
        const s = get().session
        if (s)
          set({
            session: mapExercise(s, exUid, (e) => ({
              ...e,
              sets: e.sets.map((st, i) => (i === index ? { ...st, ...patch } : st)),
            })),
          })
      },

      setSetType: (exUid, index, type) => {
        get().updateSet(exUid, index, { type })
      },

      toggleSet: (exUid, index) => {
        const s = get().session
        if (!s) return
        const target = s.exercises.find((e) => e.uid === exUid)
        const st = target?.sets[index]
        if (!target || !st) return

        if (st.completed) {
          set({
            session: mapExercise(s, exUid, (e) => ({
              ...e,
              sets: e.sets.map((x, i) => (i === index ? { ...x, completed: false } : x)),
            })),
          })
          return
        }

        // Serie sin datos efectivos (ni escritos ni placeholder): no se puede completar
        const ph = placeholderFor(target, index)
        const reps = st.reps ?? ph.reps
        const durationSec = st.durationSec ?? ph.durationSec ?? 0
        const distanceM = st.distanceM ?? ph.distanceM ?? 0
        if (!reps && !durationSec && !distanceM) {
          useToasts.getState().show('Rellena la serie antes de completarla')
          return
        }

        const session = mapExercise(s, exUid, (e) => ({
          ...e,
          sets: e.sets.map((x, i) =>
            i === index
              ? {
                  ...x,
                  weightKg: x.weightKg ?? ph.weightKg,
                  reps: x.reps ?? ph.reps,
                  durationSec: x.durationSec ?? (ph.durationSec || null),
                  distanceM: x.distanceM ?? (ph.distanceM || null),
                  completed: true,
                }
              : x,
          ),
        }))
        set({ session })
        if (useSettings.getState().vibration) vibrate(15)
        // en superserie, el descanso llega al completar el último ejercicio del grupo;
        // tras un calentamiento no se descansa
        if (
          !s.editingWorkoutId &&
          target.restSec > 0 &&
          st.type !== 'warmup' &&
          isLastOfSupersetGroup(session, exUid)
        ) {
          get().startRest(target.restSec)
        }
      },

      addWarmup: (exUid, warmups) => {
        const s = get().session
        if (!s || !warmups.length) return
        set({
          session: mapExercise(s, exUid, (e) => {
            const existing = e.sets.filter((st) => st.type === 'warmup').length
            if (existing > 0) return e
            const w: ActiveSet[] = warmups.map((x) => ({
              type: 'warmup',
              weightKg: x.weightKg,
              reps: x.reps,
              completed: false,
            }))
            return { ...e, sets: [...w, ...e.sets] }
          }),
        })
      },

      applySuggestedWeight: (exUid, weightKg) => {
        const s = get().session
        if (!s) return
        set({
          session: mapExercise(s, exUid, (e) => ({
            ...e,
            sets: e.sets.map((st) =>
              st.type !== 'warmup' && !st.completed && st.weightKg === null
                ? { ...st, weightKg }
                : st,
            ),
          })),
        })
      },

      startRest: (sec) => {
        set({ rest: { endsAt: Date.now() + sec * 1000, totalSec: sec } })
      },

      adjustRest: (deltaSec) => {
        const r = get().rest
        if (!r) return
        const endsAt = r.endsAt + deltaSec * 1000
        if (endsAt <= Date.now()) {
          set({ rest: null })
          return
        }
        set({ rest: { endsAt, totalSec: Math.max(1, r.totalSec + deltaSec) } })
      },

      skipRest: () => set({ rest: null }),

      finish: async () => {
        // guard de reentrada: un doble toque en "Finalizar" no debe duplicar el entreno
        if (finishing) return null
        finishing = true
        try {
          return await doFinish(get, set)
        } finally {
          finishing = false
        }
      },

      discard: () => set({ session: null, rest: null }),
    }),
    {
      name: 'ferro-active',
      partialize: (s) => ({ session: s.session, rest: s.rest }) as ActiveState,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ActiveState>
        // un descanso que venció mientras la app estaba cerrada se descarta en silencio
        // (si no, el overlay dispararía vibración/notificación fantasma al reabrir)
        const rest = p.rest && p.rest.endsAt > Date.now() ? p.rest : null
        return { ...current, ...p, rest }
      },
    },
  ),
)

let finishing = false

type Getter = () => ActiveState
type Setter = (partial: Partial<ActiveState>) => void

async function doFinish(get: Getter, set: Setter): Promise<string | null> {
  const s = get().session
  if (!s) return null
  const exercises: WorkoutExercise[] = s.exercises
    .map((e) => ({
      exerciseId: e.exerciseId,
      notes: e.notes.trim() || undefined,
      restSec: e.restSec,
      supersetGroup: e.supersetGroup,
      sets: e.sets
        .filter((st) => st.completed)
        .map((st) => ({
          type: st.type,
          weightKg: st.weightKg ?? 0,
          reps: st.reps ?? 0,
          completed: true,
          rpe: st.rpe,
          durationSec: st.durationSec || undefined,
          distanceM: st.distanceM || undefined,
        })),
    }))
    .filter((e) => e.sets.length > 0)
  if (exercises.length === 0) return null

  const isEdit = !!s.editingWorkoutId
  const startedAt = isEdit ? (s.originalStartedAt ?? s.startedAt) : s.startedAt
  const endedAt = isEdit ? (s.originalEndedAt ?? Date.now()) : Date.now()
  const all = await db.workouts.orderBy('startedAt').toArray()
  const history = all.filter((w) => w.startedAt < startedAt && w.id !== s.editingWorkoutId)
  const workout: Workout = {
    id: s.editingWorkoutId ?? uid(),
    name: s.name.trim() || defaultWorkoutName(),
    startedAt,
    endedAt,
    exercises,
    volumeKg: Math.round(workoutVolume(exercises) * 10) / 10,
    totalSets: completedSetCount(exercises),
    prs: detectPRs(exercises, history),
    notes: s.notes.trim() || undefined,
  }
  await db.workouts.put(workout)
  set({ session: null, rest: null })
  return workout.id
}
