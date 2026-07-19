import { db } from '../db/db'
import type { Food } from '../db/types'

const API = 'https://es.openfoodfacts.org'

interface OffProduct {
  code: string
  product_name?: string
  product_name_es?: string
  brands?: string
  nutriments?: {
    'energy-kcal_100g'?: number
    /** kJ, alternativa cuando falta 'energy-kcal_100g' */
    energy_100g?: number
    proteins_100g?: number
    carbohydrates_100g?: number
    fat_100g?: number
  }
}

const KJ_PER_KCAL = 4.184

type OffFood = Omit<Food, 'usedAt' | 'favorite'>

function toFood(p: OffProduct): OffFood | null {
  const name = p.product_name_es || p.product_name
  const n = p.nutriments
  const kcal100 = n?.['energy-kcal_100g'] ?? (n?.energy_100g != null ? n.energy_100g / KJ_PER_KCAL : null)
  if (!name || !n || kcal100 == null) return null
  return {
    id: `off-${p.code}`,
    name,
    brand: p.brands?.split(',')[0]?.trim(),
    source: 'off',
    offCode: p.code,
    kcal100: Math.round(kcal100),
    p100: Math.round((n.proteins_100g ?? 0) * 10) / 10,
    c100: Math.round((n.carbohydrates_100g ?? 0) * 10) / 10,
    f100: Math.round((n.fat_100g ?? 0) * 10) / 10,
  }
}

/**
 * Busca productos por texto en Open Food Facts. Lanza en caso de error de red.
 * Cachea los resultados en Dexie para uso offline sin marcarlos como "usados": conserva
 * `usedAt`/`favorite` de un registro ya existente en vez de sobreescribirlos, para que buscar
 * (sin añadir nada) no contamine "recientes" ni borre favoritos.
 */
export async function searchOpenFoodFacts(query: string, limit = 20): Promise<Food[]> {
  const url = `${API}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${limit}&fields=code,product_name,product_name_es,brands,nutriments`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open Food Facts: HTTP ${res.status}`)
  const data = (await res.json()) as { products?: OffProduct[] }
  const parsed = (data.products ?? []).map(toFood).filter((f): f is OffFood => f !== null)
  if (!parsed.length) return []
  const existing = await db.foods.bulkGet(parsed.map((f) => f.id))
  const merged = parsed.map((f, i) => ({ ...f, usedAt: existing[i]?.usedAt, favorite: existing[i]?.favorite }))
  await db.foods.bulkPut(merged) // cachear para uso offline futuro
  return merged
}

/** Busca un producto por código de barras (escáner). null si no existe. */
export async function lookupBarcode(code: string): Promise<Food | null> {
  const cached = await db.foods.get(`off-${code}`)
  if (cached) return cached
  const res = await fetch(`${API}/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,product_name_es,brands,nutriments`)
  if (!res.ok) throw new Error(`Open Food Facts: HTTP ${res.status}`)
  const data = (await res.json()) as { status: number; product?: OffProduct }
  if (data.status !== 1 || !data.product) return null
  const food = toFood({ ...data.product, code })
  if (food) await db.foods.put(food)
  return food
}
