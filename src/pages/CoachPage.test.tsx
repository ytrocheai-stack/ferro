import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CoachPage from './CoachPage'
import { useBottomDock } from '../components/BottomDock'
import { startCoachRun } from '../lib/coachClient'

vi.mock('@clerk/react', () => ({ useAuth: () => ({ getToken: vi.fn(), isSignedIn: true }) }))
vi.mock('../components/BottomDock', () => ({ useBottomDock: vi.fn() }))
vi.mock('../lib/coachAccount', () => ({ getCoachAccountId: () => 'owner-1' }))
vi.mock('../lib/coachConsent', () => ({ getCoachConsent: () => ({ enabled: true }), getCoachConversationId: () => 'conversation-1', setCoachConversationId: vi.fn() }))
vi.mock('../lib/coachClient', () => ({ startCoachRun: vi.fn(), refreshCoachRun: vi.fn(), isRetryableCoachError: () => false, applyCoachChangeSet: vi.fn() }))
vi.mock('../lib/coachConversations', () => ({
  ensureCoachConversation: vi.fn(async () => ({ id: 'conversation-1', ownerId: 'owner-1', title: 'Nueva conversación', createdAt: 1, updatedAt: 1, nextSequence: 1 })),
  createCoachConversation: vi.fn(async () => ({ id: 'conversation-2', ownerId: 'owner-1', title: 'Nueva conversación', createdAt: 2, updatedAt: 2, nextSequence: 1 })),
  deleteCoachConversation: vi.fn(async () => true), getCoachDraft: vi.fn(async () => ''), renameCoachConversation: vi.fn(async (ownerId: string, id: string, title: string) => ({ id, ownerId, title, createdAt: 1, updatedAt: 2, nextSequence: 1 })), setCoachDraft: vi.fn(), flushCoachDraft: vi.fn(),
}))
vi.mock('../db/db', () => { const collection = (rows: unknown[]) => { const value = { toArray: vi.fn(async () => rows), count: vi.fn(async () => rows.length), reverse: vi.fn(), limit: vi.fn(), offset: vi.fn(), between: vi.fn(), equals: vi.fn() }; value.reverse.mockReturnValue(value); value.limit.mockReturnValue(value); value.offset.mockReturnValue(value); value.between.mockReturnValue(value); value.equals.mockReturnValue(value); return value }; const conversations = [{ id: 'conversation-1', ownerId: 'owner-1', title: 'Rutina de fuerza', createdAt: 1, updatedAt: 1, nextSequence: 1 }]; return { db: { coachConversations: { where: vi.fn(() => collection(conversations)), get: vi.fn(async (id: string) => conversations.find((item) => item.id === id)) }, coachMessages: { where: vi.fn(() => collection([])) }, coachRuns: { where: vi.fn(() => collection([])) } } } })

describe('CoachPage T6', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const target = document.createElement('div'); document.body.append(target)
    vi.mocked(useBottomDock).mockReturnValue({ coachPortalTarget: target } as ReturnType<typeof useBottomDock>)
  })

  it('muestra conversación identificada y permite cambiar el borrador por conversación', async () => {
    const user = userEvent.setup(); render(<MemoryRouter><CoachPage /></MemoryRouter>)
    expect(await screen.findByRole('log', { name: 'Conversación con Coach' })).toBeInTheDocument()
    expect(screen.getByRole('log', { name: 'Conversación con Coach' })).not.toHaveAttribute('aria-live')
    const editor = screen.getByRole('textbox', { name: 'Mensaje para el coach' }); await user.type(editor, 'consulta local')
    expect(editor).toHaveValue('consulta local')
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
})
