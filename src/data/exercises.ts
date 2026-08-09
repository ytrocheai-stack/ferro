import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { CustomExercise } from '../db/types'
import { normalize } from '../lib/format'
import { groupFromTarget, type MuscleGroup } from './muscleGroups'
import { t } from './translations'

export interface Exercise {
  id: string
  name: string
  bodyPart: string
  equipment: string
  target: string
  muscleGroup: string
  secondaryMuscles: string[]
  image: string | null
  gif: string | null
  steps: string[]
  source?: 'primary' | 'wger'
  sourceUrl?: string
  license?: string
  aliases?: string[]
  custom?: boolean
}

let cache: Exercise[] | null = null
let pending: Promise<Exercise[]> | null = null

export function loadExercises(): Promise<Exercise[]> {
  if (cache) return Promise.resolve(cache)
  pending ??= fetch(import.meta.env.BASE_URL + 'data/exercises.json')
    .then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar la biblioteca (HTTP ${r.status})`)
      return r.json()
    })
    .then(async (list: Exercise[]) => {
      const primary = list.map((exercise) => ({ ...exercise, source: exercise.source ?? 'primary' as const }))
      let supplement: Exercise[] = []
      try {
        const response = await fetch(import.meta.env.BASE_URL + 'data/exercises-wger.json')
        if (response.ok) supplement = (await response.json()) as Exercise[]
      } catch {
        // El catálogo principal sigue funcionando aunque falte el snapshot opcional.
      }
      const names = new Set(primary.map((exercise) => normalize(exercise.name)))
      const merged = [...primary]
      for (const exercise of supplement) {
        const normalized = normalize(exercise.name)
        if (!normalized || names.has(normalized)) continue
        names.add(normalized)
        merged.push({ ...exercise, source: 'wger' })
      }
      merged.sort((a, b) => a.name.localeCompare(b.name))
      cache = merged
      return merged
    })
    .catch((err) => {
      pending = null
      throw err
    })
  return pending
}

export function mediaUrl(rel: string | null | undefined): string | null {
  return rel ? import.meta.env.BASE_URL + rel : null
}

function fromCustom(c: CustomExercise): Exercise {
  return {
    id: c.id,
    name: c.name,
    bodyPart: c.bodyPart,
    equipment: c.equipment,
    target: c.target,
    muscleGroup: c.target,
    secondaryMuscles: c.secondaryMuscles,
    image: null,
    gif: null,
    steps: [],
    custom: true,
  }
}

/** Catálogo completo: dataset + ejercicios personalizados (en vivo desde Dexie). */
export function useCatalog() {
  const [base, setBase] = useState<Exercise[] | null>(cache)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (base) return
    let alive = true
    loadExercises().then(
      (l) => {
        if (alive) setBase(l)
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      alive = false
    }
  }, [base])

  const customs = useLiveQuery(() => db.customExercises.toArray(), [], [] as CustomExercise[])

  return useMemo(() => {
    const customExercises = (customs ?? []).map(fromCustom).sort((a, b) => a.name.localeCompare(b.name))
    const all = [...customExercises, ...(base ?? [])]
    const byId = new Map(all.map((e) => [e.id, e]))
    return { all, byId, ready: base !== null, error }
  }, [base, customs, error])
}

/** Grupo muscular efectivo para filtros y secciones ('cardio' para ejercicios cardiovasculares). */
export type ExerciseGroup = MuscleGroup | 'cardio'

export function exerciseGroup(e: Exercise): ExerciseGroup | null {
  if (e.target === 'cardiovascular system') return 'cardio'
  return groupFromTarget(e.target)
}

export interface ExerciseFilters {
  query: string
  group: ExerciseGroup | null
  equipment: string | null
  onlyCustom: boolean
}

export function searchExercises(all: Exercise[], f: ExerciseFilters): Exercise[] {
  const q = normalize(f.query.trim())
  return all.filter((e) => {
    if (f.onlyCustom && !e.custom) return false
    if (f.group && exerciseGroup(e) !== f.group) return false
    if (f.equipment && e.equipment !== f.equipment) return false
    if (q) {
      const hay = normalize(
        `${e.name} ${(e.aliases ?? []).join(' ')} ${e.target} ${e.equipment} ${e.bodyPart} ${t(e.target)} ${t(e.equipment)} ${t(e.bodyPart)}`,
      )
      for (const token of q.split(/\s+/)) {
        if (!hay.includes(token)) return false
      }
    }
    return true
  })
}

export function equipmentOptions(all: Exercise[]): string[] {
  return [...new Set(all.map((e) => e.equipment).filter(Boolean))].sort((a, b) =>
    t(a).localeCompare(t(b), 'es'),
  )
}

export function targetOptions(all: Exercise[]): string[] {
  return [...new Set(all.map((e) => e.target).filter(Boolean))].sort((a, b) =>
    t(a).localeCompare(t(b), 'es'),
  )
}
