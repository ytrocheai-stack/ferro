export type SetType = 'normal' | 'warmup' | 'failure' | 'drop'

export interface LoggedSet {
  type: SetType
  weightKg: number
  reps: number
  completed: boolean
  /** RPE 6–10 (medios permitidos); solo si el usuario activa el registro */
  rpe?: number
  /** cardio: duración en segundos */
  durationSec?: number
  /** cardio: distancia en metros */
  distanceM?: number
}

export interface WorkoutExercise {
  exerciseId: string
  notes?: string
  restSec: number
  sets: LoggedSet[]
  /** ejercicios con el mismo número forman una superserie */
  supersetGroup?: number
}

export type PRKind = 'weight' | 'e1rm' | 'setVolume'

export interface PR {
  exerciseId: string
  kind: PRKind
  value: number
  prev?: number
}

export interface Workout {
  id: string
  name: string
  startedAt: number
  endedAt: number
  exercises: WorkoutExercise[]
  volumeKg: number
  totalSets: number
  prs: PR[]
  notes?: string
}

export interface RoutineExercise {
  exerciseId: string
  plannedSets: number
  restSec: number
  notes?: string
  supersetGroup?: number
  /** rango de reps objetivo para doble progresión (default 8–12) */
  repRangeMin?: number
  repRangeMax?: number
}

export interface Routine {
  id: string
  name: string
  sortOrder: number
  exercises: RoutineExercise[]
  createdAt: number
  folderId?: string
}

export interface Folder {
  id: string
  name: string
  sortOrder: number
}

export interface CustomExercise {
  id: string // 'custom-…'
  name: string
  bodyPart: string
  equipment: string
  target: string
  secondaryMuscles: string[]
  createdAt: number
}

// ── Medidas corporales ────────────────────────────────────────────────

export type MeasurementKind =
  | 'weight'
  | 'bodyfat'
  | 'neck'
  | 'shoulders'
  | 'chest'
  | 'arm_l'
  | 'arm_r'
  | 'forearm_l'
  | 'forearm_r'
  | 'waist'
  | 'hips'
  | 'thigh_l'
  | 'thigh_r'
  | 'calf_l'
  | 'calf_r'

/** value: kg para weight, % para bodyfat, cm para el resto */
export interface Measurement {
  id: string
  date: number
  kind: MeasurementKind
  value: number
}

export interface ProgressPhoto {
  id: string
  date: number
  blob: Blob
  note?: string
}

// ── Nutrición ─────────────────────────────────────────────────────────

/** Alimento guardado en Dexie: propio del usuario o cacheado de Open Food Facts.
 *  (Los ~250 alimentos base viven en un JSON estático, no en Dexie.) */
export interface Food {
  id: string
  name: string
  brand?: string
  source: 'custom' | 'off'
  /** código de barras (productos OFF) */
  offCode?: string
  kcal100: number
  p100: number
  c100: number
  f100: number
  /** gramos de la porción típica */
  servingG?: number
  favorite?: boolean
  /** última vez usado, para "recientes" */
  usedAt?: number
}

export interface DishItem {
  foodId: string
  name: string
  grams: number
  kcal: number
  p: number
  c: number
  f: number
}

/** Plato: combinación de alimentos con nombre (macros denormalizados) */
export interface Dish {
  id: string
  name: string
  items: DishItem[]
  createdAt: number
}

export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/** Entrada del diario. Macros ya calculados (robusto a borrar el alimento origen). */
export interface FoodLogEntry {
  id: string
  /** 'YYYY-MM-DD' local */
  date: string
  meal: MealKey
  foodId?: string
  name: string
  grams: number
  kcal: number
  p: number
  c: number
  f: number
}
