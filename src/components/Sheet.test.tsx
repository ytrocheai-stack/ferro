import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet'

describe('Sheet', () => {
  it('enfoca el título, contiene Tab y devuelve el foco al disparador', async () => {
    const onClose = vi.fn()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    function Harness() {
      const [open, setOpen] = useState(false)
      return <div><button type="button" onClick={() => setOpen(true)}>Abrir</button><Sheet open={open} onClose={() => { onClose(); setOpen(false) }} title="Opciones"><button type="button">Acción</button></Sheet></div>
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Abrir' })
    trigger.focus()
    fireEvent.click(trigger)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Opciones' })).toHaveFocus())
    expect(document.body.style.overflow).toBe('hidden')
    const action = screen.getByRole('button', { name: 'Acción' })
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(action).toHaveFocus()
    screen.getByRole('heading', { name: 'Opciones' }).focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
    action.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Opciones' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus())
    expect(document.body.style.overflow).toBe('')
    scrollTo.mockRestore()
  })

  it('reabrir durante la salida cancela el desmontaje pendiente', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const close = vi.fn()
    const { rerender } = render(<Sheet open onClose={close} title="Reabrir"><button>Acción</button></Sheet>)
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'open'))
    rerender(<Sheet open={false} onClose={close} title="Reabrir"><button>Acción</button></Sheet>)
    expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'exiting')
    rerender(<Sheet open onClose={close} title="Reabrir"><button>Acción</button></Sheet>)
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'open'))
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    expect(screen.getByRole('dialog', { name: 'Reabrir' })).toBeVisible()
    expect(document.body.style.overflow).toBe('hidden')
    scrollTo.mockRestore()
  })

  it('solo deja cerrar el panel superior y mantiene el scroll bloqueado en paneles anidados', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const firstClose = vi.fn()
    const secondClose = vi.fn()
    const { unmount } = render(
      <>
        <Sheet open onClose={firstClose} title="Primero"><button type="button">Primera acción</button></Sheet>
        <Sheet open onClose={secondClose} title="Segundo"><button type="button">Segunda acción</button></Sheet>
      </>,
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Segundo' })).toHaveFocus())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(secondClose).toHaveBeenCalledTimes(1)
    expect(firstClose).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    scrollTo.mockRestore()
  })
})
