import { z } from 'zod'

const finite = z.number().finite()
const nonEmpty = z.string().trim().min(1)

const loggedSetSchema = z.object({
  type: z.enum(['normal', 'warmup', 'failure', 'drop']),
  weightKg: finite,
  reps: finite,
  completed: z.boolean(),
  rpe: finite.optional(),
  durationSec: finite.optional(),
  distanceM: finite.optional(),
})

const workoutExerciseSchema = z.object({
  exerciseId: nonEmpty,
  notes: z.string().optional(),
  restSec: finite,
  sets: z.array(loggedSetSchema),
  supersetGroup: finite.optional(),
})

const prSchema = z.object({
  exerciseId: nonEmpty,
  kind: z.enum(['weight', 'e1rm', 'setVolume']),
  value: finite,
  prev: finite.optional(),
})

const plannedSetSchema = z.object({
  type: z.enum(['normal', 'warmup', 'failure', 'drop']),
  weightKg: finite.optional(),
  reps: finite.optional(),
  durationSec: finite.optional(),
  distanceM: finite.optional(),
})

const routineExerciseSchema = z.object({
  exerciseId: nonEmpty,
  plannedSets: finite,
  setTargets: z.array(plannedSetSchema).optional(),
  restSec: finite,
  notes: z.string().optional(),
  supersetGroup: finite.optional(),
  repRangeMin: finite.optional(),
  repRangeMax: finite.optional(),
})

export const workoutSchema = z.object({
  id: nonEmpty,
  name: z.string(),
  startedAt: finite,
  endedAt: finite,
  exercises: z.array(workoutExerciseSchema),
  volumeKg: finite,
  totalSets: finite,
  prs: z.array(prSchema),
  notes: z.string().optional(),
})

const routineSchema = z.object({
  id: nonEmpty,
  name: z.string(),
  sortOrder: finite,
  exercises: z.array(routineExerciseSchema),
  createdAt: finite,
  folderId: z.string().optional(),
})

const folderSchema = z.object({ id: nonEmpty, name: z.string(), sortOrder: finite })
const customExerciseSchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  bodyPart: z.string(),
  equipment: z.string(),
  target: z.string(),
  secondaryMuscles: z.array(z.string()),
  createdAt: finite,
})
const measurementSchema = z.object({
  id: nonEmpty,
  date: finite,
  kind: z.enum([
    'weight',
    'bodyfat',
    'neck',
    'shoulders',
    'chest',
    'arm_l',
    'arm_r',
    'forearm_l',
    'forearm_r',
    'waist',
    'hips',
    'thigh_l',
    'thigh_r',
    'calf_l',
    'calf_r',
  ]),
  value: finite,
})
const foodSchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  brand: z.string().optional(),
  source: z.enum(['custom', 'off', 'seed', 'usda']),
  offCode: z.string().optional(),
  usdaFdcId: z.number().int().positive().optional(),
  aliases: z.array(z.string()).optional(),
  kcal100: finite,
  p100: finite,
  c100: finite,
  f100: finite,
  servingG: finite.optional(),
  favorite: z.boolean().optional(),
  usedAt: finite.optional(),
})
const dishItemSchema = z.object({
  foodId: z.string().optional(),
  name: nonEmpty,
  grams: finite,
  kcal: finite,
  p: finite,
  c: finite,
  f: finite,
})
const dishSchema = z.object({ id: nonEmpty, name: nonEmpty, items: z.array(dishItemSchema), createdAt: finite })
const foodLogSchema = z.object({
  id: nonEmpty,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  foodId: z.string().optional(),
  name: nonEmpty,
  grams: finite,
  kcal: finite,
  p: finite,
  c: finite,
  f: finite,
})

const importBatchSchema = z.object({
  id: nonEmpty,
  source: z.enum(['hevy-csv', 'hevy-api']),
  createdAt: finite,
  status: z.enum(['completed', 'undone']),
  counts: z.record(z.string(), finite).optional(),
})
const externalRefSchema = z.object({
  key: nonEmpty,
  source: z.enum(['hevy-csv', 'hevy-api']),
  entity: z.enum(['workout', 'routine', 'folder', 'measurement', 'exercise']),
  externalId: nonEmpty,
  localId: nonEmpty,
  batchId: nonEmpty,
})

const settingsSchema = z.object({
  units: z.enum(['kg', 'lb']).optional(),
  defaultRestSec: finite.optional(),
  sound: z.boolean().optional(),
  vibration: z.boolean().optional(),
  restNotification: z.boolean().optional(),
  keepAwake: z.boolean().optional(),
  trackRpe: z.boolean().optional(),
  weeklyGoal: finite.optional(),
  barWeightKg: finite.optional(),
  platesKg: z.array(finite).optional(),
})
const nutritionGoalsSchema = z.object({
  configured: z.boolean().optional(),
  sex: z.enum(['male', 'female']).optional(),
  age: finite.optional(),
  heightCm: finite.optional(),
  activity: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']).optional(),
  goal: z.enum(['bulk', 'maintain', 'cut']).optional(),
  kcal: finite.optional(),
  proteinG: finite.optional(),
  carbsG: finite.optional(),
  fatG: finite.optional(),
})

export const backupSchema = z.object({
  app: z.literal('ferro'),
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  exportedAt: z.string(),
  settings: settingsSchema.optional(),
  nutritionGoals: nutritionGoalsSchema.optional(),
  workouts: z.array(workoutSchema),
  routines: z.array(routineSchema),
  customExercises: z.array(customExerciseSchema),
  folders: z.array(folderSchema).optional(),
  measurements: z.array(measurementSchema).optional(),
  foods: z.array(foodSchema).optional(),
  dishes: z.array(dishSchema).optional(),
  foodLog: z.array(foodLogSchema).optional(),
  importBatches: z.array(importBatchSchema).optional(),
  externalRefs: z.array(externalRefSchema).optional(),
})

export const photosBackupSchema = z.object({
  app: z.literal('ferro-photos'),
  version: z.literal(1),
  exportedAt: z.string(),
  photos: z.array(
    z.object({
      id: nonEmpty,
      date: finite,
      note: z.string().optional(),
      dataUrl: z.string().regex(/^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i),
    }),
  ),
})

export type ValidBackup = z.infer<typeof backupSchema>
