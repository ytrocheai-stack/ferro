import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { lookupBarcode } from './openFoodFacts'

describe('Open Food Facts', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    await db.delete()
    await db.open()
  })

  it('usa el API v3.6 para códigos no cacheados', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          product: {
            code: '123',
            product_name: 'Producto',
            nutriments: {
              'energy-kcal_100g': 100,
              proteins_100g: 10,
              carbohydrates_100g: 20,
              fat_100g: 3,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await lookupBarcode('123')
    expect(result).toMatchObject({ id: 'off-123', source: 'off', kcal100: 100 })
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v3.6/product/123.json')
    await expect(db.foods.get('off-123')).resolves.toMatchObject({ name: 'Producto' })
  })

  it('devuelve el caché sin red', async () => {
    await db.foods.put({ id: 'off-321', name: 'Cache', source: 'off', kcal100: 1, p100: 1, c100: 1, f100: 1 })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(lookupBarcode('321')).resolves.toMatchObject({ name: 'Cache' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
