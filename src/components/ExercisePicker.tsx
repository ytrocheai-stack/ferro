import { useMemo, useState } from 'react'
import type { Exercise } from '../data/exercises'
import { equipmentOptions, searchExercises, useCatalog } from '../data/exercises'
import { BODY_PARTS, t } from '../data/translations'
import { Sheet } from './Sheet'
import { ExerciseThumb } from './ExerciseThumb'
import { SkeletonList } from './Skeleton'
import { IconCheck, IconChevronDown, IconSearch } from './icons'

/** Barra de búsqueda + filtros por grupo muscular y equipo. Reutilizada por la
 *  página Ejercicios y por el selector. */
export function ExerciseFilterBar({
  query,
  setQuery,
  bodyPart,
  setBodyPart,
  equipment,
  setEquipment,
  all,
}: {
  query: string
  setQuery: (v: string) => void
  bodyPart: string | null
  setBodyPart: (v: string | null) => void
  equipment: string | null
  setEquipment: (v: string | null) => void
  all: Exercise[]
}) {
  const [openFilter, setOpenFilter] = useState<'body' | 'equip' | null>(null)
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
        <button
          className={`chip ${bodyPart ? 'chip-active' : ''}`}
          onClick={() => setOpenFilter('body')}
        >
          {bodyPart ? t(bodyPart) : 'Grupo muscular'} <IconChevronDown size={13} />
        </button>
        <button
          className={`chip ${equipment ? 'chip-active' : ''}`}
          onClick={() => setOpenFilter('equip')}
        >
          {equipment ? t(equipment) : 'Equipo'} <IconChevronDown size={13} />
        </button>
        {(bodyPart || equipment) && (
          <button
            className="chip text-muted"
            onClick={() => {
              setBodyPart(null)
              setEquipment(null)
            }}
          >
            Limpiar
          </button>
        )}
      </div>

      <Sheet
        open={openFilter === 'body'}
        onClose={() => setOpenFilter(null)}
        title="Grupo muscular"
      >
        <OptionList
          options={BODY_PARTS}
          selected={bodyPart}
          onSelect={(v) => {
            setBodyPart(v)
            setOpenFilter(null)
          }}
        />
      </Sheet>
      <Sheet open={openFilter === 'equip'} onClose={() => setOpenFilter(null)} title="Equipo">
        <OptionList
          options={equipments}
          selected={equipment}
          onSelect={(v) => {
            setEquipment(v)
            setOpenFilter(null)
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
        className={`rounded-xl px-3 py-3 text-left ${selected === null ? 'font-bold text-primary' : ''}`}
        onClick={() => onSelect(null)}
      >
        Todos
      </button>
      {options.map((o) => (
        <button
          key={o}
          className={`rounded-xl px-3 py-3 text-left ${selected === o ? 'font-bold text-primary' : ''}`}
          onClick={() => onSelect(o)}
        >
          {t(o)}
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
  const [bodyPart, setBodyPart] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  const results = useMemo(
    () => searchExercises(all, { query, bodyPart, equipment, onlyCustom: false }),
    [all, query, bodyPart, equipment],
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
          {...{ query, setQuery, bodyPart, setBodyPart, equipment, setEquipment, all }}
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
