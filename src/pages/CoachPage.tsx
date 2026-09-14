import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import Dexie from 'dexie'
import { db } from '../db/db'
import type { CoachConversation, CoachMessage, CoachRunRecord } from '../db/types'
import { getCoachAccountId } from '../lib/coachAccount'
import { getCoachConsent, getCoachConversationId, setCoachConversationId } from '../lib/coachConsent'
import { applyCoachChangeSet, isRetryableCoachError, refreshCoachRun, startCoachRun } from '../lib/coachClient'
import { ensureCoachConversation, createCoachConversation, deleteCoachConversation, getCoachDraft, renameCoachConversation, setCoachDraft, flushCoachDraft } from '../lib/coachConversations'
import { PageHeader } from '../components/PageHeader'
import { CoachComposer } from '../components/CoachComposer'
import { CoachConversationHistory } from '../components/CoachConversationHistory'
import { CoachTranscript } from '../components/CoachTranscript'
import { isRenderableCoachProposal } from '../lib/coachPresentation'
import { Confirm, Sheet } from '../components/Sheet'
import { useBottomDock } from '../components/BottomDock'

const pageSize = 50
const defaultTitle = 'Nueva conversación'
const pendingCancellation = (run: CoachRunRecord) => Boolean(run.cancelRequestedAt || run.error === 'cancellation-pending')
const errorLabel = (error?: string) => error === 'provider-rate-limited' ? 'El proveedor limitó temporalmente la consulta.' : error === 'coach-call-timeout' ? 'La respuesta tardó demasiado. Puedes solicitar otro intento.' : error ?? 'No se pudo completar la respuesta.'

