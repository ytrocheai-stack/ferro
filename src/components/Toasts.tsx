import { useToasts } from '../stores/toasts'

/** Toasts apilados sobre la barra de tabs; no roban el foco (aria-live). */
export function Toasts({ hideTabs }: { hideTabs: boolean }) {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  if (!toasts.length) return null

  const bottom = hideTabs
    ? 'calc(0.75rem + env(safe-area-inset-bottom))'
    : 'calc(5.8rem + env(safe-area-inset-bottom))'

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2"
      style={{ bottom }}
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex w-[calc(100%-2rem)] max-w-sm items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 shadow-lg shadow-black/50 sheet-in"
        >
          <span className="min-w-0 flex-1 text-sm">{t.message}</span>
          {t.actionLabel && (
            <button
              className="shrink-0 text-sm font-bold text-primary"
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
