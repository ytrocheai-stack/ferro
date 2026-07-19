import { useEffect, useState } from 'react'
import { db } from '../db/db'
import type { CustomExercise } from '../db/types'
import { targetOptions, useCatalog } from '../data/exercises'
import { BODY_PARTS, t } from '../data/translations'
import { uid } from '../lib/format'
import { Select } from './Select'
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
          <Select
            value={bodyPart}
            onChange={setBodyPart}
            options={BODY_PARTS.map((b) => ({ value: b, label: t(b) }))}
            sheetTitle="Grupo muscular"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Músculo principal</span>
          <Select
            value={target}
            onChange={setTarget}
            options={targets.map((x) => ({ value: x, label: t(x) }))}
            sheetTitle="Músculo principal"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Equipo</span>
          <Select
            value={equipment}
            onChange={setEquipment}
            options={equipments.map((x) => ({ value: x, label: t(x) }))}
            sheetTitle="Equipo"
          />
        </label>
        <button className="btn btn-primary mt-1" onClick={() => void save()} disabled={!name.trim()}>
          Guardar
        </button>
      </div>
    </Sheet>
  )
}
