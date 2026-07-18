import { useSettings } from '../stores/settings'
import { calcPlates } from '../lib/progression'
import { formatWeight } from '../lib/format'
import { Sheet } from './Sheet'

/** Colores estándar IPF por disco (kg). */
const PLATE_COLORS: Record<number, string> = {
  25: '#d43a3a',
  20: '#2563eb',
  15: '#eab308',
  10: '#16a34a',
  5: '#e8e8ec',
  2.5: '#3a3a42',
  1.25: '#9ca3af',
}

const plateColor = (kg: number) => PLATE_COLORS[kg] ?? '#8f8f9b'
/** altura relativa del disco en el SVG */
const plateHeight = (kg: number) => (kg >= 15 ? 84 : kg >= 10 ? 66 : kg >= 5 ? 50 : kg >= 2.5 ? 40 : 32)

export function PlateCalculatorSheet({
  open,
  onClose,
  targetKg,
}: {
  open: boolean
  onClose: () => void
  targetKg: number
}) {
  const { barWeightKg, platesKg, units } = useSettings()
  const { perSide, remainderKg } = calcPlates(targetKg, barWeightKg, platesKg)

  // discos individuales por lado, del más pesado al más ligero
  const side: number[] = perSide.flatMap((p) => Array.from({ length: p.count }, () => p.plateKg))

  return (
    <Sheet open={open} onClose={onClose} title="Calculadora de discos">
      <div className="pb-3 text-center">
        <div className="text-3xl font-extrabold tabular-nums text-primary">
          {formatWeight(targetKg, units)}
        </div>
        <div className="pt-0.5 text-xs text-muted">
          Barra de {barWeightKg} kg · discos por lado
        </div>
      </div>

      {targetKg < barWeightKg ? (
        <p className="py-4 text-center text-sm text-warning">
          El peso objetivo es menor que la barra ({barWeightKg} kg).
        </p>
      ) : (
        <>
          {/* barra con discos (un lado reflejado) */}
          <svg viewBox="0 0 320 120" className="h-28 w-full">
            {/* barra */}
            <rect x="0" y="55" width="320" height="10" rx="4" fill="#6b6b76" />
            {/* topes */}
            <rect x="66" y="46" width="8" height="28" rx="2" fill="#8f8f9b" />
            <rect x="246" y="46" width="8" height="28" rx="2" fill="#8f8f9b" />
            {side.map((kg, i) => {
              const h = plateHeight(kg)
              const w = 13
              const xLeft = 62 - i * (w + 2) - w
              const xRight = 246 + 8 + i * (w + 2)
              return (
                <g key={i}>
                  <rect x={xLeft} y={60 - h / 2} width={w} height={h} rx="3" fill={plateColor(kg)} />
                  <rect x={xRight} y={60 - h / 2} width={w} height={h} rx="3" fill={plateColor(kg)} />
                </g>
              )
            })}
          </svg>

          {side.length === 0 && remainderKg === 0 && (
            <p className="pb-2 text-center text-sm text-muted">Solo la barra, sin discos.</p>
          )}

          <div className="flex flex-wrap justify-center gap-2 pb-2">
            {perSide.map((p) => (
              <span key={p.plateKg} className="chip">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ background: plateColor(p.plateKg) }}
                />
                {p.count} × {p.plateKg} kg
              </span>
            ))}
          </div>

          {remainderKg > 0 && (
            <p className="pb-2 text-center text-xs text-warning">
              Faltan {remainderKg} kg que no se pueden cargar con tus discos (queda{' '}
              {formatWeight(targetKg - remainderKg, units)}).
            </p>
          )}
        </>
      )}
      <p className="pb-2 text-center text-[11px] text-muted">
        Configura barra y discos disponibles en Perfil → Ajustes.
      </p>
    </Sheet>
  )
}
