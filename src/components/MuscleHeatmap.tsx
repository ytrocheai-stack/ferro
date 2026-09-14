import { useId, useState } from 'react'
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_ORDER, type MuscleGroup } from '../data/muscleGroups'
import regionPaths from '../data/anatomyRegions.json'
import { frequencyOpacity } from '../lib/muscleActivity'

type Counts = Partial<Record<MuscleGroup, number>>
type View = 'front' | 'back'
const paths = regionPaths as Record<View, Partial<Record<MuscleGroup, string>>>
const asset = (name: string) => `${import.meta.env.BASE_URL}anatomy/${name}.png`
const dayLabel = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`
const setLabel = (n: number) => `${n} ${n === 1 ? 'serie' : 'series'}`

/** Vistas del modelo 3D con máscaras locales: sin WebGL ni bucle de render en móvil. */
export function MuscleHeatmap({ counts, frequency }: { counts: Counts; frequency: Counts }) {
  const id = useId().replace(/:/g, '')
  const [selected, setSelected] = useState<MuscleGroup | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const select = (group: MuscleGroup) => setSelected(current => current === group ? null : group)
  const active = MUSCLE_GROUP_ORDER.some(group => (frequency[group] ?? 0) > 0)

  return (
    <div className="px-2" aria-label="Mapa de frecuencia muscular">
      {!imageFailed ? (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#0b1018] px-2 pb-3 pt-2">
          {(['front', 'back'] as const).map(view => (
            <figure key={view} data-view={view} className="min-w-0">
              <svg viewBox="0 0 492 1074" className="mx-auto w-full max-w-[180px]" aria-hidden="true">
                <defs>
                  {Object.keys(paths[view]).map(key => (
                    <mask key={key} id={`${id}-${view}-${key}`} maskUnits="userSpaceOnUse" x="0" y="0" width="492" height="1074" style={{ maskType: 'alpha' }}>
                      <image href={asset(`${view}-${key}`)} width="492" height="1074" pointerEvents="none" onError={() => setImageFailed(true)} />
                    </mask>
                  ))}
                </defs>
                <image href={asset(view)} width="492" height="1074" pointerEvents="none" onError={() => setImageFailed(true)} />
                {(Object.entries(paths[view]) as [MuscleGroup, string][]).map(([group, d]) => (
                  <g key={group}>
                    <rect data-muscle={group} width="492" height="1074" fill="#0091ff"
                      opacity={frequencyOpacity(frequency[group] ?? 0)} mask={`url(#${id}-${view}-${group})`} pointerEvents="none" />
                    {selected === group && <path data-muscle-selection={group} d={d} fill="none" stroke="#c5e9ff" strokeWidth="3" pointerEvents="none" />}
                    <path data-muscle-region={group} data-view={view} d={d} fill="transparent" pointerEvents="all" className="cursor-pointer" onClick={() => select(group)}>
                      <title>{MUSCLE_GROUP_LABELS[group]}: {dayLabel(frequency[group] ?? 0)}, {setLabel(counts[group] ?? 0)}</title>
                    </path>
                  </g>
                ))}
              </svg>
              <figcaption className="pt-2 text-center text-[10px] font-semibold uppercase tracking-wider text-[#aeb9c9]">{view === 'front' ? 'Frente' : 'Espalda'}</figcaption>
            </figure>
          ))}
        </div>
      ) : <p className="rounded-xl bg-surface-2 p-3 text-xs text-muted">El mapa no está disponible. Puedes consultar cada grupo abajo.</p>}
      <div className="flex items-center justify-center gap-3 py-3 text-[10px] text-muted" aria-label="Escala de frecuencia en siete días">
        {[0, 1, 3, 7].map(days => (
          <span key={days} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#a8acb2]" aria-hidden="true">
              <span className="block h-full w-full rounded-full bg-[#0091ff]" style={{ opacity: frequencyOpacity(days) }} />
            </span>{dayLabel(days)}
          </span>
        ))}
      </div>
      <p role="status" aria-live="polite" className="min-h-10 text-center text-xs font-semibold leading-5">
        {selected ? `${MUSCLE_GROUP_LABELS[selected]} · ${dayLabel(frequency[selected] ?? 0)} · ${setLabel(counts[selected] ?? 0)}`
          : active ? 'Toca un músculo o elige un grupo.' : 'Sin actividad registrada en estos siete días.'}
      </p>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Seleccionar grupo muscular">
        {MUSCLE_GROUP_ORDER.map(group => (
          <button key={group} type="button" aria-pressed={selected === group}
            aria-label={`${MUSCLE_GROUP_LABELS[group]}: ${dayLabel(frequency[group] ?? 0)}, ${setLabel(counts[group] ?? 0)}`}
            onClick={() => select(group)}
            className={`min-h-11 rounded-xl border px-1 py-2 text-[10px] font-semibold ${selected === group ? 'border-[#0091ff] bg-[#0091ff]/15 text-text' : 'border-border bg-surface text-muted'}`}>
            {MUSCLE_GROUP_LABELS[group]}
          </button>
        ))}
      </div>
      <p className="px-1 pt-3 text-[10px] leading-relaxed text-muted">Músculo principal de cada ejercicio. Hoy y los seis días anteriores; cada día cuenta una vez. Más azul indica mayor frecuencia, no recuperación.</p>
    </div>
  )
}
