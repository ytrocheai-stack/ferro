import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, isToday, subDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { db } from '../db/db'
import type { FoodLogEntry, MealKey } from '../db/types'
import { macrosForGrams } from '../data/foods'
import { useNutrition } from '../stores/nutrition'
import { ema } from '../lib/stats'
import { buildNutritionInsights, suggestCalorieAdjustment, weeklyChangePct } from '../lib/nutrition'
import { parseDec, uid } from '../lib/format'
import { toastUndo } from '../stores/toasts'
import { FoodPickerSheet } from '../components/FoodPicker'
import { NutritionGoalsWizard } from '../components/NutritionGoalsWizard'
import { ActionSheet, Sheet } from '../components/Sheet'
import { SkeletonChart } from '../components/Skeleton'
import { IconChart, IconChevronLeft, IconChevronRight, IconDots, IconFlame, IconPlus, IconRepeat, IconTarget } from '../components/icons'
import { useLocalDateKey } from '../lib/useLocalDateKey'

const MEALS: { key: MealKey; label: string }[] = [
  { key: 'breakfast', label: 'Desayuno' },
  { key: 'lunch', label: 'Comida' },
  { key: 'dinner', label: 'Cena' },
  { key: 'snack', label: 'Snacks' },
]

const dateKey = (d: Date) => format(d, 'yyyy-MM-dd')

