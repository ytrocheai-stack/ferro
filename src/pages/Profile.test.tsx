import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AccountDiagnostic, CoachProfileCard } from './Profile'
import { saveCoachProfile } from '../lib/coachConsent'

const authMock = vi.hoisted(() => ({ isSignedIn: true, userId: 'test-owner', getToken: vi.fn(async () => 'test-jwt-secret') }))
vi.mock('@clerk/react', () => ({ useAuth: () => authMock }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => undefined }))
vi.mock('../lib/coachConsent', async (original) => ({
  ...await original<typeof import('../lib/coachConsent')>(),
  saveCoachProfile: vi.fn(),
}))

describe('guardar contexto del coach', () => {
  it('conserva el formulario tras un fallo y permite guardar de nuevo sin duplicar envíos', async () => {
    vi.stubEnv('VITE_ADAPTATION_WORKER_URL', 'https://coach.example')
    try {
      let rejectSave!: (reason: Error) => void
      vi.mocked(saveCoachProfile).mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject }))
      render(<CoachProfileCard />)
      fireEvent.change(screen.getByLabelText('Objetivos'), { target: { value: 'fuerza' } })
      fireEvent.click(screen.getByRole('button', { name: 'Guardar contexto del coach' }))
      const pending = screen.getByRole('button', { name: 'Guardando…' })
      expect(pending).toBeDisabled()
      fireEvent.click(pending)
      expect(saveCoachProfile).toHaveBeenCalledTimes(1)
      await act(async () => rejectSave(new Error('IndexedDB failure')))
      expect(screen.getByRole('alert')).toHaveTextContent('Tus cambios siguen en el formulario')
      expect(screen.getByLabelText('Objetivos')).toHaveValue('fuerza')
      vi.mocked(saveCoachProfile).mockResolvedValueOnce({} as Awaited<ReturnType<typeof saveCoachProfile>>)
      fireEvent.click(screen.getByRole('button', { name: 'Guardar contexto del coach' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Contexto guardado')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(saveCoachProfile).toHaveBeenLastCalledWith(expect.objectContaining({ ownerId: 'test-owner', goals: ['fuerza'] }))
    } finally { vi.unstubAllEnvs() }
  })
})

describe('diagnóstico de cuenta', () => {
  it('consulta readiness solo al solicitarlo y muestra el estado seguro aunque beta esté cerrada', async () => {
    vi.stubEnv('VITE_ADAPTATION_WORKER_URL', 'https://coach.example/')
    const request = vi.fn().mockResolvedValue({
      status: 503,
      json: async () => ({
        ok: false,
        checks: { d1: true, index: true, productionConfig: false },
        configuration: {
          providerOrder: ['gemini'],
          models: { gemini: 'gemini-test-model' },
          flags: { beta: false },
          allowlist: { count: 1, userIds: ['private-user-id'] },
        },
      }),
    } as Response)
    vi.stubGlobal('fetch', request)

    try {
      render(<AccountDiagnostic />)
      fireEvent.click(screen.getByText('Diagnóstico de cuenta'))
      expect(request).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Comprobar backend' }))

      const status = await screen.findByRole('status')
      expect(status).toHaveTextContent('HTTP 503')
      expect(status).toHaveTextContent('Beta: No')
      expect(status).toHaveTextContent('gemini (gemini-test-model)')
      expect(status).toHaveTextContent('Cuentas permitidas: 1')
      expect(status).toHaveTextContent('Configuración de producción: No')
      expect(status).not.toHaveTextContent('private-user-id')
      expect(status).not.toHaveTextContent('test-jwt-secret')
      expect(request).toHaveBeenCalledWith('https://coach.example/readiness', expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer test-jwt-secret', Accept: 'application/json' },
        cache: 'no-store',
      }))
      expect(request.mock.calls[0]?.[1]).not.toHaveProperty('body')
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })

  it('no contacta el backend si la cuenta no tiene sesión de Clerk', async () => {
    vi.stubEnv('VITE_ADAPTATION_WORKER_URL', 'https://coach.example')
    vi.stubGlobal('fetch', vi.fn())
    authMock.isSignedIn = false
    try {
      render(<AccountDiagnostic />)
      fireEvent.click(screen.getByText('Diagnóstico de cuenta'))
      fireEvent.click(screen.getByRole('button', { name: 'Comprobar backend' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Inicia sesión en Clerk')
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      authMock.isSignedIn = true
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })
})
