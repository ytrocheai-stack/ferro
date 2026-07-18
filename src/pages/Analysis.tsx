import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, startOfWeek, subWeeks } from 'date-fns'
import { es } from 'date-fns/locale'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { db } from '../db/db'
import type { Workout } from '../db/types'
import { useCatalog } from '../data/exercises'
import { useSettings } from '../stores/settings'
import {
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUP_ORDER,
  RECOMMENDED_WEEKLY_SETS,
  type MuscleGroup,
} from '../data/muscleGroups'
import { weeklySetsByGroup } from '../lib/stats'
import { formatDuration, formatVolume } from '../lib/format'
import { MuscleHeatmap } from '../components/MuscleHeatmap'
import { SkeletonChart } from '../components/Skeleton'
import { IconChevronLeft } from '../components/icons'

export default function Analysis() {
  const navigate = useNavigate()
  const workouts = useLiveQuery(() => db.workouts.toArray(), [], undefined as Workout[] | undefined)
  const { all } = useCatalog()
  const units = useSettings((s) => s.units)

  const targetById = useMemo(() => new Map(all.map((e) => [e.id, e.target])), [all])
  const weekly = useMemo<Partial<Record<MuscleGroup, number>>>(
    () => (workouts ? weeklySetsByGroup(workouts, targetById, 7) : {}),
    [workouts, targetById],
  )

  const weeksData = useMemo(() => {
    if (!workouts) return []
    const buckets: { label: string; volume: number; duration: number; count: number }[] = []
    for (let i = 7; i >= 0; i--) {
      const start = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 }).getTime()
      const end = start + 7 * 86400000
      const items = workouts.filter((w) => w.startedAt >= start && w.startedAt < end)
      buckets.push({
        label: format(start, 'd MMM', { locale: es }),
        volume: items.reduce((a, w) => a + w.volumeKg, 0),
        duration: items.length ? items.reduce((a, w) => a + (w.endedAt - w.startedAt), 0) / items.length / 60000 : 0,
        count: items.length,
      })
    }
    return buckets
  }, [workouts])

  const avgDurationMin = useMemo(() => {
    if (!workouts?.length) return 0
    return workouts.reduce((a, w) => a + (w.endedAt - w.startedAt), 0) / workouts.length / 60000
  }, [workouts])

  if (workouts === undefined) {
    return (
      <div className="px-4 pt-4">
        <SkeletonChart />
      </div>
    )
  }

  return (
    <div className="px-4 pt-4">
      <header className="flex items-center gap-2 pb-4">
        <button
          className="pressable -ml-2 rounded-lg p-1.5 text-muted"
          onClick={() => navigate(-1)}
          aria-label="Volver"
        >
          <IconChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-extrabold">Análisis</h1>
      </header>

      {workouts.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-muted">
          Registra entrenos para ver tu volumen por grupo muscular y tu evolución.
        </div>
      ) : (
        <>
          <div className="card px-3 py-3">
            <h2 className="pb-1 px-1 text-sm font-bold">Mapa de series (7 días)</h2>
            <MuscleHeatmap counts={weekly} />
          </div>

          <div className="card mt-3 px-4 py-3">
            <h2 className="pb-3 text-sm font-bold">Series semanales por grupo muscular</h2>
            <div className="flex flex-col gap-2.5">
              {MUSCLE_GROUP_ORDER.map((g) => {
                const v = weekly[g] ?? 0
                const [lo, hi] = RECOMMENDED_WEEKLY_SETS[g]
                const pct = Math.min(100, (v / hi) * 100)
                const under = v < lo
                return (
                  <div key={g}>
                    <div className="flex items-center justify-between pb-1 text-xs">
                      <span className="font-semibold">{MUSCLE_GROUP_LABELS[g]}</span>
                      <span className={`tabular-nums ${under ? 'text-warning' : 'text-muted'}`}>
                        {v} <span className="text-muted">/ {lo}-{hi}</span>
                      </span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="absolute inset-y-0 rounded-full bg-border"
                        style={{ left: `${(lo / hi) * 100}%`, width: `${100 - (lo / hi) * 100}%` }}
                      />
                      <div
                        className={`absolute inset-y-0 left-0 rounded-full ${under ? 'bg-warning' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="pt-3 text-[11px] text-muted">
              Banda gris = rango recomendado para hipertrofia (10–20 series/semana según músculo).
              Naranja = por debajo del mínimo.
            </p>
          </div>

          <div className="card mt-3 px-2 py-3">
            <h2 className="px-2 pb-2 text-sm font-bold">Volumen semanal</h2>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={weeksData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#2a2a33" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="#8f8f9b" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#8f8f9b" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: '#1f1f27', border: '1px solid #2a2a33', borderRadius: 12, fontSize: 12 }}
                  formatter={(v) => [formatVolume(Number(v), units), 'Volumen']}
                />
                <Bar dataKey="volume" fill="#3d8bfd" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="card px-3 py-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Duración media</div>
              <div className="pt-1 text-lg font-extrabold tabular-nums">{formatDuration(avgDurationMin * 60)}</div>
            </div>
            <div className="card px-3 py-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Entrenos totales</div>
              <div className="pt-1 text-lg font-extrabold tabular-nums">{workouts.length}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
