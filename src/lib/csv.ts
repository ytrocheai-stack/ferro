import { format } from 'date-fns'
import { db } from '../db/db'
import type { Exercise } from '../data/exercises'
import { shareOrDownloadFile } from './format'

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Exporta todas las series registradas a CSV: fecha, entreno, ejercicio, serie, tipo, kg, reps, RPE. */
export async function exportWorkoutsCsv(): Promise<void> {
  const [workouts, { loadExercises }] = await Promise.all([
    db.workouts.orderBy('startedAt').toArray(),
    import('../data/exercises'),
  ])
  let byId = new Map<string, Exercise>()
  try {
    byId = new Map((await loadExercises()).map((e) => [e.id, e]))
  } catch {
    /* sin conexión la primera vez: se usa el id crudo */
  }

  const header = ['fecha', 'entreno', 'ejercicio', 'serie', 'tipo', 'kg', 'reps', 'rpe']
  const rows: string[] = [header.join(',')]

  for (const w of workouts) {
    const date = format(w.startedAt, 'yyyy-MM-dd')
    for (const ex of w.exercises) {
      const name = byId.get(ex.exerciseId)?.name ?? ex.exerciseId
      let n = 0
      for (const s of ex.sets) {
        if (s.type !== 'warmup') n++
        rows.push(
          [
            date,
            csvEscape(w.name),
            csvEscape(name),
            s.type === 'warmup' ? 'W' : n,
            s.type,
            s.weightKg,
            s.reps,
            s.rpe ?? '',
          ].join(','),
        )
      }
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  await shareOrDownloadFile(blob, `nextrep-series-${format(new Date(), 'yyyy-MM-dd')}.csv`, 'text/csv')
}
