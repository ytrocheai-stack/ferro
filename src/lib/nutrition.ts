import type { ActivityLevel, Goal, Sex } from '../stores/nutrition'
import { ACTIVITY_FACTORS } from '../stores/nutrition'

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
