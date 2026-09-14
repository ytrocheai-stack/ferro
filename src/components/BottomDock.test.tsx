import { useState } from 'react'
import { createPortal } from 'react-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BottomDock, BottomDockProvider, useBottomDock } from './BottomDock'
import { CoachComposer } from './CoachComposer'

describe('BottomDock', () => {
  it('mantiene un destino DOM estable para el compositor del coach', () => {
    const view = render(<BottomDockProvider><BottomDock navigation={<span>Inicio</span>} /></BottomDockProvider>)
    const target = document.getElementById('coach-composer-dock')

    expect(target).toBeInTheDocument()
    expect(target).toHaveClass('empty:hidden')
    view.rerender(<BottomDockProvider><BottomDock navigation={<span>Perfil</span>} /></BottomDockProvider>)
    expect(document.getElementById('coach-composer-dock')).toBe(target)
  })

  it('mantiene el textarea del portal durante una actualización controlada', async () => {
    const user = userEvent.setup()

    function PortalComposer() {
      const [message, setMessage] = useState('hola mundo')
      const { coachPortalTarget } = useBottomDock()
      return coachPortalTarget
        ? createPortal(<CoachComposer message={message} sendDisabled={false} followUp={false} onChange={setMessage} onSend={vi.fn()} />, coachPortalTarget)
        : null
    }

    render(<BottomDockProvider><PortalComposer /><BottomDock /></BottomDockProvider>)
    const editor = await screen.findByRole('textbox', { name: 'Mensaje para el coach' }) as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(4, 4)

    await user.keyboard('XYZ')

    expect(editor).toHaveValue('holaXYZ mundo')
    expect(editor.selectionStart).toBe(7)
    expect(screen.getByRole('textbox', { name: 'Mensaje para el coach' })).toBe(editor)
  })
})
