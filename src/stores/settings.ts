import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SettingsValues {
  units: 'kg' | 'lb'
  defaultRestSec: number
  sound: boolean
  vibration: boolean
  restNotification: boolean
  keepAwake: boolean
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
      update: (patch) => set(patch),
    }),
    { name: 'ferro-settings' },
  ),
)
