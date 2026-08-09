import { db } from '../db/db'
import type {
  ExternalRef,
  Folder,
  ImportBatch,
  ImportEntity,
  ImportSource,
  Measurement,
  Routine,
  RoutineExercise,
  SetType,
  Workout,
  WorkoutExercise,
  LoggedSet,
  CustomExercise,
} from '../db/types'
import { uid, normalize, parseDec } from './format'
import { loadExercises } from '../data/exercises'
import { recalculateWorkoutHistory } from './stats'

export interface ImportSummary {
  batchId: string
  source: ImportSource
  counts: Partial<Record<ImportEntity, number>>
}

type HevySet = {
  index?: number
  type?: string
  weight_kg?: number | null
  reps?: number | null
  distance_meters?: number | null
  duration_seconds?: number | null
  rpe?: number | null
}
type HevyExercise = {
  index?: number
  title?: string
  notes?: string | null
  exercise_template_id?: number | string | null
  supersets_id?: number | null
  rest_seconds?: number | null
  sets?: HevySet[]
}
type HevyWorkout = {
  id?: string | number
  title?: string
  description?: string | null
  routine_id?: string | number | null
  start_time?: string
  end_time?: string
  exercises?: HevyExercise[]
}
type HevyRoutine = {
  id?: string | number
  title?: string
  folder_id?: string | number | null
  created_at?: string
  updated_at?: string
  exercises?: HevyExercise[]
}
type HevyFolder = { id?: string | number; index?: number; title?: string }
type HevyTemplate = {
  id?: string | number
  title?: string
  type?: string
  primary_muscle_group?: string
  equipment_category?: string
}

function asId(value: string | number | null | undefined, fallback: string): string {
  return value === undefined || value === null || value === '' ? fallback : String(value)
}

