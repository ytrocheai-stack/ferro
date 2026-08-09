import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addWeeks, format, startOfWeek, subWeeks } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { db } from '../db/db'
import type { Workout } from '../db/types'
import { useCatalog } from '../data/exercises'
import { useSettings } from '../stores/settings'
import {
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUP_ORDER,
  classifyMuscleDose,
  RECOMMENDED_WEEKLY_SETS,
  type MuscleGroup,
} from '../data/muscleGroups'
import { weeklySetsByGroup } from '../lib/stats'
import { compareTrainingPeriods, topExerciseProgress } from '../lib/analytics'
import { formatVolume } from '../lib/format'
import { MuscleHeatmap } from '../components/MuscleHeatmap'
import { SkeletonChart } from '../components/Skeleton'
import {
  IconChart,
  IconChevronLeft,
  IconTrophy,
} from '../components/icons'

const PERIODS = [4, 8, 12] as const
const DAY = 86_400_000

export default function Analysis() {
  const navigate = useNavigate()
  const workouts = useLiveQuery(() => db.workouts.toArray(), [], undefined as Workout[] | undefined)
  const { all, byId } = useCatalog()
  const units = useSettings((state) => state.units)
  const weeklyGoal = useSettings((state) => state.weeklyGoal)
  const [periodWeeks, setPeriodWeeks] = useState<(typeof PERIODS)[number]>(8)
  const [now] = useState(Date.now)

  const targetById = useMemo(() => new Map(all.map((exercise) => [exercise.id, exercise.target])), [all])
  const weekly = useMemo<Partial<Record<MuscleGroup, number>>>(
    () => (workouts ? weeklySetsByGroup(workouts, targetById, 7) : {}),
    [workouts, targetById],
  )

  const weeksData = useMemo(() => {
    if (!workouts) return []
    return Array.from({ length: periodWeeks }, (_, index) => {
      const weeksAgo = periodWeeks - index - 1
      const startDate = startOfWeek(subWeeks(new Date(now), weeksAgo), { weekStartsOn: 1 })
      const start = startDate.getTime()
      const end = addWeeks(startDate, 1).getTime()
      const items = workouts.filter((workout) => workout.startedAt >= start && workout.startedAt < end)
      return {
        start,
        label: format(start, 'd MMM', { locale: es }),
        volume: Math.round(items.reduce((sum, workout) => sum + workout.volumeKg, 0)),
        sessions: items.length,
        sets: items.reduce((sum, workout) => sum + workout.totalSets, 0),
      }
    })
  }, [now, periodWeeks, workouts])

  const comparison = useMemo(
    () => compareTrainingPeriods(workouts ?? [], now, periodWeeks * 7),
    [now, periodWeeks, workouts],
  )
  const progress = useMemo(
    () => topExerciseProgress(workouts ?? [], now - periodWeeks * 7 * DAY, 4),
    [now, periodWeeks, workouts],
  )
  const averageWeeklyVolume = weeksData.length
    ? weeksData.reduce((sum, week) => sum + week.volume, 0) / weeksData.length
    : 0
  const sessionsPerWeek = comparison.sessions / periodWeeks
  const goalPct = Math.min(100, Math.round((sessionsPerWeek / Math.max(1, weeklyGoal)) * 100))

  const muscleSummary = useMemo(() => {
    let inRange = 0
    let above = 0
    for (const group of MUSCLE_GROUP_ORDER) {
      const value = weekly[group] ?? 0
      const [low, high] = RECOMMENDED_WEEKLY_SETS[group]
      if (value >= low && value <= high) inRange++
      if (value > high) above++
    }
    return { inRange, above, below: MUSCLE_GROUP_ORDER.length - inRange - above }
  }, [weekly])

  if (workouts === undefined) {
    return (
      <div className="px-4 pt-4">
        <SkeletonChart />
      </div>
    )
  }

  return (
    <div className="px-4 pt-4">
      <header className="flex items-start gap-3 pb-4">
        <button
          className="pressable -ml-1 mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border bg-surface/80 text-muted shadow-sm"
          onClick={() => navigate(-1)}
          aria-label="Volver"
        >
          <IconChevronLeft size={21} />
        </button>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Rendimiento</p>
          <h1 className="text-2xl font-extrabold tracking-[-0.03em]">Análisis</h1>
          <p className="pt-0.5 text-xs text-muted">Carga, constancia y fuerza con contexto.</p>
        </div>
      </header>

      <div
        className="mb-4 grid grid-cols-3 gap-1 rounded-2xl border border-border bg-surface/75 p-1"
        role="group"
        aria-label="Periodo de análisis"
      >
        {PERIODS.map((weeks) => (
          <button
            key={weeks}
            className={`min-h-11 rounded-xl text-xs font-bold transition-[background-color,color,box-shadow] duration-150 ${
              periodWeeks === weeks
                ? 'bg-surface-2 text-text shadow-sm shadow-black/30'
                : 'text-muted'
            }`}
            type="button"
            aria-pressed={periodWeeks === weeks}
            onClick={() => setPeriodWeeks(weeks)}
          >
            {weeks} semanas
          </button>
        ))}
      </div>

      {workouts.length === 0 ? (
        <div className="card overflow-hidden px-5 py-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/12 text-primary">
            <IconChart size={23} />
          </div>
          <h2 className="pt-3 text-base font-bold">Tu lectura de rendimiento empieza aquí</h2>
          <p className="mx-auto max-w-xs pt-1 text-sm leading-relaxed text-muted">
            Registra dos o más entrenos para comparar carga, constancia y progreso de fuerza.
          </p>
          <button className="btn btn-primary mx-auto mt-4 text-sm" onClick={() => navigate('/')}>
            Registrar un entreno
          </button>
        </div>
      ) : (
        <>
          <section className="card relative overflow-hidden px-4 py-4">
            <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/15 blur-3xl" />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  Pulso de entrenamiento
                </p>
                <div className="flex items-end gap-2 pt-1">
                  <span className="text-3xl font-extrabold tracking-[-0.05em] tabular-nums">
                    {formatVolume(comparison.volumeKg, units)}
                  </span>
                </div>
                <p className="pt-1 text-xs text-muted">Carga acumulada en {periodWeeks} semanas</p>
              </div>
              <TrendBadge value={comparison.volumeChangePct} />
            </div>

            <div className="relative mt-4 grid grid-cols-3 gap-2 border-t border-border/70 pt-3">
              <Metric label="Sesiones" value={String(comparison.sessions)} detail={`${sessionsPerWeek.toFixed(1)}/sem`} />
              <Metric label="Series" value={String(comparison.workingSets)} detail="efectivas" />
              <Metric label="Récords" value={String(comparison.prCount)} detail="en periodo" />
            </div>
            <div className="relative mt-3 rounded-xl bg-surface-2/70 px-3 py-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold">Constancia frente a tu meta</span>
                <span className="font-bold tabular-nums text-primary">{goalPct}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              <p className="pt-1.5 text-[10px] text-muted">
                {sessionsPerWeek.toFixed(1)} de {weeklyGoal} sesiones por semana
              </p>
            </div>
          </section>

          <section className="card mt-3 px-3 py-4" aria-label={`Carga semanal de las últimas ${periodWeeks} semanas`}>
            <div className="flex items-end justify-between px-1 pb-3">
              <div>
                <h2 className="text-sm font-bold">Carga semanal</h2>
                <p className="pt-0.5 text-[11px] text-muted">Volumen total; toca la curva para el detalle.</p>
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
                media {formatVolume(averageWeeklyVolume, units)}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart data={weeksData} margin={{ top: 8, right: 6, bottom: 0, left: -17 }}>
                <defs>
                  <linearGradient id="trainingLoadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.42} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.015} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 6" vertical={false} />
                <XAxis dataKey="label" stroke="var(--color-muted)" fontSize={9} tickLine={false} axisLine={false} minTickGap={18} />
                <YAxis stroke="var(--color-muted)" fontSize={9} tickLine={false} axisLine={false} width={42} />
                {averageWeeklyVolume > 0 && (
                  <ReferenceLine y={averageWeeklyVolume} stroke="var(--color-accent)" strokeDasharray="4 5" strokeOpacity={0.55} />
                )}
                <Tooltip content={<TrainingTooltip units={units} />} cursor={{ stroke: 'var(--color-border)' }} />
                <Area
                  type="monotone"
                  dataKey="volume"
                  stroke="var(--color-primary)"
                  strokeWidth={2.5}
                  fill="url(#trainingLoadFill)"
                  activeDot={{ r: 5, fill: 'var(--color-primary)', stroke: 'var(--color-text)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </section>

          <section className="card mt-3 px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-success/10 text-success">
                <IconTrophy size={17} />
              </span>
              <div>
                <h2 className="text-sm font-bold">Momentum de fuerza</h2>
                <p className="text-[11px] text-muted">Cambio de e1RM entre la primera y última sesión.</p>
              </div>
            </div>
            {progress.length ? (
              <div className="mt-3 divide-y divide-border/60">
                {progress.map((item) => (
                  <div key={item.exerciseId} className="flex items-center gap-3 py-3 first:pt-1 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold">{byId.get(item.exerciseId)?.name ?? item.exerciseId}</p>
                      <p className="pt-0.5 text-[10px] text-muted">
                        {item.sessions} sesiones · {item.startE1rm.toFixed(1)} → {item.endE1rm.toFixed(1)} kg e1RM
                      </p>
                    </div>
                    <span className={`text-sm font-extrabold tabular-nums ${item.changePct >= 0 ? 'text-success' : 'text-danger'}`}>
                      {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-surface-2/60 px-3 py-3 text-xs leading-relaxed text-muted">
                Repite un ejercicio al menos dos veces dentro del periodo para medir su tendencia de fuerza.
              </p>
            )}
          </section>

          <section className="card mt-3 overflow-hidden px-3 py-4">
            <div className="flex items-start justify-between gap-3 px-1">
              <div>
                <h2 className="text-sm font-bold">Dosis muscular · 7 días</h2>
                <p className="pt-0.5 text-[11px] text-muted">Series efectivas contra rangos de hipertrofia.</p>
              </div>
              <div className="flex gap-1 text-[9px] font-bold">
                <span className="rounded-full bg-success/10 px-2 py-1 text-success">{muscleSummary.inRange} en rango</span>
                {muscleSummary.above > 0 && <span className="rounded-full bg-warning/10 px-2 py-1 text-warning">{muscleSummary.above} altas</span>}
              </div>
            </div>
            <div className="mt-2 rounded-2xl bg-surface-2/30 py-2">
              <MuscleHeatmap counts={weekly} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {MUSCLE_GROUP_ORDER.map((group) => (
                <MuscleDose key={group} group={group} value={weekly[group] ?? 0} />
              ))}
            </div>
            <p className="px-1 pt-3 text-[10px] leading-relaxed text-muted">
              Los rangos son una referencia general. Ajusta volumen según recuperación, experiencia y objetivo.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function TrendBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-muted">Sin base previa</span>
  }
  const positive = value >= 0
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold tabular-nums ${positive ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
      {positive ? '+' : ''}{value}% vs periodo anterior
    </span>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="pt-0.5 text-lg font-extrabold tracking-[-0.03em] tabular-nums">{value}</p>
      <p className="text-[9px] text-muted">{detail}</p>
    </div>
  )
}

function MuscleDose({ group, value }: { group: MuscleGroup; value: number }) {
  const [low, high] = RECOMMENDED_WEEKLY_SETS[group]
  const progress = Math.min(100, (value / high) * 100)
  const state = classifyMuscleDose(group, value)
  const status = state === 'none' ? 'Sin estímulo' : state === 'low' ? 'Bajo' : state === 'optimal' ? 'En rango' : 'Alto'
  const tone = state === 'none' ? 'text-muted' : state === 'low' ? 'text-primary-strong' : state === 'optimal' ? 'text-success' : 'text-warning'
  const fill = state === 'none' ? 'bg-border' : state === 'low' ? 'bg-primary-strong' : state === 'optimal' ? 'bg-success' : 'bg-warning'
  return (
    <div className="rounded-xl border border-border/60 bg-surface-2/45 px-2.5 py-2.5">
      <div className="flex items-start justify-between gap-1">
        <span className="truncate text-[11px] font-bold">{MUSCLE_GROUP_LABELS[group]}</span>
        <span className={`text-[9px] font-bold ${tone}`}>{status}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-border/80">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${progress}%` }} />
      </div>
      <p className="pt-1.5 text-[9px] tabular-nums text-muted">{value} / {low}–{high} series</p>
    </div>
  )
}

function TrainingTooltip({ active, payload, units }: { active?: boolean; payload?: Array<{ payload: { label: string; volume: number; sessions: number; sets: number } }>; units: 'kg' | 'lb' }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs shadow-xl shadow-black/40">
      <p className="font-bold">Semana del {point.label}</p>
      <p className="pt-1 font-semibold text-primary">{formatVolume(point.volume, units)}</p>
      <p className="pt-0.5 text-[10px] text-muted">{point.sessions} sesiones · {point.sets} series</p>
    </div>
  )
}
