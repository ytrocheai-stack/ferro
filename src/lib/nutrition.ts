import type { ActivityLevel, Goal, Sex } from '../stores/nutrition'
import { ACTIVITY_FACTORS } from '../stores/nutrition'
import type { FoodLogEntry, Measurement } from '../db/types'

/** Mifflin-St Jeor */
export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return sex === 'male' ? base + 5 : base - 161
}

export function tdee(bmrValue: number, activity: ActivityLevel): number {
  return bmrValue * ACTIVITY_FACTORS[activity]
}

const GOAL_ADJUST: Record<Goal, number> = { bulk: 1.12, maintain: 1, cut: 0.85 }

export interface MacroTargets {
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
}

/** kcal y macros objetivo a partir de TDEE, peso corporal y objetivo. */
export function computeTargets(tdeeValue: number, weightKg: number, goal: Goal): MacroTargets {
  const kcal = Math.round(tdeeValue * GOAL_ADJUST[goal])
  const proteinG = Math.round(weightKg * (goal === 'cut' ? 2.2 : 2))
  const fatG = Math.round(weightKg * 0.9)
  const remaining = Math.max(0, kcal - proteinG * 4 - fatG * 9)
  const carbsG = Math.round(remaining / 4)
  return { kcal, proteinG, carbsG, fatG }
}

export interface WeightTrendPoint {
  date: number
  trend: number
}

/**
 * Tasa de cambio semanal (%): (últimoEMA - primerEMA) / primerEMA / semanas * 100, usando el
 * intervalo real entre fechas (no el número de pesajes, que puede no ser uno por día).
 * Exige al menos 14 días de historial para no extrapolar a partir de poco margen.
 */
export function weeklyChangePct(points: WeightTrendPoint[]): number | null {
  if (points.length < 2) return null
  const first = points[0]
  const last = points[points.length - 1]
  if (first.trend <= 0) return null
  const days = (last.date - first.date) / 86_400_000
  if (days < 14) return null
  const weeks = days / 7
  return ((last.trend - first.trend) / first.trend / weeks) * 100
}

/** Sugerencia adaptativa simple estilo MacroFactor. null si no aplica. */
export function suggestCalorieAdjustment(
  goal: Goal,
  weeklyPct: number | null,
): { deltaKcal: number; reason: string } | null {
  if (weeklyPct === null) return null
  if (goal === 'bulk' && weeklyPct < 0.15) {
    return { deltaKcal: 125, reason: 'Tu peso apenas sube — prueba a subir 125 kcal/día.' }
  }
  if (goal === 'bulk' && weeklyPct > 0.6) {
    return { deltaKcal: -100, reason: 'Estás ganando peso muy rápido (más grasa que músculo) — baja 100 kcal/día.' }
  }
  if (goal === 'cut' && weeklyPct > -0.3) {
    return { deltaKcal: -125, reason: 'Tu peso apenas baja — prueba a bajar 125 kcal/día.' }
  }
  if (goal === 'cut' && weeklyPct < -1) {
    return { deltaKcal: 100, reason: 'Estás perdiendo peso muy rápido (riesgo de perder músculo) — sube 100 kcal/día.' }
  }
  return null
}

export interface NutritionInsightDay {
  date: string
  kcal: number | null
  proteinG: number | null
}

export interface NutritionInsights {
  days: NutritionInsightDay[]
  loggedDays: number
  coveragePct: number
  calorieAdherencePct: number
  proteinAdherencePct: number
  averageKcal: number | null
  estimatedExpenditure: number | null
  expenditureConfidence: 'low' | 'medium' | 'high'
}

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function estimateWeightSlopePerDay(measurements: Measurement[]): number | null {
  const points = measurements
    .filter((measurement) => measurement.kind === 'weight' && measurement.value > 0)
    .sort((a, b) => a.date - b.date)
  if (points.length < 3) return null
  const spanDays = (points[points.length - 1].date - points[0].date) / 86_400_000
  if (spanDays < 14) return null

  const origin = points[0].date
  const xs = points.map((point) => (point.date - origin) / 86_400_000)
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const meanY = points.reduce((sum, point) => sum + point.value, 0) / points.length
  let numerator = 0
  let denominator = 0
  for (let index = 0; index < points.length; index++) {
    const dx = xs[index] - meanX
    numerator += dx * (points[index].value - meanY)
    denominator += dx * dx
  }
  return denominator > 0 ? numerator / denominator : null
}

/**
 * Resume la calidad de registro y estima gasto energético con balance energético:
 * gasto ≈ ingesta media − (pendiente de peso kg/día × 7.700 kcal/kg).
 */
export function buildNutritionInsights(
  entries: FoodLogEntry[],
  measurements: Measurement[],
  goals: { kcal: number; proteinG: number },
  now: Date = new Date(),
  windowDays = 14,
): NutritionInsights {
  const totals = new Map<string, { kcal: number; proteinG: number }>()
  for (const entry of entries) {
    const current = totals.get(entry.date) ?? { kcal: 0, proteinG: 0 }
    current.kcal += entry.kcal
    current.proteinG += entry.p
    totals.set(entry.date, current)
  }

  const days: NutritionInsightDay[] = []
  for (let offset = windowDays - 1; offset >= 0; offset--) {
    const date = new Date(now)
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    const key = localDateKey(date)
    const total = totals.get(key)
    days.push({
      date: key,
      kcal: total && total.kcal > 0 ? Math.round(total.kcal) : null,
      proteinG: total && total.kcal > 0 ? total.proteinG : null,
    })
  }

  const logged = days.filter((day) => day.kcal !== null)
  const loggedDays = logged.length
  const coveragePct = Math.round((loggedDays / Math.max(1, windowDays)) * 100)
  const averageKcal = loggedDays
    ? Math.round(logged.reduce((sum, day) => sum + (day.kcal ?? 0), 0) / loggedDays)
    : null
  const calorieAdherent = logged.filter(
    (day) => (day.kcal ?? 0) >= goals.kcal * 0.9 && (day.kcal ?? 0) <= goals.kcal * 1.1,
  ).length
  const proteinAdherent = logged.filter(
    (day) => (day.proteinG ?? 0) >= goals.proteinG * 0.9,
  ).length

  const windowStart = now.getTime() - windowDays * 86_400_000
  const relevantMeasurements = measurements.filter(
    (measurement) => measurement.date >= windowStart && measurement.date <= now.getTime(),
  )
  const slope = estimateWeightSlopePerDay(relevantMeasurements)
  const eligible = averageKcal !== null && coveragePct >= 70 && slope !== null
  const estimatedExpenditure = eligible
    ? Math.round((averageKcal - slope * 7_700) / 10) * 10
    : null
  const weightCount = relevantMeasurements.filter((measurement) => measurement.kind === 'weight').length
  const confidence: NutritionInsights['expenditureConfidence'] =
    estimatedExpenditure === null
      ? 'low'
      : coveragePct >= 85 && weightCount >= 8
        ? 'high'
        : 'medium'

  return {
    days,
    loggedDays,
    coveragePct,
    calorieAdherencePct: loggedDays ? Math.round((calorieAdherent / loggedDays) * 100) : 0,
    proteinAdherencePct: loggedDays ? Math.round((proteinAdherent / loggedDays) * 100) : 0,
    averageKcal,
    estimatedExpenditure,
    expenditureConfidence: confidence,
  }
}
