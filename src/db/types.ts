export type SetType = 'normal' | 'warmup' | 'failure' | 'drop'

export interface LoggedSet {
  type: SetType
  weightKg: number
  reps: number
  completed: boolean
}

export interface WorkoutExercise {
  exerciseId: string
  notes?: string
  restSec: number
  sets: LoggedSet[]
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
}

export interface Routine {
  id: string
  name: string
  sortOrder: number
  exercises: RoutineExercise[]
  createdAt: number
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
