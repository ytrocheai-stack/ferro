import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachPage from './CoachPage'
import { db } from '../db/db'
import type { CoachRunRecord } from '../db/types'

const ids = vi.hoisted(() => ({
  accountId: 'owner-transport-integration',
  conversationOne: 'conversation-transport-one',
  conversationTwo: 'conversation-transport-two',
  runId: 'run-transport-404',
  remoteRunId: 'remote-transport-404',
}))
const { accountId, conversationOne, conversationTwo, runId, remoteRunId } = ids

vi.mock('@clerk/react', () => ({ useAuth: () => ({ getToken: vi.fn(async () => 'token'), isSignedIn: true }) }))
vi.mock('../components/BottomDock', () => ({ useBottomDock: () => ({ coachPortalTarget: document.body }) }))
vi.mock('../lib/coachAccount', () => ({ getCoachAccountId: () => ids.accountId, setCoachAccountId: vi.fn() }))
vi.mock('../lib/coachConsent', () => ({ getCoachConsent: () => ({ enabled: true }), getCoachConversationId: () => ids.conversationOne, setCoachConversationId: vi.fn() }))

describe('CoachPage transporte durable', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_ADAPTATION_WORKER_URL', 'https://coach.example')
    vi.stubEnv('VITE_ENABLE_COACH_STREAMING', 'true')
    await db.coachConversations.bulkPut([
      { id: conversationOne, ownerId: accountId, title: 'Rutina de fuerza', createdAt: 1, updatedAt: 2, nextSequence: 1 },
      { id: conversationTwo, ownerId: accountId, title: 'Movilidad', createdAt: 1, updatedAt: 1, nextSequence: 1 },
    ])
    await db.coachRuns.put({
      id: runId, remoteRunId, ownerId: accountId, conversationId: conversationOne, eventId: 'event-transport-404',
      contextVersion: 'ctx-transport', status: 'running', transport: 'sse', request: {} as CoachRunRecord['request'], createdAt: 1, updatedAt: 2,
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  afterEach(async () => {
    cleanup()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await db.coachRuns.clear()
    await db.coachMessages.clear()
    await db.coachConversations.clear()
    await db.coachDrafts.clear()
    await db.coachConsents.clear()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('mantiene 404 SSE en polling al cambiar de chat y volver visible, sin segunda SSE', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/events')) return new Response('', { status: 404 })
      if (url.endsWith(`/v1/coach/runs/${remoteRunId}`)) {
        return new Response(JSON.stringify({ run: { id: remoteRunId, eventId: 'event-transport-404', accountId, contextVersion: 'ctx-transport', specialists: ['orchestrator'], status: 'running' } }), { status: 200 })
      }
      throw new Error(`URL inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'setInterval').mockImplementation(() => 1 as unknown as ReturnType<typeof window.setInterval>)
    const user = userEvent.setup()
    render(<MemoryRouter><CoachPage /></MemoryRouter>)

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/events'))).toBe(true), { timeout: 5000 })
    await waitFor(async () => expect(await db.coachRuns.get(runId)).toMatchObject({ transport: 'polling' }), { timeout: 5000 })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/events'))).toHaveLength(1)

    await user.click(await screen.findByRole('button', { name: 'Movilidad' }))
    await user.click(await screen.findByRole('button', { name: 'Rutina de fuerza' }))
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/v1/coach/runs/${remoteRunId}`))).toBe(true), { timeout: 5000 })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/events'))).toHaveLength(1)
  })
})
