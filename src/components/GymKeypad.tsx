import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { IconCheck } from './icons'

/** Barra accesoria sobre el teclado para ajustar peso/reps sin teclear.
 *  Los inputs se registran al enfocar y se des-registran al perder el foco. */

interface KeypadTarget {
  kind: 'weight' | 'reps'
  /** suma delta al valor actual del input registrado */
  apply: (delta: number) => void
}

interface KeypadState {
  target: KeypadTarget | null
  register: (t: KeypadTarget) => void
  unregister: () => void
}

export const useKeypad = create<KeypadState>()((set) => ({
  target: null,
  register: (t) => set({ target: t }),
  unregister: () => set({ target: null }),
}))

/**
 * Desplazamiento (px) que hay que subir un elemento `fixed bottom-0` para que no quede tapado
 * por el teclado en iOS: allí el teclado encoge `visualViewport` pero no el layout viewport, así
 * que un elemento fijo sigue anclado al fondo de la pantalla completa, bajo el teclado. En
 * Android/desktop `visualViewport` ya sigue al teclado y el offset resultante es 0.
 */
function useVisualViewportOffset(): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const covered = window.innerHeight - (vv.height + vv.offsetTop)
      setOffset(Math.max(0, Math.round(covered)))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return offset
}

export function GymKeypadBar() {
  const target = useKeypad((s) => s.target)
  const keyboardOffset = useVisualViewportOffset()
  if (!target) return null

  const deltas = target.kind === 'weight' ? [-2.5, 2.5, 5] : [-1, 1]

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[70]"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        transform: keyboardOffset ? `translateY(-${keyboardOffset}px)` : undefined,
      }}
    >
      <div className="mx-auto flex max-w-md items-center gap-2 border-t border-border bg-surface-2/98 px-3 py-2 backdrop-blur">
        {deltas.map((d) => (
          <button
            key={d}
            className="pressable min-h-11 flex-1 rounded-xl bg-surface font-mono text-sm font-bold tabular-nums"
            // preventDefault evita robarle el foco al input
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => target.apply(d)}
          >
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
        <button
          className="pressable flex min-h-11 flex-1 items-center justify-center rounded-xl bg-primary text-white"
          onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
          aria-label="Listo"
        >
          <IconCheck size={17} />
        </button>
      </div>
    </div>
  )
}
