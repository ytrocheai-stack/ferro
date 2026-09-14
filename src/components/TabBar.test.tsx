import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TabBar } from './TabBar'

describe('TabBar', () => {
  it('expone una navegación principal identificable y conserva el destino activo', () => {
    render(
      <MemoryRouter initialEntries={['/nutricion']}>
        <TabBar />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeInTheDocument()
    const labels = screen.getAllByRole('link').map((link) => link.textContent)
    expect(labels).toEqual(['Entrenar', 'Nutrición', 'Coach', 'Progreso', 'Biblioteca'])
    expect(screen.getByRole('link', { name: 'Nutrición' })).toHaveAttribute('aria-current', 'page')
  })

  it('mantiene Progreso activo en sus pantallas secundarias', () => {
    render(
      <MemoryRouter initialEntries={['/analisis']}>
        <TabBar />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Progreso' })).toHaveAttribute('aria-current', 'page')
  })
})
