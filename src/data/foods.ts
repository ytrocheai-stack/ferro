import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Food } from '../db/types'
import { flattenFoodSeed } from './foods.seed'
import { normalize, uid } from '../lib/format'

export interface LocalFood {
  id: string
  name: string
  kcal100: number
  p100: number
  c100: number
  f100: number
  servingG: number
  source: 'seed' | 'custom' | 'off'
  favorite?: boolean
  usedAt?: number
}

let seedCache: LocalFood[] | null = null

export function seedFoods(): LocalFood[] {
  seedCache ??= flattenFoodSeed().map(([name, kcal100, p100, c100, f100, servingG]) => ({
    id: `seed-${normalize(name).replace(/[^a-z0-9]+/g, '-')}`,
    name,
    kcal100,
    p100,
    c100,
    f100,
    servingG,
    source: 'seed' as const,
  }))
  return seedCache
}

function fromDbFood(f: Food): LocalFood {
  return {
    id: f.id,
    name: f.name + (f.brand ? ` (${f.brand})` : ''),
    kcal100: f.kcal100,
    p100: f.p100,
    c100: f.c100,
    f100: f.f100,
    servingG: f.servingG ?? 100,
    source: f.source === 'custom' ? 'custom' : 'off',
    favorite: f.favorite,
    usedAt: f.usedAt,
  }
}

/** Catálogo combinado: seed local + propios/caché de Dexie, en vivo. */
export function useFoodCatalog() {
  const dbFoods = useLiveQuery(() => db.foods.toArray(), [], [] as Food[])
  const all = useMemo(() => {
    const custom = dbFoods.map(fromDbFood)
    return [...custom, ...seedFoods()]
  }, [dbFoods])
  return all
}

export function searchFoods(all: LocalFood[], query: string, limit = 40): LocalFood[] {
  const q = normalize(query.trim())
  if (!q) {
    return [...all]
      .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0) || (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0))
      .slice(0, limit)
  }
  const tokens = q.split(/\s+/)
  return all
    .filter((f) => {
      const hay = normalize(f.name)
      return tokens.every((t) => hay.includes(t))
    })
    .slice(0, limit)
}

export function macrosForGrams(f: LocalFood, grams: number) {
  const ratio = grams / 100
  return {
    kcal: Math.round(f.kcal100 * ratio),
    p: Math.round(f.p100 * ratio * 10) / 10,
    c: Math.round(f.c100 * ratio * 10) / 10,
    f: Math.round(f.f100 * ratio * 10) / 10,
  }
}

export async function markFoodUsed(foodId: string) {
  if (foodId.startsWith('seed-')) return
  const existing = await db.foods.get(foodId)
  if (existing) await db.foods.put({ ...existing, usedAt: Date.now() })
}

export async function toggleFavoriteFood(food: LocalFood) {
  if (food.source === 'seed') return // los de la base local no se marcan (no están en Dexie)
  const existing = await db.foods.get(food.id)
  if (existing) await db.foods.put({ ...existing, favorite: !existing.favorite })
}

export async function saveCustomFood(input: {
  name: string
  kcal100: number
  p100: number
  c100: number
  f100: number
  servingG?: number
}): Promise<string> {
  const id = `custom-${uid()}`
  await db.foods.put({
    id,
    name: input.name,
    source: 'custom',
    kcal100: input.kcal100,
    p100: input.p100,
    c100: input.c100,
    f100: input.f100,
    servingG: input.servingG,
    usedAt: Date.now(),
  })
  return id
}

/** hook simple para saber si hay conexión (no offline). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