function sortRuns(left: CoachRunRecord, right: CoachRunRecord): number {
  return left.updatedAt - right.updatedAt || left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

function statusFor(run: CoachRunRecord | undefined, busy: boolean): string {
  if (busy) return 'Enviando'
  if (!run) return 'Guardado local'
  if (pendingCancellation(run)) return 'Cancelación pendiente'
  if (run.status === 'queued') return typeof navigator !== 'undefined' && !navigator.onLine ? 'Pendiente de conexión' : 'Guardado local'
  if (run.status === 'running') return 'Respondiendo'
  if (run.status === 'completed' && !run.decision) return 'Incompleto'
  if (run.status === 'completed') return 'Completado'
  if (run.status === 'failed') return 'Error'
  return 'Cancelado'
}

export default function CoachPage() {
  const { getToken, isSignedIn } = useAuth()
  const ownerId = getCoachAccountId()
  const consent = Boolean(ownerId && getCoachConsent(ownerId))
  const { coachPortalTarget } = useBottomDock()
  const [conversations, setConversations] = useState<CoachConversation[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [runs, setRuns] = useState<CoachRunRecord[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [menuConversation, setMenuConversation] = useState<CoachConversation>()
  const [confirmDelete, setConfirmDelete] = useState<CoachConversation>()
  const [confirmApply, setConfirmApply] = useState<CoachRunRecord>()
  const [editingTitle, setEditingTitle] = useState<CoachConversation>()
  const [titleDraft, setTitleDraft] = useState('')
  const [actionError, setActionError] = useState<string>()
  const revision = useRef(0)
  const draftRef = useRef('')
  const selectedIdRef = useRef<string>()
  const conversationOffset = useRef(0)
  const messageOffset = useRef(0)
  const conversationGeneration = useRef(0)

  selectedIdRef.current = selectedId
  const selected = conversations.find((item) => item.id === selectedId)
  const selectedRuns = useMemo(() => runs.filter((run) => run.ownerId === ownerId && run.conversationId === selectedId).sort(sortRuns), [ownerId, runs, selectedId])
  const latestRun = selectedRuns.at(-1)
  const activeRun = selectedRuns.find((run) => run.status === 'queued' || run.status === 'running' || pendingCancellation(run))

  const loadConversations = useCallback(async (append = false) => {
    if (!ownerId || getCoachAccountId() !== ownerId) return
    const offset = append ? conversationOffset.current : 0
    const query = db.coachConversations.where('[ownerId+updatedAt]').between([ownerId, Dexie.minKey], [ownerId, Dexie.maxKey])
    const total = await query.count()
    const page = await query.reverse().offset(offset).limit(pageSize).toArray()
    const batch = page.filter((item) => item.ownerId === ownerId && !item.pendingDeletion)
    if (getCoachAccountId() !== ownerId) return
    const previousOffset = conversationOffset.current
    conversationOffset.current = offset + page.length
    setHasMoreConversations(conversationOffset.current < total)
    setConversations((current) => {
      const source = append || previousOffset > pageSize ? [...current, ...batch] : batch
      return [...new Map(source.filter((item) => item.ownerId === ownerId && !item.pendingDeletion).map((item) => [item.id, item])).values()].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    })
    if (!selectedIdRef.current) {
      const preferred = getCoachConversationId(ownerId)
      const persisted = preferred ? await db.coachConversations.get(preferred) : undefined
      const candidate = persisted?.ownerId === ownerId && !persisted.pendingDeletion ? persisted : batch[0]
      if (candidate) { setSelectedId(candidate.id); setCoachConversationId(ownerId, candidate.id) }
    }
  }, [ownerId])

  const loadMessages = useCallback(async (conversationId: string, mode: 'initial' | 'refresh' | 'older' = 'initial') => {
    if (!ownerId || getCoachAccountId() !== ownerId || selectedIdRef.current !== conversationId) return
    const generation = conversationGeneration.current
    const conversation = await db.coachConversations.get(conversationId)
    if (!conversation || conversation.ownerId !== ownerId || conversation.pendingDeletion) return
    const query = db.coachMessages.where('[conversationId+sequence]').between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
    const total = await query.count()
    const offset = mode === 'older' ? messageOffset.current : 0
    const limit = mode === 'refresh' ? Math.max(pageSize, messageOffset.current) : pageSize
    const page = await query.reverse().offset(offset).limit(limit).toArray()
    const batch = page.filter((item) => item.ownerId === ownerId && item.conversationId === conversationId).reverse()
    if (generation !== conversationGeneration.current || selectedIdRef.current !== conversationId || getCoachAccountId() !== ownerId) return
    const unique = (items: CoachMessage[]) => [...new Map(items.map((item) => [item.id, item])).values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    if (mode === 'older') setMessages((current) => unique([...batch, ...current]))
    else setMessages(unique(batch))
    messageOffset.current = mode === 'older' ? offset + page.length : page.length
    setHasOlder(total > messageOffset.current)
  }, [ownerId])

  useEffect(() => { conversationOffset.current = 0; if (consent) void loadConversations() }, [consent, loadConversations])

  useEffect(() => {
    if (!ownerId || !selectedId) return
    messageOffset.current = 0
    setMessages([])
    setHasOlder(false)
    const generation = conversationGeneration.current
    let current = true
    void Promise.all([loadMessages(selectedId), db.coachRuns.where('ownerId').equals(ownerId).toArray(), getCoachDraft(ownerId, selectedId)]).then(([, nextRuns, savedDraft]) => {
      if (!current || generation !== conversationGeneration.current || selectedIdRef.current !== selectedId || getCoachAccountId() !== ownerId) return
      setRuns(nextRuns.filter((run) => run.ownerId === ownerId))
      draftRef.current = savedDraft
      setDraft(savedDraft)
    })
    return () => { current = false }
  }, [loadMessages, ownerId, selectedId])

  useEffect(() => {
    if (!ownerId || !selectedId) return
    const timer = window.setInterval(() => {
      if (selectedIdRef.current !== selectedId) return
      void Promise.all([loadMessages(selectedId, 'refresh'), db.coachRuns.where('ownerId').equals(ownerId).toArray(), loadConversations()]).then(([, nextRuns]) => {
        if (selectedIdRef.current === selectedId && getCoachAccountId() === ownerId) setRuns(nextRuns.filter((run) => run.ownerId === ownerId))
      })
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [loadConversations, loadMessages, ownerId, selectedId])

  const selectConversation = async (id: string) => {
    if (!ownerId) return
    conversationGeneration.current += 1
    await flushCoachDraft(ownerId, selectedId ?? id)
    messageOffset.current = 0
    setSelectedId(id)
    setCoachConversationId(ownerId, id)
    setHistoryOpen(false)
  }

  const newConversation = async () => {
    if (!ownerId) return
    const conversation = await createCoachConversation(ownerId)
    await loadConversations()
    await selectConversation(conversation.id)
    draftRef.current = ''
    setDraft('')
    setHistoryOpen(false)
  }

  const submitTitle = async () => {
    if (!ownerId || !editingTitle) return
    const updated = await renameCoachConversation(ownerId, editingTitle.id, titleDraft)
    setConversations((current) => current.map((item) => item.id === updated.id ? updated : item))
    setEditingTitle(undefined)
  }

  const doDelete = async () => {
    if (!ownerId || !confirmDelete) return
    const id = confirmDelete.id
    const deleted = await deleteCoachConversation(ownerId, id)
    setConfirmDelete(undefined)
    setMenuConversation(undefined)
    if (!deleted) { setActionError('Cancelación pendiente: se conservará el historial hasta confirmar la cancelación.'); return }
    if (selectedId === id) { conversationGeneration.current += 1; setSelectedId(undefined); setMessages([]); draftRef.current = ''; setDraft('') }
    conversationOffset.current = 0
    await loadConversations()
  }

  const send = async () => {
    if (!ownerId || !draft.trim() || busy || activeRun) return
    const conversation = selected ?? await ensureCoachConversation(ownerId)
    const conversationId = conversation.id
    if (!selectedId) { setSelectedId(conversationId); setCoachConversationId(ownerId, conversationId); await loadConversations() }
    const text = draft
    const sentRevision = revision.current
    const causedByEventId = latestRun?.decision?.kind === 'ask' ? latestRun.eventId : undefined
    setBusy(true)
    setActionError(undefined)
    try {
      const next = await startCoachRun(getToken, text, { conversationId, causedByEventId })
      setRuns((current) => [next, ...current.filter((run) => run.id !== next.id)])
      if (conversation.title === defaultTitle) {
        const renamed = await renameCoachConversation(ownerId, conversationId, text.slice(0, 48))
        setConversations((current) => current.map((item) => item.id === renamed.id ? renamed : item))
      }
      if (selectedIdRef.current === conversationId && revision.current === sentRevision && draftRef.current === text) { draftRef.current = ''; setDraft(''); setCoachDraft(ownerId, conversationId, '') }
      await loadMessages(conversationId, 'refresh')
    } catch (cause) { setActionError(errorLabel(cause instanceof Error ? cause.message : undefined)) } finally { setBusy(false) }
  }

  const refresh = async (run: CoachRunRecord) => {
    const next = await refreshCoachRun(getToken, run.id)
    if (next) setRuns((current) => current.map((item) => item.id === next.id ? next : item))
    if (selectedId) await loadMessages(selectedId, 'refresh')
  }

  const applyProposal = async (run: CoachRunRecord) => {
    if (!isRenderableCoachProposal(run) || applying) return
    setApplying(true)
    try { await applyCoachChangeSet(run.id); setRuns((current) => current.map((item) => item.id === run.id ? { ...item, appliedAt: Date.now() } : item)) }
    catch (cause) { setActionError(errorLabel(cause instanceof Error ? cause.message : undefined)) }
    finally { setApplying(false) }
  }

  if (!isSignedIn) return <section className="page-content pt-3"><PageHeader title="Coach" /><p className="mt-4 text-base leading-6 text-muted">Inicia sesión para usar el coach privado.</p><Link className="btn btn-primary mt-4 w-full" to="/perfil">Ir a Perfil</Link></section>
  if (!consent) return <section className="page-content pt-3"><PageHeader title="Coach" /><p className="mt-4 text-base leading-6 text-muted">Activa el consentimiento desde Perfil para enviar contexto al coach.</p><Link className="btn btn-primary mt-4 w-full" to="/perfil">Resolver en Perfil</Link></section>

  const status = statusFor(activeRun ?? latestRun, busy)
  const renderHistory = (className?: string) => <CoachConversationHistory className={className} conversations={conversations} selectedId={selectedId} onSelect={(id) => void selectConversation(id)} onNew={() => void newConversation()} onRename={(conversation) => { setMenuConversation(conversation); setTitleDraft(conversation.title) }} onDelete={setConfirmDelete} hasMore={hasMoreConversations} loadingMore={loadingMoreConversations} onLoadMore={() => { if (loadingMoreConversations) return; setLoadingMoreConversations(true); void loadConversations(true).finally(() => setLoadingMoreConversations(false)) }} />
  return <div className="page-content coach-page pb-4 pt-3">
    <PageHeader title="Coach" action={<><button className="btn btn-primary min-h-11 px-3 text-sm coach-new-mobile" type="button" onClick={() => void newConversation()}>Nuevo chat</button><button className="page-header__profile pressable coach-history-mobile" type="button" aria-label="Abrir historial" onClick={() => setHistoryOpen(true)}>☰</button></>} />
    <div className="coach-layout">
      {renderHistory()}
      <main className="coach-conversation" aria-labelledby="coach-conversation-title">
        <div className="coach-conversation__header"><div className="min-w-0"><h2 id="coach-conversation-title" className="truncate text-lg font-bold">{selected?.title ?? 'Nuevo chat'}</h2><p className="text-xs text-muted" role="status" aria-live="polite">{status}</p></div><button className="btn btn-primary coach-new-desktop min-h-10 px-3 text-sm" type="button" onClick={() => void newConversation()}>Nuevo chat</button></div>
        {actionError && <p role="alert" className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">{actionError}</p>}
        {latestRun?.error && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">{pendingCancellation(latestRun) ? 'Cancelación pendiente: aún no se ha confirmado el estado remoto.' : errorLabel(latestRun.error)}{isRetryableCoachError(latestRun.error) && <button className="ml-2 underline" type="button" onClick={() => void refresh(latestRun)}>Reintentar</button>}</p>}
        {latestRun && isRenderableCoachProposal(latestRun) && <section className="card mt-3 p-3" aria-label="Propuesta del coach"><p className="text-sm font-semibold">Propuesta validada y lista para revisar</p><p className="mt-1 text-sm text-muted">{latestRun.decision?.explanation}</p><button className="btn btn-primary mt-3 w-full" type="button" disabled={applying || Boolean(latestRun.appliedAt)} onClick={() => setConfirmApply(latestRun)}>{latestRun.appliedAt ? 'Aplicado' : applying ? 'Aplicando…' : 'Confirmar y aplicar'}</button></section>}
        <CoachTranscript conversationId={selectedId} messages={messages} runs={selectedRuns} hasOlder={hasOlder} loadingOlder={loadingOlder} onLoadOlder={() => { if (!selectedId || loadingOlder) return; setLoadingOlder(true); void loadMessages(selectedId, 'older').finally(() => setLoadingOlder(false)) }} />
      </main>
    </div>
    {coachPortalTarget && createPortal(<CoachComposer message={draft} busy={busy} sendDisabled={Boolean(activeRun)} followUp={Boolean(latestRun?.decision?.kind === 'ask')} onChange={(value) => { revision.current += 1; draftRef.current = value; setDraft(value); if (ownerId && selectedId) setCoachDraft(ownerId, selectedId, value) }} onSend={() => void send()} />, coachPortalTarget)}
    <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Historial">{renderHistory('coach-history coach-history--sheet')}</Sheet>
    <Sheet open={Boolean(menuConversation)} onClose={() => setMenuConversation(undefined)} title={menuConversation?.title}><div className="flex flex-col gap-2 pb-2"><button className="btn btn-surface" type="button" onClick={() => { setEditingTitle(menuConversation); setMenuConversation(undefined) }}>Renombrar</button><button className="btn btn-danger" type="button" onClick={() => { setConfirmDelete(menuConversation); setMenuConversation(undefined) }}>Eliminar historial</button></div></Sheet>
    <Sheet open={Boolean(editingTitle)} onClose={() => setEditingTitle(undefined)} title="Renombrar conversación"><form className="flex flex-col gap-3 pb-2" onSubmit={(event) => { event.preventDefault(); void submitTitle() }}><label className="text-sm font-semibold" htmlFor="coach-title">Nombre</label><input id="coach-title" className="input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} autoFocus /><button className="btn btn-primary" type="submit">Guardar nombre</button></form></Sheet>
    <Confirm open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(undefined)} title="Eliminar conversación" message={`Se eliminará “${confirmDelete?.title ?? ''}” de este dispositivo. Las rutinas aplicadas no se revierten.`} confirmLabel="Eliminar" danger onConfirm={() => void doDelete()} />
    <Confirm open={Boolean(confirmApply)} onClose={() => setConfirmApply(undefined)} title="Confirmar propuesta" message="Se aplicarán los cambios validados a tus rutinas. Esta acción no revierte automáticamente las modificaciones posteriores." confirmLabel="Aplicar cambios" onConfirm={() => { const run = confirmApply; setConfirmApply(undefined); if (run) void applyProposal(run) }} />
  </div>
}
