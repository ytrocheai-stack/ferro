import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { startOfWeek } from 'date-fns'
import { db } from '../db/db'
import type { Routine } from '../db/types'
import { useActive } from '../stores/activeWorkout'
import { useSettings } from '../stores/settings'
import { useCatalog } from '../data/exercises'
import { toastUndo } from '../stores/toasts'
import { ActionSheet, Confirm, Sheet } from '../components/Sheet'
import { TemplateBrowserSheet } from '../components/TemplateBrowser'
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconDumbbell,
  IconFolder,
  IconPlay,
  IconPlus,
  IconTarget,
} from '../components/icons'
import { uid } from '../lib/format'
import { useLocalDateKey } from '../lib/useLocalDateKey'

export default function Home() {
  const navigate = useNavigate()
  const dateKey = useLocalDateKey()
  const routines = useLiveQuery(() => db.routines.orderBy('sortOrder').toArray(), [], undefined)
  const folders = useLiveQuery(() => db.folders.orderBy('sortOrder').toArray(), [], [])
  const workoutsThisWeek = useLiveQuery(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime()
    return db.workouts.where('startedAt').aboveOrEqual(start).count()
  }, [dateKey])
  const weeklyGoal = useSettings((s) => s.weeklyGoal)
  const session = useActive((s) => s.session)
  const { byId } = useCatalog()
  const [menuFor, setMenuFor] = useState<Routine | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Routine | null>(null)
  const [confirmReplace, setConfirmReplace] = useState<Routine | 'empty' | null>(null)
  const [moveFolderFor, setMoveFolderFor] = useState<Routine | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

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

  const grouped = useMemo(() => {
    const list = routines ?? []
    const byFolder = new Map<string | undefined, Routine[]>()
    for (const r of list) {
      const key = r.folderId
      if (!byFolder.has(key)) byFolder.set(key, [])
      byFolder.get(key)!.push(r)
    }
    return byFolder
  }, [routines])

  const unfiled = grouped.get(undefined) ?? []
  const progress = weeklyGoal > 0 ? Math.min(1, (workoutsThisWeek ?? 0) / weeklyGoal) : 0
  const ringOffset = 2 * Math.PI * 16 * (1 - progress)

  return (
    <div className="px-4 pt-6">
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-2xl font-extrabold">Entrenar</h1>
        {weeklyGoal > 0 && (
          <div className="flex items-center gap-2 text-xs font-semibold text-muted">
            <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90">
              <circle cx="18" cy="18" r="16" fill="none" stroke="var(--color-surface-2)" strokeWidth="3.5" />
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 16}
                strokeDashoffset={ringOffset}
                style={{ transition: 'stroke-dashoffset 0.3s' }}
              />
            </svg>
            <span className="tabular-nums">
              {workoutsThisWeek ?? 0}/{weeklyGoal} sem.
            </span>
          </div>
        )}
      </div>

      <button className="btn btn-primary w-full" onClick={() => requestStart('empty')}>
        <IconPlus size={18} />
        Empezar entreno vacío
      </button>

      <button
        className="btn btn-surface mt-2.5 w-full"
        onClick={() => setTemplatesOpen(true)}
      >
        <IconTarget size={17} />
        Explorar plantillas de programas
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
            Crea una rutina propia o añade un programa completo desde «Explorar plantillas».
          </p>
        </div>
      )}

      {(folders ?? []).map((f) => {
        const items = grouped.get(f.id) ?? []
        if (!items.length) return null
        const isCollapsed = collapsed[f.id]
        return (
          <div key={f.id} className="pb-3">
            <button
              className="flex w-full items-center gap-2 py-2 text-left"
              onClick={() => setCollapsed((c) => ({ ...c, [f.id]: !c[f.id] }))}
            >
              <IconFolder size={15} className="text-muted" />
              <span className="flex-1 font-bold">{f.name}</span>
              <span className="text-xs text-muted">{items.length}</span>
              {isCollapsed ? <IconChevronRight size={15} className="text-muted" /> : <IconChevronDown size={15} className="text-muted" />}
            </button>
            {!isCollapsed && (
              <div className="flex flex-col gap-3">
                {items.map((r) => (
                  <RoutineCard
                    key={r.id}
                    routine={r}
                    byId={byId}
                    onStart={() => requestStart(r)}
                    onMenu={() => setMenuFor(r)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      <div className="flex flex-col gap-3">
        {unfiled.map((r) => (
          <RoutineCard
            key={r.id}
            routine={r}
            byId={byId}
            onStart={() => requestStart(r)}
            onMenu={() => setMenuFor(r)}
          />
        ))}
      </div>

      <ActionSheet
        open={!!menuFor}
        onClose={() => setMenuFor(null)}
        title={menuFor?.name}
        actions={[
          { label: 'Editar rutina', onClick: () => navigate(`/rutina/${menuFor!.id}`) },
          { label: 'Mover a carpeta', onClick: () => setMoveFolderFor(menuFor) },
          {
            label: 'Duplicar rutina',
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
          { label: 'Eliminar rutina', danger: true, onClick: () => setConfirmDelete(menuFor) },
        ]}
      />

      <Sheet open={!!moveFolderFor} onClose={() => setMoveFolderFor(null)} title="Mover a carpeta">
        <div className="flex flex-col pb-2">
          <button
            className="rounded-xl px-3 py-3 text-left"
            onClick={() => {
              void db.routines.update(moveFolderFor!.id, { folderId: undefined })
              setMoveFolderFor(null)
            }}
          >
            Sin carpeta
          </button>
          {(folders ?? []).map((f) => (
            <button
              key={f.id}
              className="rounded-xl px-3 py-3 text-left"
              onClick={() => {
                void db.routines.update(moveFolderFor!.id, { folderId: f.id })
                setMoveFolderFor(null)
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
      </Sheet>

      <TemplateBrowserSheet open={templatesOpen} onClose={() => setTemplatesOpen(false)} />

      <Confirm
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="¿Eliminar rutina?"
        message={`"${confirmDelete?.name}" se eliminará. Tus entrenos pasados no se tocan.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => {
          const snapshot = confirmDelete!
          void db.routines.delete(snapshot.id)
          toastUndo('Rutina eliminada', () => void db.routines.put(snapshot))
        }}
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

function RoutineCard({
  routine: r,
  byId,
  onStart,
  onMenu,
}: {
  routine: Routine
  byId: Map<string, { name: string }>
  onStart: () => void
  onMenu: () => void
}) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-bold">{r.name}</div>
          <div className="line-clamp-2 pt-0.5 text-xs leading-relaxed text-muted">
            {r.exercises.map((e) => byId.get(e.exerciseId)?.name ?? 'Ejercicio eliminado').join(' · ')}
          </div>
        </div>
        <button
          className="pressable shrink-0 rounded-lg p-1.5 text-muted"
          onClick={onMenu}
          aria-label="Opciones de rutina"
        >
          <IconDots size={18} />
        </button>
      </div>
      <button className="btn btn-primary mt-3 w-full py-2.5" onClick={onStart}>
        <IconPlay size={15} />
        Empezar rutina
      </button>
    </div>
  )
}
