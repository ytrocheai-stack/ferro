import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MuscleHeatmap } from './MuscleHeatmap'

describe('MuscleHeatmap', () => {
  it('colorea tres series como poco aunque sea el máximo relativo de la semana', () => {
    render(<MuscleHeatmap counts={{ chest: 3, abs: 3 }} />)

    const pathFor = (label: string) => Array.from(document.querySelectorAll('title')).find((node) => node.textContent === label)?.parentElement
    const chest = pathFor('Pecho: 3 series/semana')
    const abs = pathFor('Abdominales: 3 series/semana')

    expect(chest).toHaveAttribute('fill', 'var(--color-primary-strong)')
    expect(abs).toHaveAttribute('fill', 'var(--color-primary-strong)')
  })
})
