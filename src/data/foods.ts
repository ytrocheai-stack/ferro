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
  source: 'seed' | 'custom' | 'off' | 'usda'
  aliases?: string[]
  usdaFdcId?: number
  favorite?: boolean
  usedAt?: number
}

let seedCache: LocalFood[] | null = null
let usdaCache: LocalFood[] | null = null
let usdaPending: Promise<LocalFood[]> | null = null

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

export function loadUsdaFoods(): Promise<LocalFood[]> {
  if (usdaCache) return Promise.resolve(usdaCache)
  usdaPending ??= fetch(import.meta.env.BASE_URL + 'data/usda-foundation.json')
    .then((response) => {
      if (!response.ok) throw new Error(`No se pudo cargar USDA (HTTP ${response.status})`)
      return response.json() as Promise<LocalFood[]>
    })
    .then((foods) => {
      usdaCache = foods.map((food) => ({ ...food, source: 'usda' as const, servingG: food.servingG ?? 100 }))
      return usdaCache
    })
    .catch((error) => {
      usdaPending = null
      throw error
    })
  return usdaPending
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
    source: f.source,
    favorite: f.favorite,
    usedAt: f.usedAt,
    aliases: f.aliases,
    usdaFdcId: f.usdaFdcId,
  }
}

/** Catálogo combinado: seed local + propios/caché de Dexie, en vivo. Un alimento base
 *  materializado en Dexie (favorito) sustituye a su copia estática para no duplicarlo. */
export function useFoodCatalog() {
  const dbFoods = useLiveQuery(() => db.foods.toArray(), [], [] as Food[])
  const [usda, setUsda] = useState<LocalFood[]>(usdaCache ?? [])
  useEffect(() => {
    if (usdaCache) return
    let alive = true
    void loadUsdaFoods().then((foods) => {
      if (alive) setUsda(foods)
    }).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  const all = useMemo(() => {
    const custom = dbFoods.map(fromDbFood)
    const overridden = new Set(dbFoods.map((f) => f.id))
    return [
      ...custom,
      ...seedFoods().filter((s) => !overridden.has(s.id)),
      ...usda.filter((s) => !overridden.has(s.id)),
    ]
  }, [dbFoods, usda])
  return all
}

export function searchFoods(all: LocalFood[], query: string, limit = 40): LocalFood[] {
  const q = normalize(query.trim())
  if (!q) {
    // favoritos fijados arriba; el resto por recencia de uso
    return all
      .filter((food) => food.source !== 'off' || food.favorite || food.usedAt)
      .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.usedAt ?? 0) - (a.usedAt ?? 0))
      .slice(0, limit)
  }
  const tokens = q.split(/\s+/)
  return all
    .filter((f) => {
      const hay = normalize(`${f.name} ${(f.aliases ?? []).join(' ')}`)
      return tokens.every((t) => hay.includes(t))
    })
    .slice(0, limit)
}

export function macrosForGrams(
  f: { kcal100: number; p100: number; c100: number; f100: number },
  grams: number,
) {
  const ratio = grams / 100
  return {
    kcal: Math.round(f.kcal100 * ratio),
    p: Math.round(f.p100 * ratio * 10) / 10,
    c: Math.round(f.c100 * ratio * 10) / 10,
    f: Math.round(f.f100 * ratio * 10) / 10,
  }
}

export async function markFoodUsed(foodId: string) {
  const existing = await db.foods.get(foodId)
  if (existing) {
    await db.foods.put({ ...existing, usedAt: Date.now() })
    return
  }
  const staticFood = [...seedFoods(), ...(usdaCache ?? await loadUsdaFoods().catch(() => []))].find((food) => food.id === foodId)
  if (staticFood) {
    await db.foods.put({
      id: staticFood.id,
      name: staticFood.name,
      source: staticFood.source,
      aliases: staticFood.aliases,
      usdaFdcId: staticFood.usdaFdcId,
      kcal100: staticFood.kcal100,
      p100: staticFood.p100,
      c100: staticFood.c100,
      f100: staticFood.f100,
      servingG: staticFood.servingG,
      usedAt: Date.now(),
    })
  }
}

export async function toggleFavoriteFood(food: LocalFood) {
  const isStatic = food.source === 'seed' || food.source === 'usda'
  const existing = await db.foods.get(food.id)
  if (existing) {
    if (isStatic && existing.favorite) {
      // desmarcar un alimento base: se borra la copia y vuelve a valer el registro estático
      await db.foods.delete(food.id)
    } else {
      await db.foods.put({ ...existing, favorite: !existing.favorite })
    }
    return
  }
  if (isStatic) {
    // materializar el alimento base en Dexie para poder recordar el favorito
    await db.foods.put({
      id: food.id,
      name: food.name,
      source: food.source,
      aliases: food.aliases,
      usdaFdcId: food.usdaFdcId,
      kcal100: food.kcal100,
      p100: food.p100,
      c100: food.c100,
      f100: food.f100,
      servingG: food.servingG,
      favorite: true,
      usedAt: 0,
    })
  }
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
