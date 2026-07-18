import { useState } from 'react'
import { MUSCLE_GROUP_LABELS, type MuscleGroup } from '../data/muscleGroups'

interface Region {
  group: MuscleGroup
  d: string
}

// Siluetas simplificadas (viewBox 0 0 160 320). Regiones aproximadas por zona.
const FRONT_REGIONS: Region[] = [
  { group: 'shoulders', d: 'M40 58 a14 14 0 1 0 0.1 0 M120 58 a14 14 0 1 0 0.1 0' },
  { group: 'chest', d: 'M52 62 h56 v34 h-56 z' },
  { group: 'biceps', d: 'M30 70 h14 v40 h-14 z M116 70 h14 v40 h-14 z' },
  { group: 'forearms', d: 'M28 112 h14 v40 h-14 z M118 112 h14 v40 h-14 z' },
  { group: 'abs', d: 'M56 98 h48 v46 h-48 z' },
  { group: 'quads', d: 'M50 176 h26 v66 h-26 z M84 176 h26 v66 h-26 z' },
  { group: 'calves', d: 'M52 254 h22 v46 h-22 z M86 254 h22 v46 h-22 z' },
]

const BACK_REGIONS: Region[] = [
  { group: 'shoulders', d: 'M40 58 a14 14 0 1 0 0.1 0 M120 58 a14 14 0 1 0 0.1 0' },
  { group: 'back', d: 'M52 58 h56 v58 h-56 z' },
  { group: 'triceps', d: 'M30 70 h14 v40 h-14 z M116 70 h14 v40 h-14 z' },
  { group: 'forearms', d: 'M28 112 h14 v40 h-14 z M118 112 h14 v40 h-14 z' },
  { group: 'glutes', d: 'M54 118 h52 v34 h-52 z' },
  { group: 'hamstrings', d: 'M50 176 h26 v66 h-26 z M84 176 h26 v66 h-26 z' },
  { group: 'calves', d: 'M52 254 h22 v46 h-22 z M86 254 h22 v46 h-22 z' },
]

const HEAD = 'M80 12 a18 18 0 1 0 0.1 0'
const TORSO_OUTLINE =
  'M60 40 h40 l14 20 v70 l-10 10 v90 h-14 v70 h-20 v-70 h-14 v-90 l-10 -10 v-70 z'

function intensityColor(value: number, max: number): string {
  if (value <= 0) return 'var(--color-surface-2)'
  const t = Math.min(1, value / Math.max(1, max))
  // azul (bajo) → verde (óptimo) → naranja (alto)
  if (t < 0.5) {
    const k = t / 0.5
    return mix('#2f6fe0', '#33c076', k)
  }
  const k = (t - 0.5) / 0.5
  return mix('#33c076', '#f2a33c', k)
}

function mix(c1: string, c2: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [r1, g1, b1] = p(c1)
  const [r2, g2, b2] = p(c2)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `rgb(${r},${g},${b})`
}

function Body({ regions, counts, max }: { regions: Region[]; counts: Partial<Record<MuscleGroup, number>>; max: number }) {
  const [hover, setHover] = useState<MuscleGroup | null>(null)
  return (
    <svg viewBox="0 0 160 320" className="h-full w-full">
      <path d={HEAD} fill="var(--color-surface-2)" />
      <path d={TORSO_OUTLINE} fill="var(--color-surface-2)" opacity={0.5} />
      {regions.map((r, i) => {
        const v = counts[r.group] ?? 0
        return (
          <path
            key={i}
            d={r.d}
            fill={intensityColor(v, max)}
            fillRule="evenodd"
            stroke="var(--color-bg)"
            strokeWidth={1.5}
            className="cursor-pointer"
            onPointerEnter={() => setHover(r.group)}
            onPointerLeave={() => setHover((h) => (h === r.group ? null : h))}
            onClick={() => setHover((h) => (h === r.group ? null : r.group))}
          >
            <title>
              {MUSCLE_GROUP_LABELS[r.group]}: {v} series/semana
            </title>
          </path>
        )
      })}
      {hover && (
        <text x={80} y={310} textAnchor="middle" fontSize="11" fill="var(--color-text)" fontWeight={700}>
          {MUSCLE_GROUP_LABELS[hover]}: {counts[hover] ?? 0}
        </text>
      )}
    </svg>
  )
}

export function MuscleHeatmap({ counts }: { counts: Partial<Record<MuscleGroup, number>> }) {
  const max = Math.max(1, ...Object.values(counts).map((v) => v ?? 0))
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center gap-1">
          <div className="aspect-[1/2] w-full max-w-[140px]">
            <Body regions={FRONT_REGIONS} counts={counts} max={max} />
          </div>
          <span className="text-[10px] font-semibold uppercase text-muted">Frente</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="aspect-[1/2] w-full max-w-[140px]">
            <Body regions={BACK_REGIONS} counts={counts} max={max} />
          </div>
          <span className="text-[10px] font-semibold uppercase text-muted">Espalda</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 pt-3 text-[10px] text-muted">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: intensityColor(0.1, 1) }} />
        Poco
        <span className="ml-2 h-2.5 w-2.5 rounded-full" style={{ background: intensityColor(0.5, 1) }} />
        Óptimo
        <span className="ml-2 h-2.5 w-2.5 rounded-full" style={{ background: intensityColor(1, 1) }} />
        Mucho
      </div>
    </div>
  )
}
