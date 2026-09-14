/* eslint-disable react-refresh/only-export-components -- keypad constants are shared by its input controls. */
import { create } from 'zustand'
import { IconCheck } from './icons'

/** Barra accesoria sobre el teclado para ajustar peso/reps sin teclear.
 *  Los inputs se registran al enfocar y se des-registran al perder el foco. */

interface KeypadTarget {
  kind: 'weight' | 'reps'
  input: HTMLInputElement
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

export function GymKeypadBar() {
  const target = useKeypad((s) => s.target)
  if (!target) return null

  const deltas = target.kind === 'weight' ? [-2.5, 2.5, 5] : [-1, 1]

  return (
    <div
      className="gym-keypad dock-card"
      role="group"
      aria-label="Ajustar peso o repeticiones"
      onBlur={(event) => {
        if (event.relatedTarget === target.input || (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) return
        useKeypad.getState().unregister()
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {deltas.map((d) => (
          <button
            key={d}
            className="pressable min-h-11 flex-1 rounded-xl bg-surface text-sm font-bold tabular-nums"
            // preventDefault evita robarle el foco al input
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => target.apply(d)}
          >
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
        <button
          className="pressable flex min-h-11 flex-1 items-center justify-center rounded-xl bg-primary-strong text-on-primary"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            target.input.blur()
            useKeypad.getState().unregister()
          }}
          aria-label="Listo, terminar edición"
        >
          <IconCheck size={17} />
        </button>
      </div>
    </div>
  )
}
