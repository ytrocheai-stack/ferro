import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { markFoodUsed, searchFoods, seedFoods } from './foods'

describe('catálogo de alimentos', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('no muestra resultados OFF cacheados sin uso en la lista inicial', () => {
    const foods = [
      { id: 'off-1', name: 'Producto encontrado', source: 'off' as const, kcal100: 1, p100: 1, c100: 1, f100: 1, servingG: 100 },
      { id: 'custom-1', name: 'Mi alimento', source: 'custom' as const, kcal100: 1, p100: 1, c100: 1, f100: 1, servingG: 100 },
    ]
    expect(searchFoods(foods, '', 10).map((food) => food.id)).toEqual(['custom-1'])
  })

  it('materializa un alimento base al usarlo para conservar la recencia', async () => {
    const seed = seedFoods()[0]
    await markFoodUsed(seed.id)
    await expect(db.foods.get(seed.id)).resolves.toMatchObject({ source: 'seed', usedAt: expect.any(Number) })
  })
})
