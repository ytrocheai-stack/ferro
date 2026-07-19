import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { ACTIVITY_LABELS, GOAL_LABELS, useNutrition, type ActivityLevel, type Goal, type Sex } from '../stores/nutrition'
import { bmr, computeTargets, tdee } from '../lib/nutrition'
import { parseDec, uid } from '../lib/format'
import { Select } from './Select'
import { Sheet } from './Sheet'

export function NutritionGoalsWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const goals = useNutrition((s) => s.goals)
  const setGoals = useNutrition((s) => s.setGoals)
  // Último pesaje por FECHA real, no por orden de inserción (`.last()` ordenaría por el índice
  // `kind`, cuyo desempate es la clave primaria aleatoria — devolvía un peso al azar).
  const lastWeight = useLiveQuery(
    async () => {
      const list = await db.measurements.where('kind').equals('weight').sortBy('date')
      return list.at(-1)
    },
    [],
    undefined,
  )

  const [sex, setSex] = useState<Sex>(goals.sex)
  const [age, setAge] = useState(String(goals.age))
  const [heightCm, setHeightCm] = useState(String(goals.heightCm))
  const [weightKg, setWeightKg] = useState('')
  const [weightTouched, setWeightTouched] = useState(false)
  const [activity, setActivity] = useState<ActivityLevel>(goals.activity)
  const [goal, setGoal] = useState<Goal>(goals.goal)

  // Al abrir la hoja, permite que el peso vuelva a precargarse desde el último pesaje real.
  useEffect(() => {
    if (open) setWeightTouched(false)
  }, [open])

  // `useLiveQuery` resuelve de forma asíncrona: sincroniza en cuanto llega el dato, mientras
  // el usuario no haya escrito nada él mismo.
  useEffect(() => {
    if (!weightTouched && lastWeight) setWeightKg(String(lastWeight.value))
  }, [lastWeight, weightTouched])

  const preview = useMemo(() => {
    const w = parseDec(weightKg)
    const h = parseDec(heightCm)
    const a = parseInt(age) || 0
    if (!w || !h || !a) return null
    const b = bmr(sex, w, h, a)
    const t = tdee(b, activity)
    return computeTargets(t, w, goal)
  }, [sex, age, heightCm, weightKg, activity, goal])

  const save = async () => {
    if (!preview) return
    const w = parseDec(weightKg)
    setGoals({
      configured: true,
      sex,
      age: parseInt(age) || 25,
      heightCm: parseDec(heightCm) || 175,
      activity,
      goal,
      ...preview,
    })
    if (!lastWeight || Math.abs(lastWeight.value - w) > 0.001) {
      await db.measurements.put({ id: uid(), date: Date.now(), kind: 'weight', value: w })
    }
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Calcular mis objetivos" full>
      <div className="flex flex-col gap-4 pb-4">
        <div className="flex gap-2">
          {(['male', 'female'] as const).map((s) => (
            <button
              key={s}
              className={`btn flex-1 ${sex === s ? 'btn-primary' : 'btn-surface'}`}
              onClick={() => setSex(s)}
            >
              {s === 'male' ? 'Hombre' : 'Mujer'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Edad" value={age} onChange={setAge} suffix="años" />
          <Field label="Altura" value={heightCm} onChange={setHeightCm} suffix="cm" />
          <Field
            label="Peso"
            value={weightKg}
            onChange={(v) => {
              setWeightTouched(true)
              setWeightKg(v)
            }}
            suffix="kg"
            placeholder="80"
          />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Nivel de actividad</span>
          <Select
            value={activity}
            onChange={setActivity}
            options={(Object.entries(ACTIVITY_LABELS) as [ActivityLevel, string][]).map(([k, v]) => ({
              value: k,
              label: v,
            }))}
            sheetTitle="Nivel de actividad"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Objetivo</span>
          <Select
            value={goal}
            onChange={setGoal}
            options={(Object.entries(GOAL_LABELS) as [Goal, string][]).map(([k, v]) => ({
              value: k,
              label: v,
            }))}
            sheetTitle="Objetivo"
          />
        </label>

        {preview && (
          <div className="card px-4 py-3">
            <div className="pb-2 text-center text-2xl font-extrabold tabular-nums text-primary">
              {preview.kcal} kcal/día
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div>
                <div className="font-bold tabular-nums">{preview.proteinG}g</div>
                <div className="text-xs text-muted">Proteína</div>
              </div>
              <div>
                <div className="font-bold tabular-nums">{preview.carbsG}g</div>
                <div className="text-xs text-muted">Carbos</div>
              </div>
              <div>
                <div className="font-bold tabular-nums">{preview.fatG}g</div>
                <div className="text-xs text-muted">Grasas</div>
              </div>
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted">
          Calculado con la fórmula de Mifflin-St Jeor. Podrás ajustar estos valores a mano en cualquier
          momento desde Nutrición → Ajustar objetivos.
        </p>

        <button className="btn btn-primary" disabled={!preview} onClick={() => void save()}>
          Guardar objetivos
        </button>
      </div>
    </Sheet>
  )
}

function Field({
  label,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  suffix: string
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase text-muted">{label}</span>
      <div className="relative">
        <input
          className="input pr-9 text-center"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted">
          {suffix}
        </span>
      </div>
    </label>
  )
}
