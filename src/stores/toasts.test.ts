import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToasts } from './toasts'

describe('tiempo disponible para Deshacer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    for (const reason of ['hidden', 'modal', 'focus'] as const) useToasts.getState().setPaused(reason, false)
    vi.runAllTimers()
    vi.useRealTimers()
  })

  it('reanuda solo cuando desaparecen todos los motivos de pausa', () => {
    const store = useToasts.getState()
    store.show('Serie eliminada', { actionLabel: 'Deshacer', durationMs: 1000 })
    vi.advanceTimersByTime(300)
    store.setPaused('focus', true)
    store.setPaused('modal', true)
    store.setPaused('hidden', true)
    vi.advanceTimersByTime(5000)
    store.setPaused('hidden', false)
    store.setPaused('focus', false)
    vi.advanceTimersByTime(5000)
    expect(useToasts.getState().toasts[0].exiting).not.toBe(true)
    store.setPaused('modal', false)
    vi.advanceTimersByTime(699)
    expect(useToasts.getState().toasts[0].exiting).not.toBe(true)
    vi.advanceTimersByTime(1)
    expect(useToasts.getState().toasts[0].exiting).toBe(true)
    vi.advanceTimersByTime(160)
    expect(useToasts.getState().toasts).toHaveLength(0)
  })

  it('conserva el tiempo completo de un aviso creado durante un modal', () => {
    const store = useToasts.getState()
    store.setPaused('modal', true)
    store.show('Guardado', { durationMs: 500 })
    vi.advanceTimersByTime(3000)
    store.setPaused('modal', false)
    vi.advanceTimersByTime(499)
    expect(useToasts.getState().toasts[0].exiting).not.toBe(true)
    vi.advanceTimersByTime(161)
    expect(useToasts.getState().toasts).toHaveLength(0)
  })
})
