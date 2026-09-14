import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachPage from './CoachPage'
import { useBottomDock } from '../components/BottomDock'
import { startCoachRun, streamCoachRun } from '../lib/coachClient'

const fixture = vi.hoisted(() => ({
  conversations: [{ id: 'conversation-1', ownerId: 'owner-1', title: 'Rutina de fuerza', createdAt: 1, updatedAt: 1, nextSequence: 1 }, { id: 'conversation-2', ownerId: 'owner-1', title: 'Movilidad', createdAt: 2, updatedAt: 2, nextSequence: 1 }],
  messages: [] as unknown[],
  runs: [] as unknown[],
  draft: '',
  streamingEnabled: false,
}))

vi.mock('@clerk/react', () => ({ useAuth: () => ({ getToken: vi.fn(), isSignedIn: true }) }))
vi.mock('../components/BottomDock', () => ({ useBottomDock: vi.fn() }))
vi.mock('../lib/coachAccount', () => ({ getCoachAccountId: () => 'owner-1' }))
vi.mock('../lib/coachConsent', () => ({ getCoachConsent: () => ({ enabled: true }), getCoachConversationId: () => 'conversation-1', setCoachConversationId: vi.fn() }))
vi.mock('../lib/coachClient', () => ({ startCoachRun: vi.fn(), refreshCoachRun: vi.fn(), streamCoachRun: vi.fn(), isCoachStreamingEnabled: () => fixture.streamingEnabled, isRetryableCoachError: () => false, applyCoachChangeSet: vi.fn() }))
vi.mock('../lib/coachConversations', () => ({
  ensureCoachConversation: vi.fn(async () => fixture.conversations[0]),
  createCoachConversation: vi.fn(async () => ({ id: 'conversation-2', ownerId: 'owner-1', title: 'Nueva conversación', createdAt: 2, updatedAt: 2, nextSequence: 1 })),
  deleteCoachConversation: vi.fn(async () => true), getCoachDraft: vi.fn(async () => fixture.draft), renameCoachConversation: vi.fn(async (ownerId: string, id: string, title: string) => ({ id, ownerId, title, createdAt: 1, updatedAt: 2, nextSequence: 1 })), setCoachDraft: vi.fn(), flushCoachDraft: vi.fn(),
}))
vi.mock('../db/db', () => { const collection = (rows: unknown[]) => { const value = { toArray: vi.fn(async () => rows), count: vi.fn(async () => rows.length), reverse: vi.fn(), limit: vi.fn(), offset: vi.fn(), between: vi.fn(), equals: vi.fn() }; value.reverse.mockReturnValue(value); value.limit.mockReturnValue(value); value.offset.mockReturnValue(value); value.between.mockReturnValue(value); value.equals.mockReturnValue(value); return value }; return { db: { coachConversations: { where: vi.fn(() => collection(fixture.conversations)), get: vi.fn(async (id: string) => fixture.conversations.find((item) => item.id === id)) }, coachMessages: { where: vi.fn(() => collection(fixture.messages)) }, coachRuns: { where: vi.fn(() => collection(fixture.runs)) } } } })

