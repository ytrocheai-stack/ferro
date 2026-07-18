import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/db'
import { PROGRAM_TEMPLATES, type ProgramTemplate } from '../data/templates'
import { useSettings } from '../stores/settings'
import { useCatalog } from '../data/exercises'
import { uid } from '../lib/format'
import { Sheet } from './Sheet'
import { ExerciseThumb } from './ExerciseThumb'
import { IconCalendar, IconChevronLeft } from './icons'

export function TemplateBrowserSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState<ProgramTemplate | null>(null)
  const close = () => {
    onClose()
    setSelected(null)
  }
  return (
    <Sheet open={open} onClose={close} title={selected ? undefined : 'Explorar plantillas'} full>
      {selected ? (
        <TemplateDetail template={selected} onBack={() => setSelected(null)} onDone={close} />
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          {PROGRAM_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="card pressable px-4 py-3.5 text-left"
              onClick={() => setSelected(t)}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{t.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted">
                  <IconCalendar size={13} />
                  {t.daysPerWeek} días/sem
                </span>
              </div>
              <p className="pt-1 text-xs text-muted">{t.description}</p>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}

function TemplateDetail({
  template,
  onBack,
  onDone,
}: {
  template: ProgramTemplate
  onBack: () => void
  onDone: () => void
}) {
  const navigate = useNavigate()
  const defaultRestSec = useSettings((s) => s.defaultRestSec)
  const { byId } = useCatalog()
  const [adding, setAdding] = useState(false)

  const addProgram = async () => {
    setAdding(true)
    const folderId = uid()
    await db.folders.put({ id: folderId, name: template.name, sortOrder: Date.now() })
    let sortOrder = Date.now()
    for (const r of template.routines) {
      await db.routines.put({
        id: uid(),
        name: r.name,
        sortOrder: sortOrder++,
        createdAt: Date.now(),
        folderId,
        exercises: r.exercises.map((e) => ({ ...e, restSec: defaultRestSec })),
      })
    }
    setAdding(false)
    onDone()
    navigate('/')
  }

  return (
    <div>
      <button
        className="pressable -ml-2 mb-2 flex items-center gap-1 rounded-lg p-1.5 text-sm font-semibold text-muted"
        onClick={onBack}
      >
        <IconChevronLeft size={18} />
        Plantillas
      </button>
      <h2 className="text-xl font-extrabold">{template.name}</h2>
      <p className="pb-4 pt-1 text-sm text-muted">{template.description}</p>

      <div className="flex flex-col gap-3">
        {template.routines.map((r) => (
          <div key={r.name} className="card px-4 py-3">
            <div className="pb-2 font-bold">{r.name}</div>
            <div className="flex flex-col gap-1.5">
              {r.exercises.map((e) => {
                const info = byId.get(e.exerciseId)
                return (
                  <div key={e.exerciseId} className="flex items-center gap-2 text-sm">
                    <ExerciseThumb exercise={info} size={28} />
                    <span className="min-w-0 flex-1 truncate">{info?.name ?? e.exerciseId}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {e.plannedSets}×{e.repRangeMin}-{e.repRangeMax}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <button className="btn btn-primary sticky bottom-2 mt-4 w-full" disabled={adding} onClick={() => void addProgram()}>
        {adding ? 'Añadiendo…' : `Añadir ${template.routines.length} rutinas a mi carpeta`}
      </button>
    </div>
  )
}
