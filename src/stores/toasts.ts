import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface ToastState {
  toasts: Toast[]
  show: (message: string, opts?: { actionLabel?: string; onAction?: () => void; durationMs?: number }) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (message, opts) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, actionLabel: opts?.actionLabel, onAction: opts?.onAction }] }))
    setTimeout(() => get().dismiss(id), opts?.durationMs ?? 5000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Atajo para acciones destructivas con Deshacer. */
export function toastUndo(message: string, undo: () => void) {
  useToasts.getState().show(message, { actionLabel: 'Deshacer', onAction: undo })
}
