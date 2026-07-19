import { useMemo, useState } from 'react'
import type { Exercise, ExerciseGroup } from '../data/exercises'
import { equipmentOptions, searchExercises, useCatalog } from '../data/exercises'
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_ORDER } from '../data/muscleGroups'
import { t } from '../data/translations'
import { Sheet } from './Sheet'
import { ExerciseThumb } from './ExerciseThumb'
import { SkeletonList } from './Skeleton'
import { IconCheck, IconChevronDown, IconSearch } from './icons'

const GROUP_CHIPS: { value: ExerciseGroup; label: string }[] = [
  ...MUSCLE_GROUP_ORDER.map((g) => ({ value: g, label: MUSCLE_GROUP_LABELS[g] })),
  { value: 'cardio', label: 'Cardio' },
]

/** Barra de búsqueda + filtros por grupo muscular y equipo. Reutilizada por la
 *  página Ejercicios y por el selector. */
export function ExerciseFilterBar({
  query,
  setQuery,
  group,
  setGroup,
  equipment,
  setEquipment,
  all,
}: {
  query: string
  setQuery: (v: string) => void
  group: ExerciseGroup | null
  setGroup: (v: ExerciseGroup | null) => void
  equipment: string | null
  setEquipment: (v: string | null) => void
  all: Exercise[]
}) {
  const [equipOpen, setEquipOpen] = useState(false)
  const equipments = useMemo(() => equipmentOptions(all), [all])

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative">
        <IconSearch size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input pl-9"
          placeholder="Buscar ejercicio…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-0.5">
        <button className={`chip shrink-0 ${group === null ? 'chip-active' : ''}`} onClick={() => setGroup(null)}>
          Todos
        </button>
        {GROUP_CHIPS.map((g) => (
          <button
            key={g.value}
            className={`chip shrink-0 ${group === g.value ? 'chip-active' : ''}`}
            onClick={() => setGroup(group === g.value ? null : g.value)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-0.5">
        <button
          className={`chip shrink-0 ${equipment ? 'chip-active' : ''}`}
          onClick={() => setEquipOpen(true)}
        >
          {equipment ? t(equipment) : 'Equipo'} <IconChevronDown size={13} />
        </button>
        {(group || equipment) && (
          <button
            className="chip shrink-0 text-muted"
            onClick={() => {
              setGroup(null)
              setEquipment(null)
            }}
          >
            Limpiar
          </button>
        )}
      </div>

      <Sheet open={equipOpen} onClose={() => setEquipOpen(false)} title="Equipo">
        <OptionList
          options={equipments}
          selected={equipment}
          onSelect={(v) => {
            setEquipment(v)
            setEquipOpen(false)
          }}
        />
      </Sheet>
    </div>
  )
}

function OptionList({
  options,
  selected,
  onSelect,
}: {
  options: string[]
  selected: string | null
  onSelect: (v: string | null) => void
}) {
  return (
    <div className="flex flex-col pb-2">
      <button
        className="flex min-h-11 items-center justify-between rounded-xl px-3 py-2.5 text-left active:bg-surface-2"
        onClick={() => onSelect(null)}
      >
        <span className={selected === null ? 'font-semibold text-primary' : ''}>Todos</span>
        {selected === null && <IconCheck size={17} className="text-primary" />}
      </button>
      {options.map((o) => (
        <button
          key={o}
          className="flex min-h-11 items-center justify-between rounded-xl px-3 py-2.5 text-left active:bg-surface-2"
          onClick={() => onSelect(o)}
        >
          <span className={selected === o ? 'font-semibold text-primary' : ''}>{t(o)}</span>
          {selected === o && <IconCheck size={17} className="text-primary" />}
        </button>
      ))}
    </div>
  )
}

/** Selector multi-selección de ejercicios (hoja a pantalla casi completa). */
export function ExercisePicker({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (ids: string[]) => void
}) {
  const { all, ready } = useCatalog()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<ExerciseGroup | null>(null)
  const [equipment, setEquipment] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  const results = useMemo(
    () => searchExercises(all, { query, group, equipment, onlyCustom: false }),
    [all, query, group, equipment],
  )

  const toggle = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]))

  const close = () => {
    setSelected([])
    setQuery('')
    onClose()
  }

  return (
    <Sheet open={open} onClose={close} title="Añadir ejercicios" full>
      <div className="flex h-full flex-col gap-3">
        <ExerciseFilterBar
          {...{ query, setQuery, group, setGroup, equipment, setEquipment, all }}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!ready && <SkeletonList rows={7} />}
          {ready && results.length === 0 && (
            <p className="py-8 text-center text-muted">Sin resultados</p>
          )}
          {results.map((e) => {
            const isSel = selected.includes(e.id)
            return (
              <button
                key={e.id}
                onClick={() => toggle(e.id)}
                className={`flex w-full items-center gap-3 border-b border-border/60 px-1 py-2.5 text-left ${
                  isSel ? 'bg-primary/10' : ''
                }`}
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' }}
              >
                <ExerciseThumb exercise={e} size={46} lazy />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{e.name}</div>
                  <div className="truncate text-xs text-muted">
                    {t(e.target)} · {t(e.equipment)}
                  </div>
                </div>
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                    isSel ? 'border-primary bg-primary text-white' : 'border-border text-transparent'
                  }`}
                >
                  <IconCheck size={13} />
                </div>
              </button>
            )
          })}
        </div>
        {selected.length > 0 && (
          <div className="sticky bottom-0 pb-1 pt-1">
            <button
              className="btn btn-primary w-full"
              onClick={() => {
                onAdd(selected)
                close()
              }}
            >
              Añadir {selected.length} {selected.length === 1 ? 'ejercicio' : 'ejercicios'}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
