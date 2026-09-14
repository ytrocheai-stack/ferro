import type { CoachConversation } from '../db/types'

export function CoachConversationHistory({ conversations, selectedId, onSelect, onNew, onRename, onDelete }: {
  conversations: CoachConversation[]
  selectedId?: string
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (conversation: CoachConversation) => void
  onDelete: (conversation: CoachConversation) => void
}) {
  return <aside className="coach-history" aria-label="Historial de conversaciones">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Conversaciones</h2>
      <button className="btn btn-surface min-h-10 px-3 text-sm" type="button" onClick={onNew}>Nuevo chat</button>
    </div>
    <div className="mt-3 flex flex-col gap-1" role="list">
      {conversations.length === 0 && <p className="px-2 py-4 text-sm text-muted">Aún no hay conversaciones.</p>}
      {conversations.map((conversation) => <div className={`coach-history__item ${conversation.id === selectedId ? 'coach-history__item--selected' : ''}`} key={conversation.id} role="listitem">
        <button className="min-w-0 flex-1 truncate rounded-xl px-3 py-3 text-left text-sm font-medium" type="button" onClick={() => onSelect(conversation.id)} aria-current={conversation.id === selectedId ? 'page' : undefined}>{conversation.title}</button>
        <button className="pressable shrink-0 rounded-lg text-muted" type="button" aria-label={`Renombrar ${conversation.title}`} onClick={() => onRename(conversation)}>•••</button>
        <button className="pressable shrink-0 rounded-lg px-1 text-xs text-danger" type="button" aria-label={`Eliminar ${conversation.title}`} onClick={() => onDelete(conversation)}>×</button>
      </div>)}
    </div>
  </aside>
}