export default function Nutrition() {
  const [day, setDay] = useState(() => new Date())
  const todayKey = useLocalDateKey()
  const goals = useNutrition((s) => s.goals)
  const [wizardOpen, setWizardOpen] = useState(!goals.configured)
  const [pickerFor, setPickerFor] = useState<MealKey | null>(null)
  const [view, setView] = useState<'diary' | 'trends'>('diary')

  const key = dateKey(day)
  useEffect(() => {
    if (key === dateKey(new Date())) setDay(new Date())
  }, [todayKey, key])
  const entries = useLiveQuery(() => db.foodLog.where('date').equals(key).toArray(), [key], undefined)

  const totals = useMemo(() => {
    const t = { kcal: 0, p: 0, c: 0, f: 0 }
    for (const e of entries ?? []) {
      t.kcal += e.kcal
      t.p += e.p
      t.c += e.c
      t.f += e.f
    }
    return t
  }, [entries])

  const copyPreviousDay = async () => {
    let cursor = subDays(day, 1)
    let prev: FoodLogEntry[] = []
    for (let i = 0; i < 14; i++) {
      const k = dateKey(cursor)
      prev = await db.foodLog.where('date').equals(k).toArray()
      if (prev.length) break
      cursor = subDays(cursor, 1)
    }
    if (!prev.length) return
    await db.foodLog.bulkPut(prev.map((e) => ({ ...e, id: uid(), date: key })))
  }

  return (
    <div className="px-4 pt-6">
      <div className="flex items-start justify-between pb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Energía y recuperación</p>
          <h1 className="text-2xl font-extrabold tracking-[-0.03em]">Nutrición</h1>
          <p className="pt-0.5 text-xs text-muted">Decisiones basadas en tu ingesta y tendencia real.</p>
        </div>
        <button
          className="pressable grid h-11 w-11 place-items-center rounded-2xl border border-border bg-surface/80 text-muted"
          onClick={() => setWizardOpen(true)}
          aria-label="Ajustar objetivos"
        >
          <IconTarget size={20} />
        </button>
      </div>

      <div
        className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface/75 p-1"
        role="tablist"
        aria-label="Vista de nutrición"
      >
        {([
          ['diary', 'Diario'],
          ['trends', 'Tendencias'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            aria-controls={`nutrition-${key}`}
            className={`min-h-11 rounded-xl text-xs font-bold transition-[background-color,color,box-shadow] duration-150 ${
              view === key ? 'bg-surface-2 text-text shadow-sm shadow-black/30' : 'text-muted'
            }`}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'diary' ? (
        <div id="nutrition-diary" role="tabpanel">
      <div className="flex items-center justify-between pb-4">
        <button className="pressable rounded-lg p-2 text-muted" onClick={() => setDay((d) => subDays(d, 1))} aria-label="Día anterior">
          <IconChevronLeft size={20} />
        </button>
        <div className="text-center">
          <div className="font-bold">{isToday(day) ? 'Hoy' : format(day, "EEEE d 'de' MMMM", { locale: es })}</div>
          {!isToday(day) && (
            <button className="text-xs font-semibold text-primary" onClick={() => setDay(new Date())}>
              Ir a hoy
            </button>
          )}
        </div>
        <button
          className="pressable rounded-lg p-2 text-muted disabled:opacity-30"
          onClick={() => setDay((d) => addDays(d, 1))}
          disabled={isToday(day)}
          aria-label="Día siguiente"
        >
          <IconChevronRight size={20} />
        </button>
      </div>

      <DaySummary totals={totals} goals={goals} />

      {entries?.length === 0 && (
        <button className="btn btn-surface mt-3 w-full text-sm" onClick={() => void copyPreviousDay()}>
          <IconRepeat size={15} />
          Copiar el día anterior
        </button>
      )}

      <div className="flex flex-col gap-3 pt-4">
        {MEALS.map((m) => (
          <MealSection
            key={m.key}
            meal={m}
            entries={(entries ?? []).filter((e) => e.meal === m.key)}
            onAdd={() => setPickerFor(m.key)}
          />
        ))}
      </div>

        </div>
      ) : (
        <div id="nutrition-trends" role="tabpanel">
          <NutritionIntelligence goals={goals} todayKey={todayKey} />
          <WeightTrendCard goal={goals.goal} />
          <WeeklySummaryCard goals={goals} />
        </div>
      )}

      {pickerFor && <FoodPickerSheet open onClose={() => setPickerFor(null)} date={key} meal={pickerFor} />}
      <NutritionGoalsWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  )
}

function NutritionIntelligence({
  goals,
  todayKey,
}: {
  goals: { kcal: number; proteinG: number }
  todayKey: string
}) {
  const end = useMemo(() => new Date(`${todayKey}T12:00:00`), [todayKey])
  const since = dateKey(subDays(end, 13))
  const entries = useLiveQuery(
    () => db.foodLog.where('date').between(since, todayKey, true, true).toArray(),
    [since, todayKey],
    undefined,
  )
  const weights = useLiveQuery(
    () => db.measurements.where('kind').equals('weight').sortBy('date'),
    [],
    undefined,
  )
  const insight = useMemo(
    () => buildNutritionInsights(entries ?? [], weights ?? [], goals, end, 14),
    [end, entries, goals, weights],
  )

  if (entries === undefined || weights === undefined) return <SkeletonChart />

  const balance =
    insight.averageKcal !== null && insight.estimatedExpenditure !== null
      ? insight.averageKcal - insight.estimatedExpenditure
      : null
  const confidenceLabel = {
    low: 'Confianza baja',
    medium: 'Confianza media',
    high: 'Confianza alta',
  }[insight.expenditureConfidence]
  const chartData = insight.days.map((day) => ({
    ...day,
    label: format(new Date(`${day.date}T12:00:00`), 'd MMM', { locale: es }),
  }))

  return (
    <div>
      <section className="card relative overflow-hidden px-4 py-4">
        <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Últimos 14 días</p>
            <h2 className="pt-0.5 text-lg font-extrabold tracking-[-0.025em]">Inteligencia nutricional</h2>
            <p className="pt-0.5 text-xs text-muted">Tu gasto se aprende de ingesta + cambio de peso.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${insight.expenditureConfidence === 'low' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
            {confidenceLabel}
          </span>
        </div>

        <div className="relative mt-4 rounded-2xl border border-border/70 bg-surface-2/55 px-4 py-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted">Gasto energético estimado</p>
              <p className="pt-1 text-3xl font-extrabold tracking-[-0.05em] tabular-nums">
                {insight.estimatedExpenditure ?? '—'}
                {insight.estimatedExpenditure !== null && <span className="pl-1 text-sm font-medium text-muted">kcal/día</span>}
              </p>
            </div>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
              <IconFlame size={20} />
            </span>
          </div>
          {balance !== null ? (
            <p className="pt-2 text-xs leading-relaxed text-muted">
              Tu ingesta media de <strong className="text-text">{insight.averageKcal} kcal</strong> produce un{' '}
              <strong className={balance <= 0 ? 'text-success' : 'text-warning'}>
                {balance <= 0 ? 'déficit' : 'superávit'} estimado de {Math.abs(balance)} kcal/día
              </strong>.
            </p>
          ) : (
            <p className="pt-2 text-xs leading-relaxed text-muted">
              Registra al menos 10 de 14 días y 3 pesos distribuidos durante 14 días para activar esta estimación.
            </p>
          )}
        </div>

        <div className="relative mt-3 grid grid-cols-3 gap-2">
          <NutritionMetric label="Registro" value={`${insight.coveragePct}%`} detail={`${insight.loggedDays}/14 días`} />
          <NutritionMetric label="Calorías" value={`${insight.calorieAdherencePct}%`} detail="dentro de ±10%" />
          <NutritionMetric label="Proteína" value={`${insight.proteinAdherencePct}%`} detail="≥90% meta" />
        </div>
      </section>

      <section className="card mt-3 px-3 py-4" aria-label="Ingesta calórica de los últimos 14 días">
        <div className="flex items-center justify-between px-1 pb-3">
          <div>
            <h2 className="text-sm font-bold">Ingesta vs objetivo</h2>
            <p className="pt-0.5 text-[11px] text-muted">Los huecos son días sin registro, no ceros.</p>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
            meta {goals.kcal}
          </span>
        </div>
        {insight.loggedDays === 0 ? (
          <div className="grid min-h-44 place-items-center rounded-2xl bg-surface-2/30 px-5 text-center">
            <div>
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                <IconChart size={19} />
              </span>
              <p className="pt-2 text-xs font-bold">Registra comidas para ver tu patrón de ingesta</p>
              <p className="mx-auto max-w-xs pt-1 text-[10px] leading-relaxed text-muted">
                Los días aparecerán aquí al añadir alimentos al diario.
              </p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={185}>
            <BarChart data={chartData} margin={{ top: 6, right: 4, bottom: 0, left: -17 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="label" stroke="var(--color-muted)" fontSize={9} tickLine={false} axisLine={false} interval={2} />
              <YAxis stroke="var(--color-muted)" fontSize={9} tickLine={false} axisLine={false} width={42} />
              <ReferenceLine y={goals.kcal} stroke="var(--color-accent)" strokeDasharray="5 5" strokeOpacity={0.8} />
              <Tooltip
                cursor={{ fill: 'color-mix(in srgb, var(--color-primary) 7%, transparent)' }}
                contentStyle={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 11 }}
                formatter={(value) => [`${Number(value)} kcal`, 'Ingesta']}
              />
              <Bar dataKey="kcal" fill="var(--color-primary)" radius={[5, 5, 2, 2]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="sr-only">
          {insight.loggedDays} días registrados; promedio de {insight.averageKcal ?? 0} kilocalorías.
        </p>
      </section>

      <section className="card mt-3 px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
            <IconChart size={18} />
          </span>
          <div>
            <h2 className="text-sm font-bold">Lectura del coach</h2>
            <p className="pt-1 text-xs leading-relaxed text-muted">
              {insight.coveragePct < 70
                ? 'Prioriza la constancia de registro antes de cambiar calorías; con datos incompletos cualquier ajuste sería ruido.'
                : insight.proteinAdherencePct < 70
                  ? 'Tu mayor oportunidad es la proteína: alcanza al menos 90% del objetivo con más regularidad antes de mover calorías.'
                  : insight.calorieAdherencePct < 70
                    ? 'La ingesta varía bastante entre días. Acercarte al objetivo con más consistencia hará más fiable la tendencia.'
                    : 'Tu registro ya permite separar fluctuaciones diarias de una tendencia útil. Mantén el plan y evalúa cambios cada dos semanas.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function NutritionMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl bg-surface-2/50 px-2 py-2.5 text-center">
      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className="pt-0.5 text-lg font-extrabold tabular-nums">{value}</p>
      <p className="text-[8px] leading-tight text-muted">{detail}</p>
    </div>
  )
}

function DaySummary({
  totals,
  goals,
}: {
  totals: { kcal: number; p: number; c: number; f: number }
  goals: { kcal: number; proteinG: number; carbsG: number; fatG: number }
}) {
  const pct = Math.min(1, totals.kcal / Math.max(1, goals.kcal))
  const remaining = goals.kcal - totals.kcal
  const r = 42
  const circumference = 2 * Math.PI * r

  return (
    <div className="card px-4 py-4">
      <div className="flex items-center gap-4">
        <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90 shrink-0">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth="9" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={remaining < 0 ? 'var(--color-danger)' : 'var(--color-primary)'}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            style={{ transition: 'stroke-dashoffset 0.3s' }}
          />
        </svg>
        <div className="flex-1">
          <div className="text-2xl font-extrabold tabular-nums">
            {Math.round(totals.kcal)} <span className="text-sm font-normal text-muted">/ {goals.kcal} kcal</span>
          </div>
          <div className={`text-xs font-semibold ${remaining < 0 ? 'text-danger' : 'text-muted'}`}>
            {remaining >= 0 ? `${Math.round(remaining)} kcal restantes` : `${Math.round(-remaining)} kcal de más`}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-4">
        <MacroBar label="Proteína" value={totals.p} goal={goals.proteinG} color="#3d8bfd" />
        <MacroBar label="Carbos" value={totals.c} goal={goals.carbsG} color="#33c076" />
        <MacroBar label="Grasas" value={totals.f} goal={goals.fatG} color="#f2a33c" />
      </div>
    </div>
  )
}

function MacroBar({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  const pct = Math.min(100, (value / Math.max(1, goal)) * 100)
  return (
    <div>
      <div className="flex justify-between pb-1 text-[10px] font-bold uppercase text-muted">
        <span>{label}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="pt-1 text-xs font-semibold tabular-nums">
        {Math.round(value)}g <span className="text-muted">/ {goal}g</span>
      </div>
    </div>
  )
}

function MealSection({
  meal,
  entries,
  onAdd,
}: {
  meal: { key: MealKey; label: string }
  entries: FoodLogEntry[]
  onAdd: () => void
}) {
  const kcal = entries.reduce((a, e) => a + e.kcal, 0)
  const [menuFor, setMenuFor] = useState<FoodLogEntry | null>(null)
  const [editFor, setEditFor] = useState<FoodLogEntry | null>(null)

  const duplicate = (e: FoodLogEntry) => {
    void db.foodLog.put({ ...e, id: uid() })
  }
  const remove = (e: FoodLogEntry) => {
    void db.foodLog.delete(e.id)
    toastUndo('Alimento eliminado', () => void db.foodLog.put(e))
  }

  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between pb-2">
        <span className="font-bold">{meal.label}</span>
        <div className="flex items-center gap-3">
          {kcal > 0 && <span className="text-xs text-muted tabular-nums">{Math.round(kcal)} kcal</span>}
          <button className="pressable text-primary" onClick={onAdd} aria-label={`Añadir a ${meal.label}`}>
            <IconPlus size={17} />
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="py-1 text-xs text-muted">Sin registros.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border/50">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{e.name}</div>
                <div className="text-xs text-muted tabular-nums">
                  {e.grams}g · {Math.round(e.kcal)} kcal · P{e.p} C{e.c} G{e.f}
                </div>
              </div>
              <button className="pressable rounded-lg p-1 text-muted" onClick={() => setMenuFor(e)} aria-label="Opciones">
                <IconDots size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <ActionSheet
        open={!!menuFor}
        onClose={() => setMenuFor(null)}
        title={menuFor?.name}
        actions={[
          { label: 'Editar cantidad', onClick: () => setEditFor(menuFor) },
          { label: 'Duplicar', onClick: () => duplicate(menuFor!) },
          { label: 'Eliminar', danger: true, onClick: () => remove(menuFor!) },
        ]}
      />
      <EditGramsSheet entry={editFor} onClose={() => setEditFor(null)} />
    </div>
  )
}

/** Ajusta la cantidad (g) de una entrada ya registrada. Si el alimento origen sigue en Dexie,
 *  recalcula exacto desde sus valores por 100 g; si no (base local, plato, borrado), escala
 *  proporcionalmente (los redondeos previos pueden acumular una deriva mínima). */
function EditGramsSheet({ entry, onClose }: { entry: FoodLogEntry | null; onClose: () => void }) {
  const [grams, setGrams] = useState('')

  useEffect(() => {
    if (entry) setGrams(String(entry.grams))
  }, [entry])

  const save = async () => {
    if (!entry) return
    const g = parseDec(grams)
    if (g <= 0) return
    const food = entry.foodId ? await db.foods.get(entry.foodId) : undefined
    const ratio = g / entry.grams
    const macros = food
      ? macrosForGrams(food, g)
      : {
          kcal: Math.round(entry.kcal * ratio),
          p: Math.round(entry.p * ratio * 10) / 10,
          c: Math.round(entry.c * ratio * 10) / 10,
          f: Math.round(entry.f * ratio * 10) / 10,
        }
    await db.foodLog.put({ ...entry, grams: g, ...macros })
    onClose()
  }

  return (
    <Sheet open={!!entry} onClose={onClose} title={entry?.name}>
      <div className="flex flex-col gap-4 pb-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Cantidad (g)</span>
          <input
            autoFocus
            className="input text-center text-lg font-bold"
            inputMode="decimal"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <button className="btn btn-primary" disabled={parseDec(grams) <= 0} onClick={() => void save()}>
          Guardar
        </button>
      </div>
    </Sheet>
  )
}

function WeightTrendCard({ goal }: { goal: 'bulk' | 'maintain' | 'cut' }) {
  const measurements = useLiveQuery(
    () => db.measurements.where('kind').equals('weight').sortBy('date'),
    [],
    undefined,
  )
  const [logOpen, setLogOpen] = useState(false)
  const [value, setValue] = useState('')

  const points = useMemo(() => {
    if (!measurements) return []
    // EMA sobre TODA la serie y luego recortar: si se suaviza solo la ventana visible,
    // el primer punto de tendencia es el peso crudo y el %/semana sale sesgado
    const smoothed = ema(measurements.map((m) => ({ date: m.date, value: m.value })))
    const start = Math.max(0, measurements.length - 30)
    return measurements
      .slice(start)
      .map((m, i) => ({ date: m.date, real: m.value, trend: smoothed[start + i] }))
  }, [measurements])

  const pct = useMemo(() => weeklyChangePct(points), [points])
  const suggestion = suggestCalorieAdjustment(goal, pct)

  const save = async () => {
    const n = parseDec(value)
    if (n <= 0) return
    await db.measurements.put({ id: uid(), date: Date.now(), kind: 'weight', value: n })
    setValue('')
    setLogOpen(false)
  }

  if (measurements === undefined) return <SkeletonChart />

  return (
    <div className="card mt-4 px-4 py-3">
      <div className="flex items-center justify-between pb-2">
        <span className="font-bold">Peso corporal</span>
        <button className="text-xs font-bold text-primary" onClick={() => setLogOpen(true)}>
          + Registrar
        </button>
      </div>
      {points.length < 2 ? (
        <p className="py-4 text-center text-sm text-muted">
          Registra tu peso un par de días para ver la tendencia.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#2a2a33" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => format(d, 'd MMM', { locale: es })} stroke="#8f8f9b" fontSize={10} tickLine={false} />
              <YAxis stroke="#8f8f9b" fontSize={10} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: '#1f1f27', border: '1px solid #2a2a33', borderRadius: 12, fontSize: 12 }}
                labelFormatter={(d) => format(Number(d), "d 'de' MMMM", { locale: es })}
              />
              <Line type="monotone" dataKey="real" stroke="#8f8f9b" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="trend" stroke="#3d8bfd" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          {pct !== null && (
            <p className="pt-1 text-center text-xs text-muted">
              Tendencia: {pct >= 0 ? '+' : ''}
              {pct.toFixed(2)}%/semana
            </p>
          )}
          {suggestion && (
            <div className="mt-2 rounded-xl bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
              {suggestion.reason}
            </div>
          )}
        </>
      )}

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title="Registrar peso">
        <div className="flex flex-col gap-3 pb-2">
          <input
            autoFocus
            className="input text-center text-lg font-bold"
            inputMode="decimal"
            placeholder="75.5"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button className="btn btn-primary" disabled={!value.trim()} onClick={() => void save()}>
            Guardar
          </button>
        </div>
      </Sheet>
    </div>
  )
}

function WeeklySummaryCard({ goals }: { goals: { kcal: number; proteinG: number } }) {
  const since = dateKey(subDays(new Date(), 6))
  const today = dateKey(new Date())
  const entries = useLiveQuery(
    () => db.foodLog.where('date').between(since, today, true, true).toArray(),
    [since, today],
    undefined,
  )

  const byDay = useMemo(() => {
    const m = new Map<string, { kcal: number; p: number }>()
    for (const e of entries ?? []) {
      const cur = m.get(e.date) ?? { kcal: 0, p: 0 }
      cur.kcal += e.kcal
      cur.p += e.p
      m.set(e.date, cur)
    }
    return m
  }, [entries])

  if (entries === undefined) return null
  const days = [...byDay.values()]
  if (days.length === 0) return null
  const avgKcal = days.reduce((a, d) => a + d.kcal, 0) / days.length
  const avgP = days.reduce((a, d) => a + d.p, 0) / days.length

  return (
    <div className="card mt-4 px-4 py-3">
      <h2 className="pb-2 font-bold">Resumen semanal</h2>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-extrabold tabular-nums">{Math.round(avgKcal)}</div>
          <div className="text-[10px] text-muted">kcal/día media</div>
        </div>
        <div>
          <div className="text-lg font-extrabold tabular-nums">{Math.round(avgP)}g</div>
          <div className="text-[10px] text-muted">proteína media</div>
        </div>
        <div>
          <div className="text-lg font-extrabold tabular-nums">{days.length}/7</div>
          <div className="text-[10px] text-muted">días registrados</div>
        </div>
      </div>
      <p className="pt-2 text-center text-[11px] text-muted">Objetivo: {goals.kcal} kcal · {goals.proteinG}g proteína</p>
    </div>
  )
}
