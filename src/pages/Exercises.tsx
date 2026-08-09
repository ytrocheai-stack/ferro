import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Virtuoso } from 'react-virtuoso'
import type { Exercise, ExerciseGroup } from '../data/exercises'
import { exerciseGroup, searchExercises, useCatalog } from '../data/exercises'
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_ORDER } from '../data/muscleGroups'
import { t } from '../data/translations'
import { ExerciseFilterBar } from '../components/ExercisePicker'
import { ExerciseThumb } from '../components/ExerciseThumb'
import { CustomExerciseSheet } from '../components/CustomExerciseSheet'
import { SkeletonList } from '../components/Skeleton'
import { IconChevronRight, IconPlus } from '../components/icons'

const GROUP_SECTION_LABELS: Record<ExerciseGroup, string> = {
  ...MUSCLE_GROUP_LABELS,
  cardio: 'Cardio',
}

interface ExerciseSection {
  key: string
  label: string
  items: Exercise[]
}

/** Agrupa por músculo (orden canónico + Cardio + Otros al final); alfabético dentro de cada grupo. */
function groupByMuscle(items: Exercise[]): ExerciseSection[] {
  const buckets = new Map<string, Exercise[]>()
  for (const e of items) {
    const key = exerciseGroup(e) ?? 'other'
    const list = buckets.get(key)
    if (list) list.push(e)
    else buckets.set(key, [e])
  }
  const order = [...MUSCLE_GROUP_ORDER, 'cardio', 'other']
  return order
    .filter((key) => buckets.has(key))
    .map((key) => ({
      key,
      label: key === 'other' ? 'Otros' : GROUP_SECTION_LABELS[key as ExerciseGroup],
      items: buckets.get(key)!,
    }))
}

export default function Exercises() {
  const { all, ready, error } = useCatalog()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<ExerciseGroup | null>(null)
  const [equipment, setEquipment] = useState<string | null>(null)
  const [onlyCustom, setOnlyCustom] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const results = useMemo(
    () => searchExercises(all, { query, group, equipment, onlyCustom }),
    [all, query, group, equipment, onlyCustom],
  )

  const showSections = !query.trim() && !group && !equipment && !onlyCustom
  const sections = useMemo(() => (showSections ? groupByMuscle(results) : []), [showSections, results])
  const virtualItems = useMemo(() => {
    if (!showSections) return results.map((exercise) => ({ type: 'exercise' as const, exercise }))
    return sections.flatMap((section) => [
      { type: 'header' as const, key: section.key, label: section.label, count: section.items.length },
      ...section.items.map((exercise) => ({ type: 'exercise' as const, exercise })),
    ])
  }, [results, sections, showSections])

  return (
    <div className="px-4 pt-6">
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-2xl font-extrabold">Ejercicios</h1>
        <button
          className="flex items-center gap-1 text-sm font-semibold text-primary"
          onClick={() => setCreateOpen(true)}
        >
          <IconPlus size={15} />
          Nuevo
        </button>
      </div>

      <ExerciseFilterBar {...{ query, setQuery, group, setGroup, equipment, setEquipment, all }} />

      <div className="flex items-center justify-between pb-1 pt-3">
        <span className="text-xs text-muted">
          {ready ? `${results.length} ejercicios` : 'Cargando biblioteca…'}
        </span>
        <button
          className={`chip ${onlyCustom ? 'chip-active' : ''}`}
          onClick={() => setOnlyCustom(!onlyCustom)}
        >
          Míos
        </button>
      </div>

      {error && (
        <div className="card mt-3 px-4 py-4 text-sm text-danger">
          Error al cargar la biblioteca: {error}
        </div>
      )}

      {!ready && !error && <SkeletonList rows={9} />}

      <div className="-mx-4">
        {ready && virtualItems.length > 0 && (
          <Virtuoso
            useWindowScroll
            data={virtualItems}
            computeItemKey={(_, item) => item.type === 'header' ? `section-${item.key}` : item.exercise.id}
            itemContent={(_, item) => item.type === 'header' ? (
              <div className="sticky top-[env(safe-area-inset-top)] z-10 bg-bg/95 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-muted backdrop-blur">
                {item.label} <span className="text-muted/70">· {item.count}</span>
              </div>
            ) : <ExerciseRow exercise={item.exercise} />}
          />
        )}
        {ready && results.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            {onlyCustom
              ? 'No tienes ejercicios personalizados. Crea uno con «Nuevo».'
              : 'Sin resultados para esa búsqueda.'}
          </p>
        )}
      </div>

      <CustomExerciseSheet open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

function ExerciseRow({ exercise: e }: { exercise: Exercise }) {
  return (
    <Link
      to={`/ejercicios/${e.id}`}
      className="flex items-center gap-3 border-b border-border/60 py-2.5"
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' }}
    >
      <ExerciseThumb exercise={e} size={46} lazy />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {e.name}
          {e.custom && (
            <span className="ml-1.5 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
              MÍO
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted">
          {t(e.target)} · {t(e.equipment)}
        </div>
      </div>
      <IconChevronRight size={16} className="shrink-0 text-muted" />
    </Link>
  )
}
