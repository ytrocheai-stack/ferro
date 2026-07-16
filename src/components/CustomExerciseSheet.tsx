import { useEffect, useState } from 'react'
import { db } from '../db/db'
import type { CustomExercise } from '../db/types'
import { targetOptions, useCatalog } from '../data/exercises'
import { BODY_PARTS, t } from '../data/translations'
import { uid } from '../lib/format'
import { Sheet } from './Sheet'

/** Crear o editar un ejercicio personalizado. */
export function CustomExerciseSheet({
  open,
  onClose,
  existing,
}: {
  open: boolean
  onClose: () => void
  existing?: CustomExercise | null
}) {
  const { all } = useCatalog()
  const [name, setName] = useState('')
  const [bodyPart, setBodyPart] = useState('chest')
  const [equipment, setEquipment] = useState('body weight')
  const [target, setTarget] = useState('pectorals')

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? '')
      setBodyPart(existing?.bodyPart ?? 'chest')
      setEquipment(existing?.equipment ?? 'body weight')
      setTarget(existing?.target ?? 'pectorals')
    }
  }, [open, existing])

  const equipments = ['body weight', 'barbell', 'dumbbell', 'cable', 'kettlebell', 'band', 'leverage machine', 'smith machine', 'weighted', 'other']
  const targets = targetOptions(all.filter((e) => !e.custom))

  const save = async () => {
    if (!name.trim()) return
    const ex: CustomExercise = {
      id: existing?.id ?? `custom-${uid()}`,
      name: name.trim(),
      bodyPart,
      equipment,
      target,
      secondaryMuscles: existing?.secondaryMuscles ?? [],
      createdAt: existing?.createdAt ?? Date.now(),
    }
    await db.customExercises.put(ex)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar ejercicio' : 'Nuevo ejercicio personalizado'}
    >
      <div className="flex flex-col gap-3 pb-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Nombre</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="p. ej. Press banca agarre cerrado"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Grupo muscular</span>
          <select className="input" value={bodyPart} onChange={(e) => setBodyPart(e.target.value)}>
            {BODY_PARTS.map((b) => (
              <option key={b} value={b}>
                {t(b)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Músculo principal</span>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((x) => (
              <option key={x} value={x}>
                {t(x)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Equipo</span>
          <select className="input" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
            {equipments.map((x) => (
              <option key={x} value={x}>
                {t(x)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary mt-1" onClick={() => void save()} disabled={!name.trim()}>
          Guardar
        </button>
      </div>
    </Sheet>
  )
}
