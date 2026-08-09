/** Agrupación gruesa de los `target` del dataset para el análisis de volumen semanal. */
export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Pecho',
  back: 'Espalda',
  shoulders: 'Hombros',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  forearms: 'Antebrazos',
  abs: 'Abdominales',
  quads: 'Cuádriceps',
  hamstrings: 'Isquiotibiales',
  glutes: 'Glúteos',
  calves: 'Gemelos',
}

const TARGET_TO_GROUP: Record<string, MuscleGroup> = {
  pectorals: 'chest',
  'serratus anterior': 'chest',
  lats: 'back',
  'upper back': 'back',
  traps: 'back',
  spine: 'back',
  'levator scapulae': 'back',
  delts: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  abs: 'abs',
  quads: 'quads',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  abductors: 'glutes',
  adductors: 'glutes',
  calves: 'calves',
}

/** Volumen semanal recomendado por grupo (series efectivas), guía general de hipertrofia. */
export const RECOMMENDED_WEEKLY_SETS: Record<MuscleGroup, [number, number]> = {
  chest: [10, 20],
  back: [10, 20],
  shoulders: [8, 16],
  biceps: [8, 16],
  triceps: [8, 16],
  forearms: [4, 10],
  abs: [6, 16],
  quads: [10, 20],
  hamstrings: [8, 16],
  glutes: [8, 16],
  calves: [8, 16],
}

export type MuscleDoseState = 'none' | 'low' | 'optimal' | 'high'

/** Clasifica la dosis semanal contra el rango recomendado del propio músculo. */
export function classifyMuscleDose(group: MuscleGroup, value: number): MuscleDoseState {
  const [low, high] = RECOMMENDED_WEEKLY_SETS[group]
  if (value <= 0) return 'none'
  if (value < low) return 'low'
  if (value <= high) return 'optimal'
  return 'high'
}

export function groupFromTarget(target: string): MuscleGroup | null {
  return TARGET_TO_GROUP[target.toLowerCase()] ?? null
}

export const MUSCLE_GROUP_ORDER: MuscleGroup[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
]
