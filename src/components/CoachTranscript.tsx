import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CoachMessage, CoachRunRecord } from '../db/types'
import { isRenderableCoachProposal } from '../lib/coachPresentation'

export function CoachTranscript({ conversationId, messages, runs, onLoadOlder, hasOlder, loadingOlder }: { conversationId?: string; messages: CoachMessage[]; runs: CoachRunRecord[]; onLoadOlder: () => void; hasOlder: boolean; loadingOlder: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)
  const previousHeight = useRef(0)
  const previousConversationId = useRef<string>()
  const [showLatest, setShowLatest] = useState(false)
  const ordered = [...messages].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const runById = new Map(runs.map((run) => [run.id, run]))

  useLayoutEffect(() => {
    const node = viewportRef.current
    if (!node) return
    if (previousConversationId.current !== conversationId) {
      previousConversationId.current = conversationId
      wasNearBottom.current = true
      node.scrollTop = node.scrollHeight
      previousHeight.current = node.scrollHeight
      return
    }
    if (previousHeight.current && !wasNearBottom.current) node.scrollTop += node.scrollHeight - previousHeight.current
    else if (wasNearBottom.current) node.scrollTop = node.scrollHeight
    previousHeight.current = node.scrollHeight
  }, [conversationId, messages.length])

  useEffect(() => { setShowLatest(false) }, [conversationId])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const onScroll = () => { const near = node.scrollHeight - node.scrollTop - node.clientHeight < 80; wasNearBottom.current = near; setShowLatest(!near) }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])
  return <div className="coach-transcript-wrap">
    <div className="coach-transcript" ref={viewportRef} role="log" aria-label="Conversación con Coach" onScroll={(event) => { if (event.currentTarget.scrollTop < 80 && hasOlder && !loadingOlder) onLoadOlder() }}>
      {hasOlder && <button className="btn btn-surface mx-auto mb-3 min-h-10 px-3 text-sm" type="button" onClick={onLoadOlder} disabled={loadingOlder}>{loadingOlder ? 'Cargando…' : 'Cargar mensajes anteriores'}</button>}
      {ordered.length === 0 && <p className="py-12 text-center text-sm text-muted">Escribe una pregunta para comenzar este chat.</p>}
      {ordered.map((message) => { const run = runById.get(message.runId); return <article className={`coach-message coach-message--${message.role}`} key={message.id}>
        <p className="text-xs font-semibold text-muted">{message.role === 'user' ? 'Tú' : 'Coach'}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        {run && isRenderableCoachProposal(run) && message.role === 'assistant' && <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3 text-sm"><strong>Propuesta validada</strong><p className="mt-1 text-muted">Revisa y confirma los cambios antes de aplicarlos.</p></div>}
      </article> })}
    </div>
    {showLatest && <button className="coach-transcript__latest btn btn-surface min-h-10 px-3 text-sm" type="button" onClick={() => { const node = viewportRef.current; if (node) { node.scrollTop = node.scrollHeight; wasNearBottom.current = true; setShowLatest(false) } }}>Ir al último mensaje</button>}
  </div>
}
