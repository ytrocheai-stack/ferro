import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db } from '../db/db'
import type { Routine, SetType, Workout, WorkoutExercise } from '../db/types'
import { completedSetCount, detectPRs, workoutVolume } from '../lib/stats'
import { uid } from '../lib/format'
import { vibrate } from '../lib/notify'

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

/** Sets completados del último entreno que incluyó el ejercicio. */
async function prevSetsFor(exerciseId: string, before?: number, excludeId?: string): Promise<PrevSet[]> {
  const workouts = await db.workouts.orderBy('startedAt').reverse().toArray()
  for (const w of workouts) {
    if (excludeId && w.id === excludeId) continue
    if (before !== undefined && w.startedAt >= before) continue
    const ex = w.exercises.find((e) => e.exerciseId === exerciseId)
    if (ex) {
      const sets = ex.sets.filter((s) => s.completed)
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

/** Valor efectivo del placeholder de la fila i (anterior o fila de arriba). */
export function placeholderFor(ex: ActiveExercise, i: number): PrevSet {
  const above = i > 0 ? ex.sets[i - 1] : null
  return {
    weightKg: ex.prev[i]?.weightKg ?? above?.weightKg ?? 0,
    reps: ex.prev[i]?.reps ?? above?.reps ?? 0,
    durationSec: ex.prev[i]?.durationSec ?? above?.durationSec ?? 0,
    distanceM: ex.prev[i]?.distanceM ?? above?.distanceM ?? 0,
  }
}

function mapExercise(
  session: ActiveSession,
  exUid: string,
  fn: (e: ActiveExercise) => ActiveExercise,
): ActiveSession {
  return { ...session, exercises: session.exercises.map((e) => (e.uid === exUid ? fn(e) : e)) }
}

/** ¿Es el último ejercicio de su superserie (o no está agrupado)? */
function isLastOfSupersetGroup(session: ActiveSession, exUid: string): boolean {
  const list = session.exercises
  const i = list.findIndex((e) => e.uid === exUid)
  const g = list[i]?.supersetGroup
  if (g === undefined) return true
  for (let j = i + 1; j < list.length; j++) {
    if (list[j].supersetGroup === g) return false
  }
  return true
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
        const exercises: ActiveExercise[] = await Promise.all(
          routine.exercises.map(async (re) => ({
            uid: uid(),
            exerciseId: re.exerciseId,
            restSec: re.restSec,
            notes: re.notes ?? '',
            sets: Array.from({ length: Math.max(1, re.plannedSets) }, emptySet),
            prev: await prevSetsFor(re.exerciseId),
            supersetGroup: re.supersetGroup,
            repRangeMin: re.repRangeMin,
            repRangeMax: re.repRangeMax,
          })),
        )
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
        const exercises: ActiveExercise[] = await Promise.all(
          workout.exercises.map(async (we) => ({
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
            prev: await prevSetsFor(we.exerciseId, workout.startedAt, workout.id),
            supersetGroup: we.supersetGroup,
          })),
        )
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
            .filter((s) => s.completed)
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
        const added: ActiveExercise[] = await Promise.all(
          ids.map(async (id) => ({
            uid: uid(),
            exerciseId: id,
            restSec: defaultRestSec,
            notes: '',
            sets: [emptySet(), emptySet(), emptySet()],
            prev: await prevSetsFor(id),
          })),
        )
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
        let justCompleted = false
        let restSec = 0
        const session = mapExercise(s, exUid, (e) => {
          restSec = e.restSec
          return {
            ...e,
            sets: e.sets.map((st, i) => {
              if (i !== index) return st
              if (st.completed) return { ...st, completed: false }
              justCompleted = true
              const ph = placeholderFor(e, i)
              return {
                ...st,
                weightKg: st.weightKg ?? ph.weightKg,
                reps: st.reps ?? ph.reps,
                durationSec: st.durationSec ?? (ph.durationSec || null),
                distanceM: st.distanceM ?? (ph.distanceM || null),
                completed: true,
              }
            }),
          }
        })
        set({ session })
        if (justCompleted) {
          vibrate(15)
          // en superserie, el descanso llega al completar el último ejercicio del grupo
          if (!s.editingWorkoutId && restSec > 0 && isLastOfSupersetGroup(session, exUid)) {
            get().startRest(restSec)
          }
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
      },

      discard: () => set({ session: null, rest: null }),
    }),
    {
      name: 'ferro-active',
      partialize: (s) => ({ session: s.session, rest: s.rest }) as ActiveState,
    },
  ),
)
