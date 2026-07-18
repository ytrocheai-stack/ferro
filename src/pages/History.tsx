import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { db } from '../db/db'
import type { Workout } from '../db/types'
import { useCatalog } from '../data/exercises'
import { useSettings } from '../stores/settings'
import { formatDay, formatDuration, formatMonth, formatTime, formatVolume } from '../lib/format'
import { SkeletonList } from '../components/Skeleton'
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconDumbbell,
  IconHistory,
  IconList,
  IconTimer,
  IconTrophy,
} from '../components/icons'

type ViewMode = 'list' | 'calendar'

export default function History() {
  const workouts = useLiveQuery(
    () => db.workouts.orderBy('startedAt').reverse().toArray(),
    [],
    undefined as Workout[] | undefined,
  )
  const [view, setView] = useState<ViewMode>('list')

  return (
    <div className="px-4 pt-6">
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-2xl font-extrabold">Historial</h1>
        <div className="flex overflow-hidden rounded-lg border border-border">
          <button
            className={`flex min-h-9 items-center gap-1.5 px-3 text-xs font-bold ${
              view === 'list' ? 'bg-primary text-white' : 'bg-surface-2 text-muted'
            }`}
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
          >
            <IconList size={14} />
            Lista
          </button>
          <button
            className={`flex min-h-9 items-center gap-1.5 px-3 text-xs font-bold ${
              view === 'calendar' ? 'bg-primary text-white' : 'bg-surface-2 text-muted'
            }`}
            onClick={() => setView('calendar')}
            aria-pressed={view === 'calendar'}
          >
            <IconCalendar size={14} />
            Calendario
          </button>
        </div>
      </div>

      {workouts === undefined && <SkeletonList rows={5} />}

      {workouts !== undefined && workouts.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-4 py-10 text-center">
          <IconHistory size={32} className="text-muted" />
          <p className="font-semibold">Todavía no hay entrenos</p>
          <p className="text-sm text-muted">Cuando termines tu primer entreno aparecerá aquí.</p>
        </div>
      )}

      {workouts && workouts.length > 0 && (view === 'list' ? <ListView workouts={workouts} /> : <CalendarView workouts={workouts} />)}
    </div>
  )
}

function ListView({ workouts }: { workouts: Workout[] }) {
  const groups = useMemo(() => {
    const g: { month: string; items: Workout[] }[] = []
    for (const w of workouts) {
      const m = formatMonth(w.startedAt)
      if (!g.length || g[g.length - 1].month !== m) g.push({ month: m, items: [] })
      g[g.length - 1].items.push(w)
    }
    return g
  }, [workouts])

  return (
    <>
      {groups.map((g) => (
        <section key={g.month} className="pb-2">
          <h2 className="pb-2 pt-2 text-sm font-bold uppercase tracking-wide text-muted">
            {g.month}
          </h2>
          <div className="flex flex-col gap-3">
            {g.items.map((w) => (
              <WorkoutRow key={w.id} workout={w} />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function WorkoutRow({ workout: w }: { workout: Workout }) {
  const { byId } = useCatalog()
  const units = useSettings((s) => s.units)
  return (
    <Link to={`/historial/${w.id}`} className="card pressable block px-4 py-3.5">
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
        {w.exercises.length > 4 && <div className="pt-0.5 font-semibold">+{w.exercises.length - 4} más…</div>}
      </div>
    </Link>
  )
}

function CalendarView({ workouts }: { workouts: Workout[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const byDay = useMemo(() => {
    const m = new Map<string, Workout[]>()
    for (const w of workouts) {
      const key = format(w.startedAt, 'yyyy-MM-dd')
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(w)
    }
    return m
  }, [workouts])

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const dayLabel = selectedDay ? format(selectedDay, 'yyyy-MM-dd') : ''
  const dayWorkouts = selectedDay ? (byDay.get(dayLabel) ?? []) : []

  return (
    <div>
      <div className="flex items-center justify-between pb-3">
        <button
          className="pressable rounded-lg p-2 text-muted"
          onClick={() => setMonth((m) => subMonths(m, 1))}
          aria-label="Mes anterior"
        >
          <IconChevronLeft size={18} />
        </button>
        <span className="font-bold">{formatMonth(month.getTime())}</span>
        <button
          className="pressable rounded-lg p-2 text-muted"
          onClick={() => setMonth((m) => addMonths(m, 1))}
          aria-label="Mes siguiente"
        >
          <IconChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 pb-1 text-center text-[10px] font-bold uppercase text-muted">
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd')
          const items = byDay.get(key) ?? []
          const inMonth = isSameMonth(d, month)
          const selected = selectedDay && isSameDay(d, selectedDay)
          return (
            <button
              key={key}
              onClick={() => setSelectedDay(items.length ? d : null)}
              className={`pressable flex aspect-square flex-col items-center justify-center rounded-xl text-xs ${
                selected ? 'bg-primary text-white' : inMonth ? 'text-text' : 'text-muted/40'
              } ${isToday(d) && !selected ? 'border border-primary' : ''}`}
            >
              <span className="tabular-nums">{format(d, 'd')}</span>
              {items.length > 0 && (
                <span
                  className={`mt-0.5 h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : 'bg-primary'}`}
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="pt-4">
        {selectedDay ? (
          dayWorkouts.length ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-muted">
                {format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}
              </h3>
              {dayWorkouts.map((w) => (
                <WorkoutRow key={w.id} workout={w} />
              ))}
            </div>
          ) : null
        ) : (
          <p className="py-6 text-center text-sm text-muted">Toca un día con punto para ver el entreno.</p>
        )}
      </div>
    </div>
  )
}