describe('CoachPage T6', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fixture.messages.length = 0; fixture.runs.length = 0; fixture.draft = ''; fixture.streamingEnabled = false
    const target = document.createElement('div'); document.body.append(target)
    vi.mocked(useBottomDock).mockReturnValue({ coachPortalTarget: target } as ReturnType<typeof useBottomDock>)
  })

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('muestra conversación identificada y permite cambiar el borrador por conversación', async () => {
    const user = userEvent.setup(); render(<MemoryRouter><CoachPage /></MemoryRouter>)
    expect(await screen.findByRole('log', { name: 'Conversación con Coach' })).toBeInTheDocument()
    expect(screen.getByRole('log', { name: 'Conversación con Coach' })).not.toHaveAttribute('aria-live')
    const editor = screen.getByRole('textbox', { name: 'Mensaje para el coach' }); await user.type(editor, 'consulta local')
    expect(editor).toHaveValue('consulta local')
  })

  it('hidrata draft y runs de la conversación inicial sin descartar su propio resultado', async () => {
    fixture.draft = 'borrador hidratado'
    fixture.runs.push({ id: 'run-hydrated', ownerId: 'owner-1', conversationId: 'conversation-1', eventId: 'event-hydrated', contextVersion: 'ctx', status: 'completed', decision: { kind: 'ask', explanation: 'Listo', questions: ['¿Qué equipo tienes?'], observations: [], evidence: [] }, request: { event: { payload: { message: 'pregunta anterior' } } }, createdAt: 1, updatedAt: 2 })
    render(<MemoryRouter><CoachPage /></MemoryRouter>)
    expect(await screen.findByDisplayValue('borrador hidratado')).toBeInTheDocument()
    expect(await screen.findByText('Completado')).toBeInTheDocument()
  })

  it('abre el historial móvil con el componente de conversaciones real', async () => {
    const user = userEvent.setup(); render(<MemoryRouter><CoachPage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Abrir historial' }))
    expect(await screen.findByRole('heading', { name: 'Historial' })).toBeInTheDocument()
    expect(screen.getAllByRole('complementary', { name: 'Historial de conversaciones' }).length).toBeGreaterThan(0)
  })

  it('crea un nuevo chat reutilizable y no duplica el historial visual', async () => {
    const user = userEvent.setup(); render(<MemoryRouter><CoachPage /></MemoryRouter>)
    await user.click((await screen.findAllByRole('button', { name: 'Nuevo chat' }))[0])
    expect(screen.getAllByRole('button', { name: 'Nuevo chat' }).length).toBeGreaterThan(0)
  })

  it('envía al chat seleccionado y conserva la separación de la UI durante la respuesta', async () => {
    vi.mocked(startCoachRun).mockResolvedValue({ id: 'run-1', ownerId: 'owner-1', conversationId: 'conversation-1', eventId: 'event-1', contextVersion: 'context-1', status: 'queued', request: { event: { payload: { message: 'hola' } } }, createdAt: 1, updatedAt: 1 } as never)
    const user = userEvent.setup(); render(<MemoryRouter><CoachPage /></MemoryRouter>); const editor = await screen.findByRole('textbox', { name: 'Mensaje para el coach' }); await user.type(editor, 'hola'); await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(startCoachRun).toHaveBeenCalledWith(expect.any(Function), 'hola', { conversationId: 'conversation-1', causedByEventId: undefined }))
  })

  it('no limpia el draft de la conversación enviada si cambia la selección mientras espera', async () => {
    let resolveRun!: (value: unknown) => void
    vi.mocked(startCoachRun).mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve }) as never)
    const user = userEvent.setup(); render(<MemoryRouter><CoachPage /></MemoryRouter>)
    const editor = await screen.findByRole('textbox', { name: 'Mensaje para el coach' })
    await user.type(editor, 'mensaje pendiente')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await user.click(await screen.findByRole('button', { name: 'Movilidad' }))
    await user.clear(editor)
    await user.type(editor, 'draft de movilidad')
    resolveRun({ id: 'run-pending', ownerId: 'owner-1', conversationId: 'conversation-1', eventId: 'event-pending', contextVersion: 'ctx', status: 'queued', request: { event: { payload: { message: 'mensaje pendiente' } } }, createdAt: 1, updatedAt: 2 })
    expect(await screen.findByDisplayValue('draft de movilidad')).toBeInTheDocument()
  })

  it('usa la reconexión SSE solo con la bandera activa y no crea otro run', async () => {
    fixture.streamingEnabled = true
    const run = { id: 'run-stream', remoteRunId: 'remote-stream', ownerId: 'owner-1', conversationId: 'conversation-1', eventId: 'event-stream', contextVersion: 'ctx', status: 'running', partialExplanation: 'parcial', request: { event: { payload: { message: 'pregunta' } } }, createdAt: 1, updatedAt: 2 }
    fixture.runs.push(run)
    vi.mocked(streamCoachRun).mockImplementation(async (_getToken, _runId, _signal, onSnapshot) => { await onSnapshot?.({ ...run, partialExplanation: 'nuevo parcial' } as never); return { ...run, status: 'completed', partialExplanation: 'respuesta final' } as never })
    render(<MemoryRouter><CoachPage /></MemoryRouter>)
    await waitFor(() => expect(streamCoachRun).toHaveBeenCalledWith(expect.any(Function), 'run-stream', expect.any(AbortSignal), expect.any(Function)))
    expect(startCoachRun).not.toHaveBeenCalled()
  })

  it('pausa el polling con la página oculta y limita la consulta de runs a la conversación', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    const interval = vi.spyOn(window, 'setInterval')
    render(<MemoryRouter><CoachPage /></MemoryRouter>)
    expect(interval).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(interval).toHaveBeenCalledWith(expect.any(Function), 2_000))
    interval.mockRestore()
  })
})
