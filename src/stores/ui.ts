import { create } from 'zustand'

export type HistoryView = 'list' | 'calendar'
export type NutritionView = 'diary' | 'trends'

interface UiState {
  libraryQuery: string
  libraryGroup: string | null
  libraryEquipment: string | null
  libraryOnlyCustom: boolean
  nutritionDate: string
  nutritionFollowsToday: boolean
  nutritionView: NutritionView
  progressPeriodWeeks: 4 | 8 | 12
  historyView: HistoryView
  set: (patch: Partial<Omit<UiState, 'set'>>) => void
}

const today = () => {
  const value = new Date()
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export const useUi = create<UiState>()((set) => ({
  libraryQuery: '',
  libraryGroup: null,
  libraryEquipment: null,
  libraryOnlyCustom: false,
  nutritionDate: today(),
  nutritionFollowsToday: true,
  nutritionView: 'diary',
  progressPeriodWeeks: 8,
  historyView: 'list',
  set: (patch) => set(patch),
}))
