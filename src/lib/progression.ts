import type { PrevSet } from '../stores/activeWorkout'

/** Sugerencia de doble progresión: sube reps dentro del rango; al tope, sube peso. */
export interface Suggestion {
  weightKg: number
  targetRepsMin: number
  targetRepsMax: number
  /** true si toca subir peso respecto al último entreno */
  increase: boolean
}

export function suggestProgression(
  prev: PrevSet[],
  repMin = 8,
  repMax = 12,
  incrementKg = 2.5,
): Suggestion | null {
  const working = prev.filter((s) => s.type !== 'warmup' && s.weightKg > 0 && s.reps > 0)
  if (!working.length) return null
  const topWeight = Math.max(...working.map((s) => s.weightKg))
  const topSets = working.filter((s) => s.weightKg === topWeight)
  const allAtMax = topSets.every((s) => s.reps >= repMax)
  if (allAtMax) {
    return { weightKg: topWeight + incrementKg, targetRepsMin: repMin, targetRepsMax: repMax, increase: true }
  }
  return { weightKg: topWeight, targetRepsMin: repMin, targetRepsMax: repMax, increase: false }
}

/** Series de calentamiento estándar: barra×10, 40%×8, 60%×5, 80%×3. */
export function warmupSets(
  workingKg: number,
  barKg: number,
): { weightKg: number; reps: number }[] {
  if (workingKg <= 0) return []
  if (workingKg <= barKg * 1.5) return [{ weightKg: Math.min(barKg, workingKg), reps: 10 }]
  const round = (x: number) => Math.max(barKg, Math.round(x / 2.5) * 2.5)
  const list = [
    { weightKg: barKg, reps: 10 },
    { weightKg: round(workingKg * 0.4), reps: 8 },
    { weightKg: round(workingKg * 0.6), reps: 5 },
    { weightKg: round(workingKg * 0.8), reps: 3 },
  ]
  // sin duplicados ni pesos que igualen o superen el de trabajo
  return list.filter(
    (s, i, arr) => s.weightKg < workingKg && arr.findIndex((x) => x.weightKg === s.weightKg) === i,
  )
}

/** Discos por lado (greedy) para cargar una barra. */
export interface PlateResult {
  perSide: { plateKg: number; count: number }[]
  remainderKg: number
}

export function calcPlates(targetKg: number, barKg: number, platesKg: number[]): PlateResult {
  let side = Math.max(0, (targetKg - barKg) / 2)
  const perSide: { plateKg: number; count: number }[] = []
  for (const p of [...platesKg].sort((a, b) => b - a)) {
    const count = Math.floor((side + 1e-9) / p)
    if (count > 0) {
      perSide.push({ plateKg: p, count })
      side = Math.round((side - count * p) * 1000) / 1000
    }
  }
  return { perSide, remainderKg: Math.round(side * 2 * 100) / 100 }
}
