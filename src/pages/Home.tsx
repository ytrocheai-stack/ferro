import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Routine } from '../db/types'
import { useActive } from '../stores/activeWorkout'
import { useCatalog } from '../data/exercises'
import { ActionSheet, Confirm } from '../components/Sheet'
import {
  IconDots,
  IconDumbbell,
  IconPencil,
  IconPlay,
  IconPlus,
  IconTrash,
} from '../components/icons'
import { uid } from '../lib/format'

export default function Home() {
  const navigate = useNavigate()
  const routines = useLiveQuery(() => db.routines.orderBy('sortOrder').toArray(), [], undefined)
  const session = useActive((s) => s.session)
  const { byId } = useCatalog()
  const [menuFor, setMenuFor] = useState<Routine | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Routine | null>(null)
  const [confirmReplace, setConfirmReplace] = useState<Routine | 'empty' | null>(null)

  const start = async (what: Routine | 'empty') => {
    const { startEmpty, startFromRoutine } = useActive.getState()
    if (what === 'empty') startEmpty()
    else await startFromRoutine(what)
    navigate('/entreno')
  }

  const requestStart = (what: Routine | 'empty') => {
    if (session) setConfirmReplace(what)
    else void start(what)
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="pb-4 text-2xl font-extrabold">Entrenar</h1>

      <button className="btn btn-primary w-full" onClick={() => requestStart('empty')}>
        <IconPlus size={18} />
        Empezar entreno vacío
      </button>

      <div className="flex items-center justify-between pb-3 pt-7">
        <h2 className="text-lg font-bold">
          Mis rutinas{' '}
          {routines !== undefined && <span className="text-sm text-muted">({routines.length})</span>}
        </h2>
        <button
          className="flex items-center gap-1 text-sm font-semibold text-primary"
          onClick={() => navigate('/rutina/nueva')}
        >
          <IconPlus size={15} />
          Nueva rutina
        </button>
      </div>

      {routines !== undefined && routines.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-4 py-8 text-center">
          <IconDumbbell size={32} className="text-muted" />
          <p className="font-semibold">Aún no tienes rutinas</p>
          <p className="text-sm text-muted">
            Crea una rutina con tus ejercicios para empezar más rápido cada día.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(routines ?? []).map((r) => (
          <div key={r.id} className="card px-4 py-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-bold">{r.name}</div>
                <div className="line-clamp-2 pt-0.5 text-xs leading-relaxed text-muted">
                  {r.exercises
                    .map((e) => byId.get(e.exerciseId)?.name ?? 'Ejercicio eliminado')
                    .join(' · ')}
                </div>
              </div>
              <button
                className="shrink-0 rounded-lg p-1.5 text-muted active:bg-surface-2"
                onClick={() => setMenuFor(r)}
                aria-label="Opciones de rutina"
              >
                <IconDots size={18} />
              </button>
            </div>
            <button className="btn btn-primary mt-3 w-full py-2.5" onClick={() => requestStart(r)}>
              <IconPlay size={15} />
              Empezar rutina
            </button>
          </div>
        ))}
      </div>

      <ActionSheet
        open={!!menuFor}
        onClose={() => setMenuFor(null)}
        title={menuFor?.name}
        actions={[
          {
            label: 'Editar rutina',
            icon: <IconPencil size={18} />,
            onClick: () => navigate(`/rutina/${menuFor!.id}`),
          },
          {
            label: 'Duplicar rutina',
            icon: <IconPlus size={18} />,
            onClick: () => {
              const r = menuFor!
              void db.routines.put({
                ...r,
                id: uid(),
                name: `${r.name} (copia)`,
                sortOrder: Date.now(),
                createdAt: Date.now(),
              })
            },
          },
          {
            label: 'Eliminar rutina',
            icon: <IconTrash size={18} />,
            danger: true,
            onClick: () => setConfirmDelete(menuFor),
          },
        ]}
      />

      <Confirm
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="¿Eliminar rutina?"
        message={`"${confirmDelete?.name}" se eliminará. Tus entrenos pasados no se tocan.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void db.routines.delete(confirmDelete!.id)}
      />

      <Confirm
        open={!!confirmReplace}
        onClose={() => setConfirmReplace(null)}
        title="Entreno en curso"
        message="Ya tienes un entreno en curso. Si empiezas otro, el actual se descartará."
        confirmLabel="Descartar y empezar"
        danger
        onConfirm={() => {
          useActive.getState().discard()
          void start(confirmReplace!)
        }}
      />
    </div>
  )
}
