import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
  exiting?: boolean
}

type PauseReason = 'hidden' | 'modal' | 'focus'

interface ToastState {
  toasts: Toast[]
  show: (message: string, opts?: { actionLabel?: string; onAction?: () => void; durationMs?: number }) => void
  dismiss: (id: number) => void
  setPaused: (reason: PauseReason, active: boolean) => void
}

let nextId = 1
const pauseReasons = new Set<PauseReason>()
const timers = new Map<number, { timeout: number; remaining: number; startedAt: number }>()
const exitTimers = new Map<number, number>()

function schedule(id: number, remaining: number, dismiss: (id: number) => void) {
  const startedAt = Date.now()
  if (pauseReasons.size > 0) {
    timers.set(id, { timeout: 0, remaining, startedAt })
    return
  }
  const timeout = window.setTimeout(() => {
    timers.delete(id)
    dismiss(id)
  }, remaining)
  timers.set(id, { timeout, remaining, startedAt })
}

function clearTimer(id: number) {
  const timer = timers.get(id)
  if (!timer) return
  window.clearTimeout(timer.timeout)
  timers.delete(id)
}

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (message, opts) => {
    const id = nextId++
    for (const toast of get().toasts.slice(0, -2)) {
      clearTimer(toast.id)
      window.clearTimeout(exitTimers.get(toast.id))
      exitTimers.delete(toast.id)
    }
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, actionLabel: opts?.actionLabel, onAction: opts?.onAction }] }))
    schedule(id, opts?.durationMs ?? 5000, get().dismiss)
  },
  dismiss: (id) => {
    if (!get().toasts.some((toast) => toast.id === id && !toast.exiting)) return
    clearTimer(id)
    set((s) => ({ toasts: s.toasts.map((toast) => toast.id === id ? { ...toast, exiting: true } : toast) }))
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const duration = reduced ? 100 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-exit')) || 160
    exitTimers.set(id, window.setTimeout(() => {
      exitTimers.delete(id)
      set((s) => ({ toasts: s.toasts.filter((toast) => toast.id !== id) }))
    }, duration))
  },
  setPaused: (reason, active) => {
    const wasPaused = pauseReasons.size > 0
    if (active) pauseReasons.add(reason)
    else pauseReasons.delete(reason)
    const paused = pauseReasons.size > 0
    if (paused === wasPaused) return
    if (paused) {
      const now = Date.now()
      for (const timer of timers.values()) {
        window.clearTimeout(timer.timeout)
        timer.remaining = Math.max(1, timer.remaining - (now - timer.startedAt))
        timer.timeout = 0
      }
    } else {
      for (const [id, timer] of timers) schedule(id, timer.remaining, get().dismiss)
    }
  },
}))

/** Atajo para acciones destructivas con Deshacer. */
export function toastUndo(message: string, undo: () => void) {
  useToasts.getState().show(message, { actionLabel: 'Deshacer', onAction: undo })
}
