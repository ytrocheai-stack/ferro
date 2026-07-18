import { useRef, type ReactNode, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { IconX } from './icons'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** ocupa casi toda la pantalla (para selectores con listas largas) */
  full?: boolean
}

/** Hoja inferior con handle y gesto de arrastre hacia abajo para cerrar. */
export function Sheet({ open, onClose, title, children, full = false }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startY: number; dy: number } | null>(null)

  if (!open) return null

  const onTouchStart = (e: TouchEvent) => {
    drag.current = { startY: e.touches[0].clientY, dy: 0 }
    if (panelRef.current) panelRef.current.style.transition = 'none'
  }
  const onTouchMove = (e: TouchEvent) => {
    if (!drag.current || !panelRef.current) return
    const dy = Math.max(0, e.touches[0].clientY - drag.current.startY)
    drag.current.dy = dy
    panelRef.current.style.transform = `translateY(${dy}px)`
  }
  const onTouchEnd = () => {
    const panel = panelRef.current
    const dy = drag.current?.dy ?? 0
    drag.current = null
    if (!panel) return
    panel.style.transition = 'transform 0.2s ease-out'
    if (dy > 80) {
      panel.style.transform = 'translateY(105%)'
      setTimeout(onClose, 180)
    } else {
      panel.style.transform = ''
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        className={`sheet-in relative mx-auto flex w-full max-w-md flex-col rounded-t-2xl border-t border-border bg-surface ${
          full ? 'h-[92dvh]' : 'max-h-[85dvh]'
        }`}
      >
        <header
          className="touch-none select-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
          <div className="flex min-h-11 items-center justify-between px-4 pb-1 pt-1.5">
            <h2 className="text-base font-bold">{title}</h2>
            <button
              onClick={onClose}
              className="pressable -mr-1 rounded-full bg-surface-2 p-2 text-muted"
              aria-label="Cerrar"
            >
              <IconX size={16} />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export interface ActionItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  onClick: () => void
}

/** Menú de acciones estilo hoja inferior. */
export function ActionSheet({
  open,
  onClose,
  title,
  actions,
}: {
  open: boolean
  onClose: () => void
  title?: string
  actions: ActionItem[]
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-1 pb-2">
        {actions.map((a, i) => (
          <button
            key={i}
            onClick={() => {
              onClose()
              a.onClick()
            }}
            className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 text-left font-medium active:bg-surface-2 ${
              a.danger ? 'text-danger' : ''
            }`}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function Confirm({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = false,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {message && <p className="pb-4 text-sm text-muted">{message}</p>}
      <div className="flex gap-3 pb-2">
        <button className="btn btn-surface flex-1" onClick={onClose}>
          Cancelar
        </button>
        <button
          className={`btn flex-1 ${danger ? 'bg-danger text-white' : 'btn-primary'}`}
          onClick={() => {
            onClose()
            onConfirm()
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}
