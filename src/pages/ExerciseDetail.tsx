import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { db } from '../db/db'
import type { Workout } from '../db/types'
import { useCatalog } from '../data/exercises'
import { t } from '../data/translations'
import { useSettings } from '../stores/settings'
import { bestsFromHistory, exerciseSeries } from '../lib/stats'
import { formatShortDate, formatVolume, formatWeight, kgToDisplay } from '../lib/format'
import { ExerciseThumb } from '../components/ExerciseThumb'
import { ActionSheet, Confirm } from '../components/Sheet'
import { CustomExerciseSheet } from '../components/CustomExerciseSheet'
import { IconChevronLeft, IconDots, IconPencil, IconTrash } from '../components/icons'

type Tab = 'about' | 'history' | 'charts' | 'records'
type Metric = 'maxWeight' | 'e1rm' | 'volume'

export default function ExerciseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { byId, ready } = useCatalog()
  const units = useSettings((s) => s.units)
  const [tab, setTab] = useState<Tab>('about')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const workouts = useLiveQuery(
    () => db.workouts.orderBy('startedAt').reverse().toArray(),
    [],
    [] as Workout[],
  )
  const withEx = useMemo(
    () => workouts.filter((w) => w.exercises.some((e) => e.exerciseId === id)),
    [workouts, id],
  )

  const ex = byId.get(id!)
  const custom = useLiveQuery(
    async () => (id?.startsWith('custom-') ? await db.customExercises.get(id) : undefined),
    [id],
  )

  if (!ready && !ex) return <p className="px-4 pt-10 text-center text-muted">Cargando…</p>
  if (!ex)
    return (
      <div className="px-4 pt-10 text-center text-muted">
        Ejercicio no encontrado.
        <button className="btn btn-surface mx-auto mt-4" onClick={() => navigate(-1)}>
          Volver
        </button>
      </div>
    )

  const tabs: { key: Tab; label: string }[] = [
    { key: 'about', label: 'Resumen' },
    { key: 'history', label: 'Historial' },
    { key: 'charts', label: 'Gráficas' },
    { key: 'records', label: 'Récords' },
  ]

  return (
    <div className="px-4 pt-4">
      <header className="flex items-center justify-between pb-2">
        <button
          className="-ml-2 rounded-lg p-1.5 text-muted active:bg-surface-2"
          onClick={() => navigate(-1)}
          aria-label="Volver"
        >
          <IconChevronLeft size={22} />
        </button>
        {ex.custom && (
          <button
            className="rounded-lg p-1.5 text-muted active:bg-surface-2"
            onClick={() => setMenuOpen(true)}
            aria-label="Opciones"
          >
            <IconDots size={20} />
          </button>
        )}
      </header>

      <div className="flex flex-col items-center gap-3">
        <ExerciseThumb exercise={ex} size={190} gif className="rounded-2xl" />
        <h1 className="text-center text-xl font-extrabold leading-tight">{ex.name}</h1>
        <div className="flex flex-wrap justify-center gap-1.5">
          <span className="chip chip-active">{t(ex.target)}</span>
          <span className="chip">{t(ex.bodyPart)}</span>
          <span className="chip">{t(ex.equipment)}</span>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 pt-4">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            className={`chip ${tab === key ? 'chip-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'about' && (
        <div className="pt-3">
          {ex.secondaryMuscles.length > 0 && (
            <p className="pb-3 text-sm text-muted">
              <span className="font-semibold text-text">Músculos secundarios: </span>
              {ex.secondaryMuscles.map((m) => t(m)).join(', ')}
            </p>
          )}
          {ex.steps.length > 0 ? (
            <ol className="flex list-none flex-col gap-2.5">
              {ex.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-center text-sm text-muted">
              {ex.custom ? 'Ejercicio personalizado sin instrucciones.' : 'Sin instrucciones.'}
            </p>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="flex flex-col gap-3 pt-3">
          {withEx.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">
              Aún no has registrado este ejercicio.
            </p>
          )}
          {withEx.map((w) => {
            const entries = w.exercises.filter((e) => e.exerciseId === id)
            let n = 0
            return (
              <div key={w.id} className="card px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-bold">{w.name}</span>
                  <span className="text-xs text-muted">{formatShortDate(w.startedAt)}</span>
                </div>
                <div className="flex flex-col gap-1 pt-2">
                  {entries.flatMap((e, k) =>
                    e.sets.map((s, j) => {
                      if (s.type !== 'warmup') n++
                      return (
                        <div key={`${k}-${j}`} className="flex items-center gap-3 text-sm">
                          <span className="w-6 text-center font-bold text-muted">
                            {s.type === 'warmup' ? 'W' : n}
                          </span>
                          <span>
                            {kgToDisplay(s.weightKg, units)} {units} × {s.reps}
                          </span>
                        </div>
                      )
                    }),
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'charts' && <Charts workouts={withEx} exerciseId={id!} />}

      {tab === 'records' && <Records workouts={withEx} exerciseId={id!} />}

      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={ex.name}
        actions={[
          {
            label: 'Editar ejercicio',
            icon: <IconPencil size={18} />,
            onClick: () => setEditOpen(true),
          },
          {
            label: 'Eliminar ejercicio',
            icon: <IconTrash size={18} />,
            danger: true,
            onClick: () => setConfirmDelete(true),
          },
        ]}
      />
      <CustomExerciseSheet open={editOpen} onClose={() => setEditOpen(false)} existing={custom} />
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="¿Eliminar ejercicio personalizado?"
        message="Tus entrenos pasados lo mostrarán como «Ejercicio eliminado»."
        confirmLabel="Eliminar"
        danger
        onConfirm={() => {
          void db.customExercises.delete(id!).then(() => navigate('/ejercicios', { replace: true }))
        }}
      />
    </div>
  )
}

const METRICS: { key: Metric; label: string }[] = [
  { key: 'maxWeight', label: 'Peso máx' },
  { key: 'e1rm', label: '1RM est.' },
  { key: 'volume', label: 'Volumen' },
]

function Charts({ workouts, exerciseId }: { workouts: Workout[]; exerciseId: string }) {
  const units = useSettings((s) => s.units)
  const [metric, setMetric] = useState<Metric>('maxWeight')

  const points = useMemo(
    () =>
      exerciseSeries(workouts, exerciseId).map((p) => ({
        ...p,
        maxWeight: kgToDisplay(p.maxWeight, units),
        e1rm: kgToDisplay(p.e1rm, units),
        volume: kgToDisplay(p.volume, units),
      })),
    [workouts, exerciseId, units],
  )

  return (
    <div className="pt-3">
      <div className="flex gap-2 pb-3">
        {METRICS.map((m) => (
          <button
            key={m.key}
            className={`chip ${metric === m.key ? 'chip-active' : ''}`}
            onClick={() => setMetric(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {points.length < 2 ? (
        <p className="py-8 text-center text-sm text-muted">
          Registra este ejercicio en al menos 2 entrenos para ver la gráfica.
        </p>
      ) : (
        <div className="card px-1 py-3">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={points} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#2a2a33" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: number) => format(d, 'd MMM', { locale: es })}
                stroke="#8f8f9b"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                stroke="#8f8f9b"
                fontSize={11}
                width={42}
                tickLine={false}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  background: '#1f1f27',
                  border: '1px solid #2a2a33',
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelFormatter={(d) => format(Number(d), "d 'de' MMMM yyyy", { locale: es })}
                formatter={(v) => [`${v} ${units}`, METRICS.find((m) => m.key === metric)?.label]}
              />
              <Line
                type="monotone"
                dataKey={metric}
                stroke="#3d8bfd"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#3d8bfd' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function Records({ workouts, exerciseId }: { workouts: Workout[]; exerciseId: string }) {
  const units = useSettings((s) => s.units)
  const bests = useMemo(() => bestsFromHistory(workouts, exerciseId), [workouts, exerciseId])

  if (bests.weight <= 0 && bests.setVolume <= 0)
    return (
      <p className="py-8 pt-6 text-center text-sm text-muted">
        Todavía no hay récords: registra este ejercicio en un entreno.
      </p>
    )

  return (
    <div className="grid grid-cols-2 gap-2 pt-3">
      <RecordCard label="Peso máximo" value={formatWeight(bests.weight, units)} />
      <RecordCard label="1RM estimado" value={`~${formatWeight(bests.e1rm, units)}`} />
      <RecordCard
        label="Mejor serie"
        value={
          bests.bestSet
            ? `${kgToDisplay(bests.bestSet.weightKg, units)} ${units} × ${bests.bestSet.reps}`
            : '—'
        }
      />
      <RecordCard label="Volumen en una serie" value={formatVolume(bests.setVolume, units)} />
    </div>
  )
}

function RecordCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="pt-1 text-lg font-extrabold text-primary">{value}</div>
    </div>
  )
}
