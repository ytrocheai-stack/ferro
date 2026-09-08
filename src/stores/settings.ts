import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SettingsValues {
  units: 'kg' | 'lb'
  defaultRestSec: number
  sound: boolean
  vibration: boolean
  restNotification: boolean
  keepAwake: boolean
  /** registrar RPE por serie */
  trackRpe: boolean
  /** registrar RIR por serie, separado de RPE */
  trackRir: boolean
  /** entrenos objetivo por semana */
  weeklyGoal: number
  /** calculadora de discos */
  barWeightKg: number
  platesKg: number[]
}

interface SettingsState extends SettingsValues {
  update: (patch: Partial<SettingsValues>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      units: 'kg',
      defaultRestSec: 90,
      sound: true,
      vibration: true,
      restNotification: true,
      keepAwake: true,
      trackRpe: false,
      trackRir: false,
      weeklyGoal: 4,
      barWeightKg: 20,
      platesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
      update: (patch) => set(patch),
    }),
    { name: 'ferro-settings' },
  ),
)
