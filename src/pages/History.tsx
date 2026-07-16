import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Workout } from '../db/types'
import { useCatalog } from '../data/exercises'
import { useSettings } from '../stores/settings'
import { formatDay, formatDuration, formatMonth, formatTime, formatVolume } from '../lib/format'
import { IconDumbbell, IconHistory, IconTimer, IconTrophy } from '../components/icons'

export default function History() {
  const workouts = useLiveQuery(
    () => db.workouts.orderBy('startedAt').reverse().toArray(),
    [],
    undefined as Workout[] | undefined,
  )
  const { byId } = useCatalog()
  const units = useSettings((s) => s.units)

  const groups = useMemo(() => {
    const g: { month: string; items: Workout[] }[] = []
    for (const w of workouts ?? []) {
      const m = formatMonth(w.startedAt)
      if (!g.length || g[g.length - 1].month !== m) g.push({ month: m, items: [] })
      g[g.length - 1].items.push(w)
    }
    return g
  }, [workouts])

  return (
    <div className="px-4 pt-6">
      <h1 className="pb-4 text-2xl font-extrabold">Historial</h1>

      {workouts !== undefined && workouts.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-4 py-10 text-center">
          <IconHistory size={32} className="text-muted" />
          <p className="font-semibold">Todavía no hay entrenos</p>
          <p className="text-sm text-muted">Cuando termines tu primer entreno aparecerá aquí.</p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.month} className="pb-2">
          <h2 className="pb-2 pt-2 text-sm font-bold uppercase tracking-wide text-muted">
            {g.month}
          </h2>
          <div className="flex flex-col gap-3">
            {g.items.map((w) => (
              <Link key={w.id} to={`/historial/${w.id}`} className="card block px-4 py-3.5">
                <div className="font-bold">{w.name}</div>
                <div className="pt-0.5 text-xs text-muted">
                  {formatDay(w.startedAt)} · {formatTime(w.startedAt)}
                </div>
                <div className="flex items-center gap-4 pt-2 text-xs font-semibold text-muted">
                  <span className="flex items-center gap-1">
                    <IconTimer size={13} />
                    {formatDuration((w.endedAt - w.startedAt) / 1000)}
                  </span>
                  <span className="flex items-center gap-1">
                    <IconDumbbell size={13} />
                    {formatVolume(w.volumeKg, units)}
                  </span>
                  {w.prs.length > 0 && (
                    <span className="flex items-center gap-1 text-warning">
                      <IconTrophy size={13} />
                      {w.prs.length} PR{w.prs.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="pt-2 text-xs leading-relaxed text-muted">
                  {w.exercises.slice(0, 4).map((e) => (
                    <div key={e.exerciseId} className="truncate">
                      {e.sets.length} × {byId.get(e.exerciseId)?.name ?? 'Ejercicio eliminado'}
                    </div>
                  ))}
                  {w.exercises.length > 4 && (
                    <div className="pt-0.5 font-semibold">+{w.exercises.length - 4} más…</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
