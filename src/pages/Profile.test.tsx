import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CoachProfileCard } from './Profile'
import { saveCoachProfile } from '../lib/coachConsent'

vi.mock('@clerk/react', () => ({ useAuth: () => ({ isSignedIn: true, userId: 'test-owner' }) }))
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