function asTime(value: string | number | undefined, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value
  const parsed = value ? Date.parse(String(value)) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function setType(value: string | undefined): SetType {
  const normalized = normalize(value ?? '')
  if (normalized.includes('warm')) return 'warmup'
  if (normalized.includes('drop')) return 'drop'
  if (normalized.includes('fail')) return 'failure'
  return 'normal'
}

function mapSet(input: HevySet): LoggedSet {
  return {
    type: setType(input.type),
    weightKg: Math.max(0, Number(input.weight_kg ?? 0) || 0),
    reps: Math.max(0, Math.round(Number(input.reps ?? 0) || 0)),
    completed: true,
    ...(input.rpe == null ? {} : { rpe: Number(input.rpe) }),
    ...(input.duration_seconds == null ? {} : { durationSec: Number(input.duration_seconds) }),
    ...(input.distance_meters == null ? {} : { distanceM: Number(input.distance_meters) }),
  }
}

function mapWorkout(input: HevyWorkout, exerciseMap: Map<string, string>): Workout {
  const startedAt = asTime(input.start_time)
  const endedAt = asTime(input.end_time, startedAt)
  const exercises: WorkoutExercise[] = (input.exercises ?? []).map((exercise, index) => ({
    exerciseId: exerciseMap.get(asId(exercise.exercise_template_id, normalize(exercise.title ?? `hevy-${index}`))) ?? `hevy-exercise-${asId(exercise.exercise_template_id, normalize(exercise.title ?? String(index)))}`,
    notes: exercise.notes ?? undefined,
    restSec: Math.max(0, Number(exercise.rest_seconds ?? 90) || 90),
    supersetGroup: exercise.supersets_id ?? undefined,
    sets: (exercise.sets ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(mapSet),
  }))
  return {
    id: `hevy-workout-${asId(input.id, `${startedAt}-${normalize(input.title ?? 'workout')}`)}`,
    name: input.title?.trim() || 'Entreno importado de Hevy',
    startedAt,
    endedAt: Math.max(startedAt, endedAt),
    exercises,
    volumeKg: 0,
    totalSets: 0,
    prs: [],
    notes: input.description?.trim() || undefined,
  }
}

function mapRoutine(input: HevyRoutine, exerciseMap: Map<string, string>, folderMap: Map<string, string>): Routine {
  const exercises: RoutineExercise[] = (input.exercises ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((exercise) => {
    const targets = (exercise.sets ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((s) => ({
      type: setType(s.type),
      ...(s.weight_kg == null ? {} : { weightKg: Number(s.weight_kg) }),
      ...(s.reps == null ? {} : { reps: Number(s.reps) }),
      ...(s.duration_seconds == null ? {} : { durationSec: Number(s.duration_seconds) }),
      ...(s.distance_meters == null ? {} : { distanceM: Number(s.distance_meters) }),
    }))
    return {
      exerciseId: exerciseMap.get(asId(exercise.exercise_template_id, normalize(exercise.title ?? 'exercise'))) ?? `hevy-exercise-${asId(exercise.exercise_template_id, normalize(exercise.title ?? 'exercise'))}`,
      plannedSets: Math.max(1, targets.length || 3),
      setTargets: targets.length ? targets : undefined,
      restSec: Math.max(0, Number(exercise.rest_seconds ?? 90) || 90),
      notes: exercise.notes ?? undefined,
      supersetGroup: exercise.supersets_id ?? undefined,
    }
  })
  return {
    id: `hevy-routine-${asId(input.id, normalize(input.title ?? 'routine'))}`,
    name: input.title?.trim() || 'Rutina importada de Hevy',
    sortOrder: asTime(input.updated_at ?? input.created_at),
    createdAt: asTime(input.created_at ?? input.updated_at),
    folderId: input.folder_id == null ? undefined : folderMap.get(String(input.folder_id)) ?? `hevy-folder-${input.folder_id}`,
    exercises,
  }
}

function materializeExercise(template: HevyTemplate, exerciseMap: Map<string, string>): CustomExercise {
  const external = asId(template.id, normalize(template.title ?? 'exercise'))
  const id = `hevy-exercise-${external}`
  exerciseMap.set(external, id)
  return {
    id,
    name: template.title?.trim() || `Ejercicio Hevy ${external}`,
    bodyPart: template.primary_muscle_group || 'other',
    equipment: template.equipment_category || 'other',
    target: template.primary_muscle_group || 'other',
    secondaryMuscles: [],
    createdAt: Date.now(),
  }
}

async function exerciseIdMap(templates: HevyTemplate[] = [], names: string[] = []): Promise<{ map: Map<string, string>; customs: CustomExercise[] }> {
  const map = new Map<string, string>()
  const customs: CustomExercise[] = []
  let catalog: Awaited<ReturnType<typeof loadExercises>> = []
  try { catalog = await loadExercises() } catch { /* el import sigue siendo utilizable offline */ }
  const byName = new Map(catalog.map((e) => [normalize(e.name), e.id]))
  for (const template of templates) {
    const external = asId(template.id, normalize(template.title ?? 'exercise'))
    const known = template.title ? byName.get(normalize(template.title)) : undefined
    if (known) map.set(external, known)
    else customs.push(materializeExercise(template, map))
  }
  for (const name of names) {
    const key = normalize(name)
    if (!key || map.has(key) || byName.has(key)) continue
    const custom = materializeExercise({ id: key, title: name }, map)
    customs.push(custom)
  }
  return { map, customs }
}

async function saveImport(source: ImportSource, records: { entity: ImportEntity; externalId: string; localId: string; value: unknown }[]): Promise<ImportSummary> {
  const incomingWorkouts = records.filter((record): record is typeof record & { value: Workout } => record.entity === 'workout').map((record) => record.value)
  if (incomingWorkouts.length) {
    const existing = await db.workouts.toArray()
    const incomingIds = new Set(incomingWorkouts.map((workout) => workout.id))
    const normalized = recalculateWorkoutHistory([...existing.filter((workout) => !incomingIds.has(workout.id)), ...incomingWorkouts])
    const byId = new Map(normalized.map((workout) => [workout.id, workout]))
    records = records.map((record) => record.entity === 'workout' ? { ...record, value: byId.get((record.value as Workout).id) ?? record.value } : record)
  }
  const batchId = uid()
  const counts: Partial<Record<ImportEntity, number>> = {}
  const batch: ImportBatch = { id: batchId, source, createdAt: Date.now(), status: 'completed', counts }
  const refs: ExternalRef[] = records.map((record) => ({ key: `${source}:${record.entity}:${record.externalId}`, source, entity: record.entity, externalId: record.externalId, localId: record.localId, batchId }))
  await db.transaction('rw', [db.workouts, db.routines, db.folders, db.measurements, db.customExercises, db.importBatches, db.externalRefs], async () => {
    for (const record of records) {
      const n = (counts[record.entity] ?? 0) + 1
      counts[record.entity] = n
      if (record.entity === 'workout') await db.workouts.put(record.value as Workout)
      else if (record.entity === 'routine') await db.routines.put(record.value as Routine)
      else if (record.entity === 'folder') await db.folders.put(record.value as Folder)
      else if (record.entity === 'measurement') await db.measurements.put(record.value as Measurement)
      else if (record.entity === 'exercise') await db.customExercises.put(record.value as CustomExercise)
    }
    await db.importBatches.put(batch)
    await db.externalRefs.bulkPut(refs)
  })
  return { batchId, source, counts }
}

export async function importHevyPayload(payload: { workouts?: HevyWorkout[]; routines?: HevyRoutine[]; folders?: HevyFolder[]; templates?: HevyTemplate[]; measurements?: unknown[] }, source: ImportSource): Promise<ImportSummary> {
  const names = [...(payload.workouts ?? []), ...(payload.routines ?? [])].flatMap((w) => (w.exercises ?? []).map((e) => e.title ?? ''))
  const { map, customs } = await exerciseIdMap(payload.templates, names)
  const folderMap = new Map<string, string>()
  const folders = (payload.folders ?? []).map((folder, index) => {
    const externalId = asId(folder.id, String(index))
    const id = `hevy-folder-${externalId}`
    folderMap.set(externalId, id)
    return { externalId, value: { id, name: folder.title?.trim() || 'Carpeta importada', sortOrder: folder.index ?? index } satisfies Folder }
  })
  const records: { entity: ImportEntity; externalId: string; localId: string; value: unknown }[] = customs.map((value) => ({ entity: 'exercise', externalId: value.id.replace(/^hevy-exercise-/, ''), localId: value.id, value }))
  records.push(...folders.map((folder) => ({ entity: 'folder' as const, externalId: folder.externalId, localId: folder.value.id, value: folder.value })))
  records.push(...(payload.routines ?? []).map((value) => {
    const mapped = mapRoutine(value, map, folderMap)
    return { entity: 'routine' as const, externalId: asId(value.id, mapped.id), localId: mapped.id, value: mapped }
  }))
  records.push(...(payload.workouts ?? []).map((value) => {
    const mapped = mapWorkout(value, map)
    return { entity: 'workout' as const, externalId: asId(value.id, mapped.id), localId: mapped.id, value: mapped }
  }))
  // Measurements are intentionally tolerant: Hevy has changed field names between exports.
  for (const raw of payload.measurements ?? []) {
    const r = raw as Record<string, unknown>
    const value = Number(r.value ?? r.measurement_value ?? r.amount)
    if (!Number.isFinite(value)) continue
    const kind = normalize(String(r.type ?? r.measurement_type ?? r.name ?? 'weight')).replace(/\s+/g, '_') as Measurement['kind']
    const date = asTime((r.date ?? r.measured_at ?? r.created_at) as string | number | undefined)
    const externalId = asId(r.id as string | number | undefined, `${kind}-${date}`)
    const mapped: Measurement = { id: `hevy-measurement-${externalId}`, date, kind, value }
    records.push({ entity: 'measurement', externalId, localId: mapped.id, value: mapped })
  }
  if (!records.length) throw new Error('Hevy no devolvió datos importables.')
  return saveImport(source, records)
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim()))
}

function col(headers: string[], ...names: string[]): number {
  const normalized = headers.map((h) => normalize(h).replace(/[^a-z0-9]/g, ''))
  return names.map((n) => normalized.indexOf(normalize(n).replace(/[^a-z0-9]/g, ''))).find((i) => i >= 0) ?? -1
}

export function parseHevyCsv(text: string): { workouts: HevyWorkout[]; templates: HevyTemplate[] } {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('El CSV de Hevy no contiene filas.')
  const headers = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim())
  const workoutIndex = col(headers, 'workout_id', 'workout id', 'id')
  const workoutTitle = col(headers, 'workout_title', 'workout title', 'workout', 'title')
  const start = col(headers, 'start_time', 'start time', 'date', 'start')
  const end = col(headers, 'end_time', 'end time', 'end')
  const exerciseId = col(headers, 'exercise_template_id', 'exercise id')
  const exerciseTitle = col(headers, 'exercise_title', 'exercise title', 'exercise')
  const setTypeIndex = col(headers, 'set_type', 'type')
  const weight = col(headers, 'weight_kg', 'weight (kg)', 'weight')
  const reps = col(headers, 'reps', 'repetitions')
  const distance = col(headers, 'distance_meters', 'distance')
  const duration = col(headers, 'duration_seconds', 'duration')
  const rpe = col(headers, 'rpe')
  if (workoutTitle < 0 && workoutIndex < 0) throw new Error('No se encontró una columna de entreno en el CSV de Hevy.')
  const byWorkout = new Map<string, HevyWorkout>()
  const templates = new Map<string, HevyTemplate>()
  rows.slice(1).forEach((row, rowIndex) => {
    const external = (workoutIndex >= 0 ? row[workoutIndex] : '')?.trim() || `${row[start] ?? rowIndex}-${row[workoutTitle] ?? 'workout'}`
    const workout: HevyWorkout = byWorkout.get(external) ?? { id: external, title: row[workoutTitle]?.trim() || 'Entreno importado de Hevy', start_time: row[start], end_time: row[end], exercises: [] }
    const title = row[exerciseTitle]?.trim() || `Ejercicio ${row[exerciseId] || rowIndex + 1}`
    const templateExternal = row[exerciseId]?.trim() || normalize(title)
    templates.set(templateExternal, { id: templateExternal, title })
    const existing = workout.exercises!.find((e) => asId(e.exercise_template_id, '') === templateExternal && e.title === title)
    const exercise = existing ?? { index: workout.exercises!.length, title, exercise_template_id: templateExternal, sets: [] }
    exercise.sets!.push({ index: exercise.sets!.length, type: setType(row[setTypeIndex]), weight_kg: parseDec(row[weight] ?? '0'), reps: Math.round(parseDec(row[reps] ?? '0')), distance_meters: distance >= 0 ? parseDec(row[distance] ?? '0') : undefined, duration_seconds: duration >= 0 ? parseDec(row[duration] ?? '0') : undefined, rpe: rpe >= 0 ? parseDec(row[rpe] ?? '') : undefined })
    if (!existing) workout.exercises!.push(exercise)
    byWorkout.set(external, workout)
  })
  return { workouts: [...byWorkout.values()], templates: [...templates.values()] }
}

const HEVY_API = 'https://api.hevyapp.com/v1'
async function hevyJson<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${HEVY_API}${path}`, { headers: { 'api-key': apiKey, Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Hevy API respondió HTTP ${response.status}.`)
  return response.json() as Promise<T>
}

