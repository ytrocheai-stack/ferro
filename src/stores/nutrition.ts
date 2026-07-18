import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Sex = 'male' | 'female'
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
export type Goal = 'bulk' | 'maintain' | 'cut'

export interface NutritionGoals {
  /** wizard completado */
  configured: boolean
  sex: Sex
  age: number
  heightCm: number
  activity: ActivityLevel
  goal: Goal
  /** objetivos finales, editables a mano tras el wizard */
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
}

interface NutritionState {
  goals: NutritionGoals
  setGoals: (patch: Partial<NutritionGoals>) => void
}

const defaultGoals: NutritionGoals = {
  configured: false,
  sex: 'male',
  age: 25,
  heightCm: 175,
  activity: 'moderate',
  goal: 'bulk',
  kcal: 2500,
  proteinG: 150,
  carbsG: 280,
  fatG: 70,
}

export const useNutrition = create<NutritionState>()(
  persist(
    (set) => ({
      goals: defaultGoals,
      setGoals: (patch) => set((s) => ({ goals: { ...s.goals, ...patch } })),
    }),
    { name: 'ferro-nutrition-goals' },
  ),
)

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentario (poco o nada de ejercicio)',
  light: 'Ligero (1-3 días/semana)',
  moderate: 'Moderado (3-5 días/semana)',
  active: 'Activo (6-7 días/semana)',
  very_active: 'Muy activo (2x al día / trabajo físico)',
}

export const GOAL_LABELS: Record<Goal, string> = {
  bulk: 'Ganar músculo (superávit)',
  maintain: 'Mantener',
  cut: 'Perder grasa (déficit)',
}
