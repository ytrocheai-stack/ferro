import { db } from '../db/db'
import type {
  ExternalRef,
  Folder,
  ImportChange,
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
} from '../db/types'
import { uid, normalize, parseDec } from './format'
import { loadExercises } from '../data/exercises'
import { recalculateWorkoutHistory } from './stats'
import { datasetExerciseIdForHevyName } from './hevyAliases'

export interface ImportAnomaly {
  kind: 'duration'
  workoutId: string
  name: string
  hours: number
}

export interface ImportSummary {
  batchId: string
  source: ImportSource
  counts: Partial<Record<ImportEntity, number>>
  sets: number
  mappedExercises: number
  anomalies: ImportAnomaly[]
  unclassifiedExercises: string[]
}

type HevySet = {
  index?: number
  type?: string
  weight_kg?: number | null
  reps?: number | null
  distance_meters?: number | null
  distance_km?: number | null
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

const HEVY_MONTHS: Record<string, number> = {
  ene: 0, enero: 0,
  feb: 1, febrero: 1,
  mar: 2, marzo: 2,
  abr: 3, abril: 3,
  may: 4, mayo: 4,
  jun: 5, junio: 5,
  jul: 6, julio: 6,
  ago: 7, agosto: 7,
  sep: 8, sept: 8, septiembre: 8, setiembre: 8,
  oct: 9, octubre: 9,
  nov: 10, noviembre: 10,
  dic: 11, diciembre: 11,
}

function parseHevyTime(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  const localized = raw.match(/^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u)
  if (localized) {
    const month = HEVY_MONTHS[normalize(localized[2])]
    if (month === undefined) return undefined
    const date = new Date(
      Number(localized[3]),
      month,
      Number(localized[1]),
      Number(localized[4] ?? 0),
      Number(localized[5] ?? 0),
      Number(localized[6] ?? 0),
    )
    if (
      date.getFullYear() !== Number(localized[3]) ||
      date.getMonth() !== month ||
      date.getDate() !== Number(localized[1])
    ) return undefined
    return date.getTime()
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function asTime(value: string | number | undefined, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value
  return parseHevyTime(value) ?? fallback
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

async function exerciseIdMap(templates: HevyTemplate[] = [], usedExercises: HevyExercise[] = []): Promise<{ map: Map<string, string>; unclassifiedExercises: string[]; mappedExercises: number }> {
  const map = new Map<string, string>()
  const unclassifiedExercises = new Set<string>()
  const names = usedExercises.map((exercise) => exercise.title ?? '')
  const usedTemplateIds = new Set(usedExercises.map((exercise) => asId(exercise.exercise_template_id, normalize(exercise.title ?? 'exercise'))))
  let catalog: Awaited<ReturnType<typeof loadExercises>> = []
  try { catalog = await loadExercises() } catch { /* el import sigue siendo utilizable offline */ }
  const byName = new Map<string, string>()
  for (const exercise of catalog) {
    byName.set(normalize(exercise.name), exercise.id)
    for (const alias of exercise.aliases ?? []) byName.set(normalize(alias), exercise.id)
  }
  const resolve = (title: string | undefined): string | undefined => {
    if (!title) return undefined
    return datasetExerciseIdForHevyName(title) ?? byName.get(normalize(title))
  }
  for (const template of templates) {
    const external = asId(template.id, normalize(template.title ?? 'exercise'))
    const titleKey = template.title ? normalize(template.title) : ''
    const used = usedTemplateIds.has(external) || (!!titleKey && names.some((name) => normalize(name) === titleKey))
    if (!used) continue
    const known = resolve(template.title)
    if (known) map.set(external, known)
    else unclassifiedExercises.add(template.title?.trim() || external)
  }
  for (const exercise of usedExercises) {
    const name = exercise.title ?? ''
    const key = asId(exercise.exercise_template_id, normalize(name))
    if (!key) continue
    if (map.has(key)) continue
    const known = resolve(name)
    if (known) map.set(key, known)
    else unclassifiedExercises.add(name.trim())
  }
  return { map, unclassifiedExercises: [...unclassifiedExercises].filter(Boolean).sort(), mappedExercises: new Set(map.values()).size }
}

function tableFor(entity: ImportEntity) {
  if (entity === 'workout') return db.workouts
  if (entity === 'routine') return db.routines
  if (entity === 'folder') return db.folders
  if (entity === 'measurement') return db.measurements
  return db.customExercises
}

function equalValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function saveImport(
  source: ImportSource,
  records: { entity: ImportEntity; externalId: string; localId: string; value: unknown }[],
  options: { unclassifiedExercises?: string[]; mappedExercises?: number; anomalies?: ImportAnomaly[] } = {},
): Promise<ImportSummary> {
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
  const changes: ImportChange[] = []
  const refs: ExternalRef[] = records.map((record) => ({ key: `${source}:${record.entity}:${record.externalId}`, source, entity: record.entity, externalId: record.externalId, localId: record.localId, batchId }))
  const batch: ImportBatch = { id: batchId, source, createdAt: Date.now(), status: 'completed', counts, changes }
  await db.transaction('rw', [db.workouts, db.routines, db.folders, db.measurements, db.customExercises, db.importBatches, db.externalRefs], async () => {
    for (const record of records) {
      const table = tableFor(record.entity)
      const previous = await table.get(record.localId)
      const previousRef = await db.externalRefs.get(`${source}:${record.entity}:${record.externalId}`)
      changes.push({ entity: record.entity, localId: record.localId, written: record.value, ...(previous === undefined ? {} : { previous }), ...(previousRef ? { previousRef } : {}) })
      counts[record.entity] = (counts[record.entity] ?? 0) + 1
      await table.put(record.value as never)
    }
    await db.importBatches.put(batch)
    await db.externalRefs.bulkPut(refs)
  })
  const sets = incomingWorkouts.reduce((sum, workout) => sum + workout.exercises.reduce((n, exercise) => n + exercise.sets.length, 0), 0)
  return { batchId, source, counts, sets, mappedExercises: options.mappedExercises ?? 0, anomalies: options.anomalies ?? [], unclassifiedExercises: options.unclassifiedExercises ?? [] }
}

export async function importHevyPayload(payload: { workouts?: HevyWorkout[]; routines?: HevyRoutine[]; folders?: HevyFolder[]; templates?: HevyTemplate[]; measurements?: unknown[] }, source: ImportSource): Promise<ImportSummary> {
  const usedExercises = [...(payload.workouts ?? []), ...(payload.routines ?? [])].flatMap((w) => w.exercises ?? [])
  const { map, unclassifiedExercises, mappedExercises } = await exerciseIdMap(payload.templates, usedExercises)
  if (unclassifiedExercises.length) {
    throw new Error(`No se pudieron vincular estos ejercicios con el catálogo: ${unclassifiedExercises.join(', ')}. No se importó ningún registro.`)
  }
  const folderMap = new Map<string, string>()
  const folders = (payload.folders ?? []).map((folder, index) => {
    const externalId = asId(folder.id, String(index))
    const id = `hevy-folder-${externalId}`
    folderMap.set(externalId, id)
    return { externalId, value: { id, name: folder.title?.trim() || 'Carpeta importada', sortOrder: folder.index ?? index } satisfies Folder }
  })
  const records: { entity: ImportEntity; externalId: string; localId: string; value: unknown }[] = []
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
  const anomalies: ImportAnomaly[] = (payload.workouts ?? []).flatMap((workout) => {
    const startedAt = parseHevyTime(workout.start_time)
    const endedAt = parseHevyTime(workout.end_time)
    if (startedAt === undefined || endedAt === undefined || endedAt <= startedAt) return []
    const hours = (endedAt - startedAt) / 3_600_000
    if (hours <= 12) return []
    return [{ kind: 'duration' as const, workoutId: asId(workout.id, normalize(workout.title ?? 'workout')), name: workout.title?.trim() || 'Entreno importado de Hevy', hours }]
  })
  return saveImport(source, records, { unclassifiedExercises, mappedExercises, anomalies })
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

type CellValue = string | number | boolean | Date | null | undefined

function cell(row: CellValue[], index: number): string {
  if (index < 0) return ''
  const value = row[index]
  if (value instanceof Date) return value.toISOString()
  return value == null ? '' : String(value).trim()
}

function optionalDecimal(row: CellValue[], index: number): number | undefined {
  const raw = cell(row, index)
  if (!raw) return undefined
  const value = parseDec(raw)
  return Number.isFinite(value) ? value : undefined
}

function hasHevyHeaders(headers: CellValue[] | undefined): boolean {
  if (!headers?.length) return false
  const normalized = headers.map((value) => normalize(String(value ?? '')).replace(/[^a-z0-9]/g, ''))
  return normalized.includes('starttime') && (normalized.includes('title') || normalized.includes('workouttitle')) && normalized.includes('exercisetitle')
}

function parseHevyRows(rows: CellValue[][]): { workouts: HevyWorkout[]; templates: HevyTemplate[] } {
  if (rows.length < 2) throw new Error('El CSV de Hevy no contiene filas.')
  const headers = rows[0].map((h) => String(h ?? '').replace(/^\uFEFF/, '').trim())
  const workoutIndex = col(headers, 'workout_id', 'workout id', 'workoutid', 'id')
  const workoutTitle = col(headers, 'workout_title', 'workout title', 'workout', 'title', 'name')
  const start = col(headers, 'start_time', 'start time', 'date', 'start')
  const end = col(headers, 'end_time', 'end time', 'end')
  const exerciseId = col(headers, 'exercise_template_id', 'exercise template id', 'exercise id')
  const exerciseTitle = col(headers, 'exercise_title', 'exercise title', 'exercise')
  const exerciseNotes = col(headers, 'exercise_notes', 'exercise notes', 'notes')
  const superset = col(headers, 'superset_id', 'supersets_id', 'superset id')
  const setIndex = col(headers, 'set_index', 'set index', 'set')
  const setTypeIndex = col(headers, 'set_type', 'set type', 'type')
  const weight = col(headers, 'weight_kg', 'weight (kg)', 'weight')
  const reps = col(headers, 'reps', 'repetitions')
  const distanceMeters = col(headers, 'distance_meters', 'distance meters')
  const distanceKm = col(headers, 'distance_km', 'distance km', 'distance kilometers')
  const distance = col(headers, 'distance')
  const description = col(headers, 'description', 'workout notes', 'workout description')
  const duration = col(headers, 'duration_seconds', 'duration seconds', 'duration')
  const rpe = col(headers, 'rpe')
  if (workoutTitle < 0 && workoutIndex < 0) {
    throw new Error(`No se encontró una columna de entreno en el CSV de Hevy. Encabezados detectados: ${headers.join(', ')}`)
  }
  if (start < 0) throw new Error('El CSV de Hevy no contiene una columna de fecha de inicio (start_time).')
  if (exerciseTitle < 0) throw new Error('El CSV de Hevy no contiene una columna de ejercicio (exercise_title).')
  const byWorkout = new Map<string, HevyWorkout>()
  const templates = new Map<string, HevyTemplate>()
  rows.slice(1).forEach((row, rowIndex) => {
    const startValue = cell(row, start)
    if (!startValue) throw new Error(`Fila ${rowIndex + 2}: falta start_time.`)
    if (parseHevyTime(startValue) === undefined) throw new Error(`Fila ${rowIndex + 2}: fecha de inicio inválida "${startValue}".`)
    const endValue = cell(row, end)
    if (endValue && parseHevyTime(endValue) === undefined) throw new Error(`Fila ${rowIndex + 2}: fecha de fin inválida "${endValue}".`)
    const workoutName = cell(row, workoutTitle)
    if (!workoutName && workoutIndex < 0) throw new Error(`Fila ${rowIndex + 2}: falta el título del entreno.`)
    const title = cell(row, exerciseTitle)
    if (!title) throw new Error(`Fila ${rowIndex + 2}: falta el título del ejercicio.`)
    const external = cell(row, workoutIndex) || `${startValue}-${workoutName || 'workout'}`
    const workout: HevyWorkout = byWorkout.get(external) ?? {
      id: external,
      title: workoutName || 'Entreno importado de Hevy',
      description: cell(row, description) || undefined,
      start_time: startValue,
      end_time: endValue || undefined,
      exercises: [],
    }
    if (!workout.description && cell(row, description)) workout.description = cell(row, description)
    if (!workout.end_time && endValue) workout.end_time = endValue
    const templateExternal = cell(row, exerciseId) || normalize(title)
    templates.set(templateExternal, { id: templateExternal, title })
    const existing = workout.exercises!.find((e) => asId(e.exercise_template_id, '') === templateExternal && e.title === title)
    const exercise = existing ?? {
      index: workout.exercises!.length,
      title,
      exercise_template_id: templateExternal,
      notes: cell(row, exerciseNotes) || undefined,
      supersets_id: optionalDecimal(row, superset),
      sets: [],
    }
    if (!exercise.notes && cell(row, exerciseNotes)) exercise.notes = cell(row, exerciseNotes)
    if (exercise.supersets_id == null) exercise.supersets_id = optionalDecimal(row, superset)
    const distanceValue = optionalDecimal(row, distanceMeters)
      ?? ((optionalDecimal(row, distanceKm) ?? 0) * 1000 || undefined)
      ?? optionalDecimal(row, distance)
    exercise.sets!.push({
      index: optionalDecimal(row, setIndex) ?? exercise.sets!.length,
      type: setType(cell(row, setTypeIndex)),
      weight_kg: optionalDecimal(row, weight) ?? 0,
      reps: Math.round(optionalDecimal(row, reps) ?? 0),
      distance_meters: distanceValue,
      duration_seconds: optionalDecimal(row, duration),
      rpe: optionalDecimal(row, rpe),
    })
    if (!existing) workout.exercises!.push(exercise)
    byWorkout.set(external, workout)
  })
  for (const workout of byWorkout.values()) {
    for (const exercise of workout.exercises ?? []) {
      exercise.sets?.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    }
  }
  return { workouts: [...byWorkout.values()], templates: [...templates.values()] }
}

export function parseHevyCsv(text: string): { workouts: HevyWorkout[]; templates: HevyTemplate[] } {
  return parseHevyRows(parseCsv(text))
}

const MAX_HEVY_FILE_BYTES = 20 * 1024 * 1024

async function parseHevyXlsx(file: File): Promise<{ workouts: HevyWorkout[]; templates: HevyTemplate[] }> {
  const module = await import('read-excel-file/browser')
  const readXlsxFile = module.default
  const workbook = await readXlsxFile(file)
  const sheets = Array.isArray(workbook) ? workbook : [workbook]
  for (const sheet of sheets) {
    const rows = (sheet as { data?: unknown[][] }).data as CellValue[][] | undefined
    if (rows?.length && hasHevyHeaders(rows[0])) return parseHevyRows(rows)
  }
  throw new Error('El XLSX no contiene una hoja con el formato de exportación de Hevy.')
}

function isZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

export async function importHevyFile(file: File): Promise<ImportSummary> {
  if (file.size > MAX_HEVY_FILE_BYTES) throw new Error('El archivo de Hevy supera el límite de 20 MB.')
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  const extension = file.name.toLowerCase().split('.').pop() ?? ''
  const isXlsx = extension === 'xlsx' || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || isZipSignature(head)
  if (isXlsx) {
    if (!isZipSignature(head)) throw new Error('El archivo indicado como XLSX no es un Excel válido o está corrupto.')
    try {
      return await importHevyPayload(await parseHevyXlsx(file), 'hevy-csv')
    } catch (error) {
      if (error instanceof Error && (error.message.startsWith('No se pudieron') || error.message.startsWith('Hevy no devolvió') || error.message.startsWith('Fila') || error.message.startsWith('El CSV'))) throw error
      throw new Error('No se pudo leer el XLSX de Hevy. Verifica que sea un Excel válido exportado por Hevy.', { cause: error })
    }
  }
  const text = await file.text()
  if (text.startsWith('PK')) throw new Error('El archivo parece Excel (XLSX), no CSV. Selecciona un CSV o XLSX válido de Hevy.')
  return importHevyCsv(text)
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
  return importHevyFile(file)
}

export async function importHevyCsv(text: string): Promise<ImportSummary> {
  return importHevyPayload(parseHevyCsv(text), 'hevy-csv')
}

export async function undoImport(batchId: string): Promise<void> {
  const batch = await db.importBatches.get(batchId)
  if (!batch || batch.status === 'undone') return
  if (batch.changes?.length) {
    const refs = await db.externalRefs.where('batchId').equals(batchId).toArray()
    await db.transaction('rw', [db.workouts, db.routines, db.folders, db.measurements, db.customExercises, db.importBatches, db.externalRefs], async () => {
      for (const change of batch.changes ?? []) {
        const current = await tableFor(change.entity).get(change.localId)
        const expectedRef = refs.find((ref) => ref.entity === change.entity && ref.localId === change.localId)
        const currentRef = expectedRef ? await db.externalRefs.get(expectedRef.key) : undefined
        if (!equalValue(current, change.written) || (expectedRef && currentRef?.batchId !== batchId)) {
          throw new Error('No se puede deshacer la importación porque uno de sus registros fue modificado después.')
        }
      }
      for (const change of batch.changes ?? []) {
        const table = tableFor(change.entity)
        if (change.previous === undefined) await table.delete(change.localId)
        else await table.put(change.previous as never)
        const currentRef = refs.find((ref) => ref.entity === change.entity && ref.localId === change.localId)
        if (currentRef) {
          if (change.previousRef) await db.externalRefs.put(change.previousRef)
          else await db.externalRefs.delete(currentRef.key)
        }
      }
      await db.importBatches.update(batchId, { status: 'undone' })
    })
    const workouts = await db.workouts.toArray()
    await db.workouts.bulkPut(recalculateWorkoutHistory(workouts))
    return
  }
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