async function page<T>(path: string, apiKey: string, key: string): Promise<T[]> {
  const all: T[] = []
  for (let p = 1; p <= 10_000; p++) {
    const response = await hevyJson<Record<string, unknown>>(`${path}${path.includes('?') ? '&' : '?'}page=${p}&pageSize=10`, apiKey)
    const items = Array.isArray(response[key]) ? response[key] as T[] : []
    all.push(...items)
    const pages = Number(response.page_count ?? response.pageCount ?? p)
    if (!items.length || p >= pages) break
  }
  return all
}

export async function importHevyApi(apiKey: string): Promise<ImportSummary> {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('Introduce tu API key de Hevy.')
  const [workouts, routines, folders, templates, measurementResponse] = await Promise.all([
    page<HevyWorkout>('/workouts', trimmed, 'workouts'),
    page<HevyRoutine>('/routines', trimmed, 'routines'),
    hevyJson<HevyFolder[]>('/routine_folders', trimmed).catch(() => []),
    page<HevyTemplate>('/exercise_templates', trimmed, 'exercise_templates').catch(() => []),
    hevyJson<unknown | { body_measurements?: unknown[] }>('/body_measurements', trimmed).catch(() => []),
  ])
  const measurements = Array.isArray(measurementResponse)
    ? measurementResponse
    : Array.isArray((measurementResponse as { body_measurements?: unknown[] })?.body_measurements)
      ? (measurementResponse as { body_measurements: unknown[] }).body_measurements
      : []
  return importHevyPayload({ workouts, routines, folders, templates, measurements }, 'hevy-api')
}

export async function importHevyCsvFile(file: File): Promise<ImportSummary> {
  return importHevyCsv(await file.text())
}

export async function importHevyCsv(text: string): Promise<ImportSummary> {
  return importHevyPayload(parseHevyCsv(text), 'hevy-csv')
}

export async function undoImport(batchId: string): Promise<void> {
  const batch = await db.importBatches.get(batchId)
  if (!batch || batch.status === 'undone') return
  const refs = await db.externalRefs.where('batchId').equals(batchId).toArray()
  await db.transaction('rw', [db.workouts, db.routines, db.folders, db.measurements, db.customExercises, db.importBatches, db.externalRefs], async () => {
    for (const ref of refs) {
      if (ref.entity === 'workout') await db.workouts.delete(ref.localId)
      else if (ref.entity === 'routine') await db.routines.delete(ref.localId)
      else if (ref.entity === 'folder') await db.folders.delete(ref.localId)
      else if (ref.entity === 'measurement') await db.measurements.delete(ref.localId)
      else if (ref.entity === 'exercise') await db.customExercises.delete(ref.localId)
    }
    await db.importBatches.update(batchId, { status: 'undone' })
  })
}
