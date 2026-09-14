import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MuscleHeatmap } from './MuscleHeatmap'

 describe('MuscleHeatmap', () => {
  it('muestra frecuencia y series por separado al seleccionar una zona', () => {
    render(<MuscleHeatmap frequency={{ chest: 2 }} counts={{ chest: 12 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pecho: 2 días, 12 series' }))
    expect(screen.getByRole('status')).toHaveTextContent('Pecho · 2 días · 12 series')
    expect(screen.getByRole('button', { name: 'Pecho: 2 días, 12 series' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('sincroniza el toque de una región SVG con el botón y ambas vistas', () => {
    const { container } = render(<MuscleHeatmap frequency={{ shoulders: 2 }} counts={{ shoulders: 4 }} />)
    const region = container.querySelector('[data-muscle-region="shoulders"]')
    expect(region).not.toBeNull()

    fireEvent.click(region!)

    expect(screen.getByRole('status')).toHaveTextContent('Hombros · 2 días · 4 series')
    expect(screen.getByRole('button', { name: 'Hombros: 2 días, 4 series' })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelectorAll('[data-muscle-selection="shoulders"]')).toHaveLength(2)
  })
  it('deja neutras las zonas no entrenadas y actualiza ambos lados al cambiar los datos', () => {
    const { container, rerender } = render(<MuscleHeatmap frequency={{ calves: 1 }} counts={{ calves: 3 }} />)
    const overlays = () => Array.from(container.querySelectorAll('[data-muscle="calves"]'))
    expect(overlays()).toHaveLength(2)
    const original = Number(overlays()[0].getAttribute('opacity'))
    rerender(<MuscleHeatmap frequency={{ calves: 4 }} counts={{ calves: 9 }} />)
    expect(Number(overlays()[0].getAttribute('opacity'))).toBeGreaterThan(original)
    expect(overlays()[0].getAttribute('opacity')).toBe(overlays()[1].getAttribute('opacity'))
    expect(container.querySelector('[data-muscle="chest"]')).toHaveAttribute('opacity', '0')
  })
  it('ofrece los once grupos mediante botones, incluso sin actividad', () => {
    render(<MuscleHeatmap frequency={{}} counts={{}} />)
    expect(screen.getAllByRole('button')).toHaveLength(11)
    expect(screen.getByText('Sin actividad registrada en estos siete días.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Espalda: 0 días, 0 series' }))
    expect(screen.getByRole('status')).toHaveTextContent('Espalda · 0 días · 0 series')
  })
  it('genera máscaras sin identificadores duplicados al montar varias instancias', () => {
    const { container } = render(<><MuscleHeatmap frequency={{}} counts={{}} /><MuscleHeatmap frequency={{}} counts={{}} /></>)
    const ids = Array.from(container.querySelectorAll('mask')).map(el => el.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('mantiene los botones y ofrece un fallback textual si falla una imagen', () => {
    const { container } = render(<MuscleHeatmap frequency={{}} counts={{}} />)
    fireEvent.error(container.querySelector('image')!)
    expect(screen.getByText('El mapa no está disponible. Puedes consultar cada grupo abajo.')).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(11)
  })
})
