import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconX } from './icons'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  full?: boolean
  action?: ReactNode
}

type SheetPhase = 'entering' | 'open' | 'exiting'
type SheetEntry = { id: symbol; panel: HTMLDivElement | null; trigger: HTMLElement | null; onClose: () => void }
const sheetStack: SheetEntry[] = []
let scrollLockCount = 0
let lockedScrollTop = 0

function syncInertness() {
  const top = sheetStack.length - 1
  sheetStack.forEach((entry, index) => {
    if (entry.panel) entry.panel.inert = index !== top
  })
  const app = document.getElementById('root')
  if (app) app.inert = sheetStack.length > 0
}

function lockDocumentScroll() {
  if (scrollLockCount++ > 0) return
  lockedScrollTop = window.scrollY
  document.body.dataset.modalOpen = 'true'
  document.body.style.overflow = 'hidden'
  document.body.style.position = 'fixed'
  document.body.style.top = `-${lockedScrollTop}px`
  document.body.style.width = '100%'
}

function unlockDocumentScroll() {
  if (scrollLockCount === 0 || --scrollLockCount > 0) return
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.width = ''
  delete document.body.dataset.modalOpen
  window.scrollTo(0, lockedScrollTop)
}

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => {
    if (element.tabIndex < 0 || element.closest('[hidden], [inert]')) return false
    for (let node: HTMLElement | null = element; node && node !== panel; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  })
}

function readMotionMs(name: '--motion-enter' | '--motion-exit', fallback: number): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 100
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const match = value.match(/([\d.]+)ms/)
  return match ? Number(match[1]) : fallback
}

