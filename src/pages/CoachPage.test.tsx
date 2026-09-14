import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoachRunRecord } from '../db/types'
import { db } from '../db/db'
import { useBottomDock } from '../components/BottomDock'
import { cancelCoachRun, startCoachRun } from '../lib/coachClient'
import CoachPage from './CoachPage'

vi.mock('@clerk/react', () => ({ useAuth: () => ({ getToken: vi.fn(), isSignedIn: true }) }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }))
vi.mock('../components/BottomDock', () => ({ useBottomDock: vi.fn() }))
vi.mock('../data/exercises', () => ({ useCatalog: () => ({ byId: new Map() }) }))
vi.mock('../db/db', () => ({
  db: {
    routines: { toArray: vi.fn().mockResolvedValue([]) },
    coachRuns: {
      get: vi.fn(),
      where: vi.fn(() => ({ equals: () => ({ reverse: () => ({ sortBy: async () => [] }) }) })),
    },
  },
}))
vi.mock('../lib/coachAccount', () => ({ getCoachAccountId: () => 'owner-1' }))
vi.mock('../lib/coachConsent', () => ({ getCoachConsent: () => ({ enabled: true }) }))
vi.mock('../lib/coachClient', () => ({
  applyCoachChangeSet: vi.fn(),
  cancelCoachRun: vi.fn(),
  isRecoverableCoachError: vi.fn(() => false),
  isRetryableCoachError: vi.fn(() => false),
  refreshCoachRun: vi.fn(),
  retryCoachRun: vi.fn(),
  startCoachRun: vi.fn(),
}))

describe('CoachPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const target = document.createElement('div')
    document.body.append(target)
    vi.mocked(useBottomDock).mockReturnValue({ coachPortalTarget: target } as ReturnType<typeof useBottomDock>)
  })

  it('conserva un segundo borrador si la respuesta del envío anterior llega después', async () => {
    const user = userEvent.setup()
    let resolveRun!: (run: CoachRunRecord) => void
    vi.mocked(startCoachRun).mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve }))
    render(<MemoryRouter><CoachPage /></MemoryRouter>)
    const editor = await screen.findByRole('textbox', { name: 'Mensaje para el coach' })

    await user.type(editor, 'primer mensaje')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(startCoachRun).toHaveBeenCalledWith(expect.any(Function), 'primer mensaje', { causedByEventId: undefined })

    await user.clear(editor)
    await user.type(editor, 'segundo borrador')
    await act(async () => resolveRun({
      id: 'run-1',
      ownerId: 'owner-1',
      eventId: 'event-1',
      contextVersion: 'context-1',
      status: 'completed',
      request: { event: { payload: { message: 'primer mensaje' } } },
      createdAt: 1,
      updatedAt: 1,
    } as unknown as CoachRunRecord))

    expect(editor).toHaveValue('segundo borrador')
  })

  it('muestra exactamente Cancelación pendiente mientras la cancelación no está reconciliada', async () => {
    const pending = {
      id: 'run-pending', ownerId: 'owner-1', eventId: 'event-pending', contextVersion: 'ctx', status: 'queued', error: 'cancellation-pending',
      request: { event: { payload: { message: 'Cancelar esta consulta' } } }, createdAt: 1, updatedAt: 2,
    } as unknown as CoachRunRecord
    vi.mocked(db.coachRuns.where).mockReturnValue({ equals: () => ({ reverse: () => ({ sortBy: vi.fn().mockResolvedValue([pending]) }) }) } as never)
    render(<MemoryRouter><CoachPage /></MemoryRouter>)
    expect(await screen.findByText('Cancelación pendiente')).toBeInTheDocument()
  })

  it('ofrece reintentar la cancelación y muestra su diagnóstico si falla', async () => {
    const user = userEvent.setup()
    const pending = {
      id: 'run-cancel-error', ownerId: 'owner-1', eventId: 'event-cancel-error', contextVersion: 'ctx', status: 'running', error: 'cancellation-pending',
      cancelRequestedAt: 3, lastError: 'provider-rate-limited', remoteRunId: 'remote-cancel-error',
      request: { event: { payload: { message: 'Cancelar esta consulta' } } }, createdAt: 1, updatedAt: 2,
    } as unknown as CoachRunRecord
    vi.mocked(db.coachRuns.where).mockReturnValue({ equals: () => ({ reverse: () => ({ sortBy: vi.fn().mockResolvedValue([pending]) }) }) } as never)
    vi.mocked(db.coachRuns.get).mockResolvedValue(pending)
    vi.mocked(cancelCoachRun).mockRejectedValueOnce(new Error('provider-rate-limited'))
    render(<MemoryRouter><CoachPage /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Reintentar cancelación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El proveedor limitó temporalmente la consulta')
  })

  it('conserva el borrador si fue editado y volvió al mismo texto durante el envío', async () => {
    const user = userEvent.setup()
    let resolveRun!: (run: CoachRunRecord) => void
    vi.mocked(startCoachRun).mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve }))
    render(<MemoryRouter><CoachPage /></MemoryRouter>)
    const editor = await screen.findByRole('textbox', { name: 'Mensaje para el coach' })

    await user.type(editor, 'mismo mensaje')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await user.clear(editor)
    await user.type(editor, 'texto intermedio')
    await user.clear(editor)
    await user.type(editor, 'mismo mensaje')
    await act(async () => resolveRun({
      id: 'run-aba',
      ownerId: 'owner-1',
      eventId: 'event-aba',
      contextVersion: 'context-1',
      status: 'completed',
      request: { event: { payload: { message: 'mismo mensaje' } } },
      createdAt: 1,
      updatedAt: 1,
    } as unknown as CoachRunRecord))

    expect(editor).toHaveValue('mismo mensaje')
  })
})
