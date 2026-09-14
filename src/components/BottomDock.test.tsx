import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BottomDock, BottomDockProvider } from './BottomDock'

describe('BottomDock', () => {
  it('mantiene un destino DOM estable para el compositor del coach', () => {
    const view = render(<BottomDockProvider><BottomDock navigation={<span>Inicio</span>} /></BottomDockProvider>)
    const target = document.getElementById('coach-composer-dock')

    expect(target).toBeInTheDocument()
    expect(target).toHaveClass('empty:hidden')
    view.rerender(<BottomDockProvider><BottomDock navigation={<span>Perfil</span>} /></BottomDockProvider>)
    expect(document.getElementById('coach-composer-dock')).toBe(target)
  })
})
