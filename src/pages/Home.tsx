import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { startOfWeek } from 'date-fns'
import { db } from '../db/db'
import type { Routine } from '../db/types'
import { useActive } from '../stores/activeWorkout'
import { useSettings } from '../stores/settings'
import { useCatalog } from '../data/exercises'
import { toastUndo, useToasts } from '../stores/toasts'
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
import { invalidateStaleAdaptationJobsInTransaction } from '../lib/adaptationContext'
import { getCoachAccountId } from '../lib/coachAccount'
import { uid } from '../lib/format'
import { useLocalDateKey } from '../lib/useLocalDateKey'
import { useNow } from '../lib/useNow'
import { clock } from '../lib/format'
import { isRoutineStartable } from '../lib/routineEditing'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { SectionHeader } from '../components/SectionHeader'
import { IconTimer } from '../components/icons'

export default function Home() {
  const navigate = useNavigate()
  const dateKey = useLocalDateKey()
  const routines = useLiveQuery(() => db.routines.orderBy('sortOrder').filter(isRoutineStartable).toArray(), [], undefined)
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
  const now = useNow(1000, !!session)

  const start = async (what: Routine | 'empty') => {
    const { startEmpty, startFromRoutine } = useActive.getState()
    try {
      if (what === 'empty') startEmpty()
      else await startFromRoutine(what)
      navigate('/entreno')
    } catch (cause) {
      useToasts.getState().show(cause instanceof Error ? cause.message : 'No se pudo iniciar la rutina.')
    }
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

  return (
    <div className="page-content pt-3">
      <PageHeader title="Entrenar" />

      <section className="glass-panel week-summary mt-5" aria-labelledby="week-summary-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="week-summary-title" className="text-base font-semibold">Esta semana</h2>
            <p className="mt-1 text-sm text-muted">Tu ritmo de entrenamiento</p>
          </div>
          <span className="week-summary__value tabular-nums" aria-label={`${workoutsThisWeek ?? 0} de ${weeklyGoal} entrenamientos`}>
            {workoutsThisWeek ?? '—'}<span className="week-summary__goal">/ {weeklyGoal}</span>
          </span>
        </div>
        <div className="week-summary__track" aria-hidden="true">
          <div className="week-summary__fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </section>

      {session && (
        <section className="glass-panel mt-4 px-4 py-4" aria-labelledby="active-workout-title">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-primary/10 text-primary"><IconTimer size={19} /></span>
            <div className="min-w-0 flex-1">
              <h2 id="active-workout-title" className="text-base font-semibold">Entrenamiento en curso</h2>
              <p className="line-clamp-2 text-sm text-muted">{session.name}</p>
            </div>
            <span className="text-sm tabular-nums text-muted">{clock((now - session.startedAt) / 1000)}</span>
          </div>
          <button className="btn btn-primary mt-3 w-full" onClick={() => navigate('/entreno')}>Continuar entrenamiento</button>
        </section>
      )}

      <div className="mt-7">
        <SectionHeader title={`Mis rutinas${routines !== undefined ? ` (${routines.length})` : ''}`} action={<button className="flex min-h-11 items-center gap-1 text-sm font-semibold text-primary" onClick={() => navigate('/rutina/nueva')}><IconPlus size={15} />Nueva</button>} />
      </div>

      {routines !== undefined && routines.length === 0 && (
        <EmptyState
          icon={<IconDumbbell size={28} />}
          title="Aún no tienes rutinas"
          description="Crea una rutina propia o añade un programa completo desde Explorar programas."
          action={<button className="btn btn-primary w-full" onClick={() => navigate('/rutina/nueva')}>Crear rutina</button>}
          secondary={<button className="btn btn-surface w-full" onClick={() => setTemplatesOpen(true)}>Explorar programas</button>}
        />
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
            <div className="card mt-1 flex flex-col divide-y divide-border/70 overflow-hidden">
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

      {unfiled.length > 0 && (
        <div className="card mt-1 flex flex-col divide-y divide-border/70 overflow-hidden">
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
      )}

      <button className="btn btn-surface mt-4 w-full" onClick={() => requestStart('empty')}>
        <IconPlus size={17} />Entrenamiento libre
      </button>
      {Boolean(routines?.length) && <button className="mt-4 flex min-h-11 w-full items-center justify-center gap-1 text-sm font-semibold text-muted" onClick={() => setTemplatesOpen(true)}>
        <IconTarget size={16} />Explorar programas
      </button>}

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
          void db.transaction('rw', [db.routines, db.workouts, db.adaptationJobs, db.adaptationProposals], async () => {
            await db.routines.delete(snapshot.id)
            await invalidateStaleAdaptationJobsInTransaction(getCoachAccountId())
          })
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
    <div className="flex min-h-[88px] items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="min-w-0">
          <div className="line-clamp-2 font-semibold">{r.name}</div>
          <div className="line-clamp-2 pt-0.5 text-xs leading-relaxed text-muted">
            {r.exercises.length} ejercicios · {r.exercises.map((e) => byId.get(e.exerciseId)?.name ?? 'Ejercicio eliminado').join(' · ')}
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
      <button className="btn btn-surface min-h-11 shrink-0 px-3 text-sm" onClick={onStart}>
        <IconPlay size={14} />
        Empezar
      </button>
    </div>
  )
}
