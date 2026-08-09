import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, isToday, subDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { db } from '../db/db'
import type { FoodLogEntry, MealKey } from '../db/types'
import { macrosForGrams } from '../data/foods'
import { useNutrition } from '../stores/nutrition'
import { ema } from '../lib/stats'
import { suggestCalorieAdjustment, weeklyChangePct } from '../lib/nutrition'
import { parseDec, uid } from '../lib/format'
import { toastUndo } from '../stores/toasts'
import { FoodPickerSheet } from '../components/FoodPicker'
import { NutritionGoalsWizard } from '../components/NutritionGoalsWizard'
import { ActionSheet, Sheet } from '../components/Sheet'
import { SkeletonChart } from '../components/Skeleton'
import { IconChevronLeft, IconChevronRight, IconDots, IconPlus, IconRepeat, IconTarget } from '../components/icons'
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
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-2xl font-extrabold">Nutrición</h1>
        <button
          className="pressable rounded-lg p-1.5 text-muted"
          onClick={() => setWizardOpen(true)}
          aria-label="Ajustar objetivos"
        >
          <IconTarget size={20} />
        </button>
      </div>

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

      <WeightTrendCard goal={goals.goal} />
      <WeeklySummaryCard goals={goals} />

      {pickerFor && <FoodPickerSheet open onClose={() => setPickerFor(null)} date={key} meal={pickerFor} />}
      <NutritionGoalsWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
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
