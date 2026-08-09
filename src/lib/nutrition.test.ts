import { describe, expect, it } from 'vitest'
import type { FoodLogEntry, Measurement } from '../db/types'
import { buildNutritionInsights } from './nutrition'

const NOW = new Date(2026, 7, 9, 12)

function key(daysAgo: number): string {
  const date = new Date(NOW)
  date.setDate(date.getDate() - daysAgo)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function log(daysAgo: number, kcal = 2_000, p = 160): FoodLogEntry {
  return {
    id: `log-${daysAgo}`,
    date: key(daysAgo),
    meal: 'dinner',
    name: 'Día completo',
    grams: 1,
    kcal,
    p,
    c: 200,
    f: 60,
  }
}

function weight(daysAgo: number, value: number): Measurement {
  return {
    id: `weight-${daysAgo}`,
    date: NOW.getTime() - daysAgo * 86_400_000,
    kind: 'weight',
    value,
  }
}

describe('buildNutritionInsights', () => {
  it('calcula adherencia y gasto energético a partir de ingesta y tendencia de peso reales', () => {
    const entries = Array.from({ length: 14 }, (_, i) => log(i))
    const measurements = [weight(14, 80), weight(7, 79.5), weight(0, 79)]

    const insight = buildNutritionInsights(
      entries,
      measurements,
      { kcal: 2_100, proteinG: 150 },
      NOW,
      14,
    )

    expect(insight).toMatchObject({
      loggedDays: 14,
      coveragePct: 100,
      calorieAdherencePct: 100,
      proteinAdherencePct: 100,
      averageKcal: 2_000,
      estimatedExpenditure: 2_550,
      expenditureConfidence: 'medium',
    })
    expect(insight.days).toHaveLength(14)
  })

  it('no inventa gasto energético cuando faltan registros suficientes', () => {
    const insight = buildNutritionInsights(
      [log(0), log(4)],
      [weight(7, 80), weight(0, 79.8)],
      { kcal: 2_100, proteinG: 150 },
      NOW,
      14,
    )

    expect(insight.coveragePct).toBe(14)
    expect(insight.estimatedExpenditure).toBeNull()
    expect(insight.expenditureConfidence).toBe('low')
  })

  it('no mezcla pesajes antiguos con la ventana nutricional actual', () => {
    const staleWeight: Measurement = {
      id: 'weight-stale',
      date: new Date(2025, 0, 1, 12).getTime(),
      kind: 'weight',
      value: 95,
    }

    const insight = buildNutritionInsights(
      Array.from({ length: 14 }, (_, i) => log(i)),
      [staleWeight, weight(10, 80), weight(0, 79.8)],
      { kcal: 2_100, proteinG: 150 },
      NOW,
      14,
    )

    expect(insight.estimatedExpenditure).toBeNull()
    expect(insight.expenditureConfidence).toBe('low')
  })
})
