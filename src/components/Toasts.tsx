import { useEffect } from 'react'
import { useToasts } from '../stores/toasts'

/** Toasts apilados sobre la barra de tabs; no roban el foco (aria-live). */
export function Toasts({ inDock = false }: { inDock?: boolean }) {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  const setPaused = useToasts((s) => s.setPaused)

  useEffect(() => {
    const sync = () => {
      setPaused('hidden', document.hidden)
      setPaused('modal', document.body.dataset.modalOpen === 'true')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-modal-open'] })
    document.addEventListener('visibilitychange', sync)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
      setPaused('hidden', false)
      setPaused('modal', false)
      setPaused('focus', false)
    }
  }, [setPaused])

  useEffect(() => {
    setPaused('focus', Boolean(document.activeElement?.closest('.toast button:not(:disabled)')))
  }, [toasts, setPaused])

  if (!toasts.length) return null

  return (
    <div
      className={inDock ? 'flex w-full flex-col items-center gap-2' : 'pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2'}
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-state={t.exiting ? 'exiting' : 'open'}
          className="toast pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3"
        >
          <span className="min-w-0 flex-1 text-sm">{t.message}</span>
          {t.actionLabel && (
            <button
              className="min-h-11 shrink-0 text-sm font-bold text-primary"
              disabled={t.exiting}
              onFocus={() => setPaused('focus', true)}
              onBlur={() => window.setTimeout(() => {
                const active = document.activeElement
                setPaused('focus', active instanceof HTMLElement && Boolean(active.closest('.toast button:not(:disabled)')))
              }, 0)}
              onClick={() => {
                t.onAction?.()
                dismiss(t.id)
              }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
