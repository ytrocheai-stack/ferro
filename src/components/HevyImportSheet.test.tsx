import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HevyImportSheet } from './HevyImportSheet'

describe('HevyImportSheet', () => {
  it('explica cómo exportar desde Hevy y enlaza la guía oficial antes de pedir el archivo', () => {
    render(<HevyImportSheet open onClose={vi.fn()} onImported={vi.fn()} />)

    expect(screen.getByText(/Perfil.*Ajustes.*Exportar e importar datos/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /guía oficial de Hevy/i })).toHaveAttribute(
      'href',
      'https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy',
    )
  })
})
