import type { ReactNode } from 'react'
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

export function Sheet({ open, onClose, title, children, full = false }: SheetProps) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`sheet-in relative mx-auto flex w-full max-w-md flex-col rounded-t-2xl border-t border-border bg-surface ${
          full ? 'h-[92dvh]' : 'max-h-[85dvh]'
        }`}
      >
        <header className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full bg-surface-2 p-2 text-muted"
            aria-label="Cerrar"
          >
            <IconX size={16} />
          </button>
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
            className={`flex items-center gap-3 rounded-xl px-3 py-3.5 text-left font-medium active:bg-surface-2 ${
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
