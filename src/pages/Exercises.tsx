import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { searchExercises, useCatalog } from '../data/exercises'
import { t } from '../data/translations'
import { ExerciseFilterBar } from '../components/ExercisePicker'
import { ExerciseThumb } from '../components/ExerciseThumb'
import { CustomExerciseSheet } from '../components/CustomExerciseSheet'
import { IconChevronRight, IconPlus } from '../components/icons'

export default function Exercises() {
  const { all, ready, error } = useCatalog()
  const [query, setQuery] = useState('')
  const [bodyPart, setBodyPart] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<string | null>(null)
  const [onlyCustom, setOnlyCustom] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const results = useMemo(
    () => searchExercises(all, { query, bodyPart, equipment, onlyCustom }),
    [all, query, bodyPart, equipment, onlyCustom],
  )

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

      <ExerciseFilterBar
        {...{ query, setQuery, bodyPart, setBodyPart, equipment, setEquipment, all }}
      />

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

      <div>
        {results.map((e) => (
          <Link
            key={e.id}
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
        ))}
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