export function Sheet({ open, onClose, title, children, full = false, action }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const entryRef = useRef<SheetEntry | null>(null)
  const dragRef = useRef<{ pointerId: number; startY: number; startTime: number; rawDy: number } | null>(null)
  const timerRef = useRef<number | null>(null)
  const titleId = useId()
  const [rendered, setRendered] = useState(open)
  const [phase, setPhase] = useState<SheetPhase>(open ? 'entering' : 'exiting')

  closeRef.current = onClose

  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    if (open) {
      if (!rendered) {
        setPhase('entering')
        setRendered(true)
        return
      }
      let secondFrame = 0
      const frame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (panelRef.current) {
            panelRef.current.style.transition = ''
            panelRef.current.style.transform = ''
          }
          setPhase('open')
        })
      })
      return () => { window.cancelAnimationFrame(frame); window.cancelAnimationFrame(secondFrame) }
    }
    if (!rendered) return
    setPhase('exiting')
    timerRef.current = window.setTimeout(() => setRendered(false), readMotionMs('--motion-exit', 160) + 50)
    return () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current) }
  }, [open, rendered])

  useEffect(() => {
    if (!rendered || !panelRef.current) return
    const entry: SheetEntry = {
      id: Symbol('sheet'),
      panel: panelRef.current,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      onClose: () => closeRef.current(),
    }
    entryRef.current = entry
    sheetStack.push(entry)
    lockDocumentScroll()
    syncInertness()
    const initial = panelRef.current.querySelector<HTMLElement>('[data-sheet-initial-focus]') ?? panelRef.current
    const focusFrame = window.requestAnimationFrame(() => {
      if (sheetStack[sheetStack.length - 1] === entry) initial.focus({ preventScroll: true })
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (sheetStack[sheetStack.length - 1] !== entry) return
      if (event.key === 'Escape') {
        event.preventDefault()
        entry.onClose()
        return
      }
      if (event.key !== 'Tab' || !entry.panel) return
      const items = focusables(entry.panel)
      if (!items.length) {
        event.preventDefault()
        entry.panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (!items.includes(document.activeElement as HTMLElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      const wasTop = sheetStack[sheetStack.length - 1] === entry
      const index = sheetStack.indexOf(entry)
      if (index >= 0) sheetStack.splice(index, 1)
      if (entry.panel) entry.panel.inert = false
      syncInertness()
      unlockDocumentScroll()
      if (wasTop && entry.trigger?.isConnected && !entry.trigger.closest('[inert]')) {
        entry.trigger.focus({ preventScroll: true })
      }
      entryRef.current = null
    }
  }, [rendered])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current || event.isPrimary === false) return
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startTime: performance.now(), rawDy: 0 }
    handleRef.current?.setPointerCapture(event.pointerId)
    if (panelRef.current) panelRef.current.style.transition = 'none'
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const panel = panelRef.current
    if (!drag || drag.pointerId !== event.pointerId || !panel) return
    const rawDy = event.clientY - drag.startY
    drag.rawDy = rawDy
    const dy = rawDy >= 0 ? rawDy : rawDy * 0.2
    panel.style.transform = `translateY(${dy}px)`
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current
    const panel = panelRef.current
    if (!drag || drag.pointerId !== event.pointerId || !panel) return
    dragRef.current = null
    if (handleRef.current?.hasPointerCapture(event.pointerId)) handleRef.current.releasePointerCapture(event.pointerId)
    panel.style.transition = `transform ${readMotionMs('--motion-enter', 220)}ms var(--ease-drawer)`
    if (cancelled) {
      panel.style.transform = ''
      return
    }
    const elapsed = Math.max(1, performance.now() - drag.startTime)
    const velocity = Math.max(0, drag.rawDy) / elapsed
    if (drag.rawDy >= 12 && (drag.rawDy > 80 || velocity > 0.11)) {
      panel.style.transition = `transform ${readMotionMs('--motion-exit', 160)}ms var(--ease-out)`
      panel.style.transform = 'translateY(100%)'
      closeRef.current()
      return
    }
    panel.style.transform = ''
  }

  if (!rendered) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="sheet-scrim absolute inset-0" data-state={phase} onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        className={`sheet-panel relative mx-auto flex w-full max-w-md flex-col rounded-t-[28px] border-t border-border bg-surface ${full ? 'h-[92dvh]' : 'max-h-[85dvh]'}`}
        data-state={phase}
        onTransitionEnd={(event) => {
          if (!open && phase === 'exiting' && event.target === event.currentTarget && (event.propertyName === 'transform' || event.propertyName === 'opacity')) setRendered(false)
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Panel'}
        tabIndex={-1}
      >
        <header className="select-none px-4 pt-1">
          <div
            ref={handleRef}
            className="sheet-handle mx-auto"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={(event) => onPointerEnd(event, true)}
            aria-hidden="true"
          />
          <div className="flex min-h-12 items-center justify-between gap-3 pb-1 pt-1">
            {title ? <h2 id={titleId} className="min-w-0 flex-1 text-[17px] font-semibold leading-[22px]" data-sheet-initial-focus tabIndex={-1}>{title}</h2> : <span className="flex-1" />}
            {action}
            <button onClick={() => closeRef.current()} className="pressable -mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-surface-2 text-muted" aria-label="Cerrar">
              <IconX size={17} />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export interface ActionItem { label: string; icon?: ReactNode; danger?: boolean; onClick: () => void }

export function ActionSheet({ open, onClose, title, actions }: { open: boolean; onClose: () => void; title?: string; actions: ActionItem[] }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-1 pb-2">
        {actions.map((action, index) => (
          <button key={index} onClick={() => { onClose(); action.onClick() }} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 text-left font-medium active:bg-surface-2 ${action.danger ? 'text-danger' : ''}`}>
            {action.icon}{action.label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function Confirm({ open, onClose, title, message, confirmLabel = 'Confirmar', danger = false, onConfirm }: { open: boolean; onClose: () => void; title: string; message?: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {message && <p className="pb-4 text-base leading-6 text-muted">{message}</p>}
      <div className="flex gap-3 pb-2">
        <button className="btn btn-surface flex-1" onClick={onClose}>Cancelar</button>
        <button className={`btn flex-1 ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onClose(); onConfirm() }}>{confirmLabel}</button>
      </div>
    </Sheet>
  )
}
