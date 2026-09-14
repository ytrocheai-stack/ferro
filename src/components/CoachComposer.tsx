import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'

export type CoachComposerProps = {
  message: string
  sendDisabled: boolean
  busy?: boolean
  followUp: boolean
  onChange: (value: string) => void
  onSend: () => void
}

export function CoachComposer({ message, sendDisabled, busy = false, followUp, onChange, onSend }: CoachComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(128, Math.max(44, input.scrollHeight))}px`
  }, [message])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    if (!sendDisabled && !busy && message.trim()) onSend()
  }

  const preserveEditorFocus = (event: MouseEvent<HTMLButtonElement>) => {
    if (document.activeElement === inputRef.current) event.preventDefault()
  }

  return <div className="dock-card bg-surface px-3 py-2"><label className="sr-only" htmlFor="coach-message">Mensaje para el coach</label><div className="flex items-end gap-2"><textarea ref={inputRef} id="coach-message" rows={1} maxLength={4000} spellCheck autoCorrect="on" className="min-h-11 max-h-32 min-w-0 flex-1 resize-none rounded-[12px] border border-border bg-surface-2 px-3 py-2 text-base leading-6 outline-none focus:border-primary" value={message} onChange={(event) => onChange(event.currentTarget.value)} onKeyDown={handleKeyDown} onCompositionStart={() => { composingRef.current = true }} onCompositionEnd={() => { composingRef.current = false }} placeholder={sendDisabled ? 'El coach está procesando…' : 'Pregunta al coach…'} /><button className="btn btn-primary min-h-11 shrink-0 px-4 text-sm" type="button" disabled={sendDisabled || busy || !message.trim()} onMouseDown={preserveEditorFocus} onClick={onSend}>{busy ? 'Enviando…' : followUp ? 'Continuar' : 'Enviar'}</button></div>{followUp && <p className="pt-1 text-xs text-muted">Tu respuesta continuará la ejecución.</p>}</div>
}
