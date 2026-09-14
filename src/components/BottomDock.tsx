import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useKeypad } from './GymKeypad'

type DockSlot = 'coach' | 'session' | 'rest' | 'toasts'
type DockContextValue = { slots: Partial<Record<DockSlot, ReactNode>>; setSlot: (slot: DockSlot, content: ReactNode) => void }
const DockContext = createContext<DockContextValue | null>(null)

export function BottomDockProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Partial<Record<DockSlot, ReactNode>>>({})
  const setSlot = useCallback((slot: DockSlot, content: ReactNode) => setSlots((current) => current[slot] === content ? current : ({ ...current, [slot]: content })), [])
  const value = useMemo(() => ({
    slots,
    setSlot,
  }), [setSlot, slots])
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBottomDock() {
  const value = useContext(DockContext)
  if (!value) throw new Error('useBottomDock debe usarse dentro de BottomDockProvider')
  return value
}

export function BottomDock({
  navigation,
  accessory,
  coach,
  session,
  rest,
  toasts,
  onHeightChange,
}: {
  navigation?: ReactNode
  accessory?: ReactNode
  coach?: ReactNode
  session?: ReactNode
  rest?: ReactNode
  toasts?: ReactNode
  onHeightChange?: (height: number) => void
}) {
  const context = useContext(DockContext)
  const editingNumber = useKeypad((state) => state.target !== null)
  const dockSlots = context?.slots ?? {}
  const ref = useRef<HTMLDivElement>(null)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport
      const active = document.activeElement
      const inputFocused = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || Boolean(active?.closest('.gym-keypad'))
      const covered = vv ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) : 0
      setKeyboardOpen(Boolean(covered > 120 && inputFocused))
      setKeyboardOffset(inputFocused ? covered : 0)
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  useEffect(() => {
    if (!ref.current || !onHeightChange) return
    const report = () => onHeightChange(ref.current?.getBoundingClientRect().height ?? 0)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [onHeightChange, navigation, coach, session, rest, toasts])

  return (
    <div ref={ref} className="bottom-dock" data-keyboard-open={keyboardOpen || editingNumber || undefined} style={keyboardOffset ? { transform: `translateY(-${keyboardOffset}px)` } : undefined}>
      <div className="bottom-dock__stack">
        {toasts ?? dockSlots.toasts}
        {rest ?? dockSlots.rest}
        {session ?? dockSlots.session}
        {coach ?? dockSlots.coach}
        {accessory}
        {navigation}
      </div>
    </div>
  )
}
