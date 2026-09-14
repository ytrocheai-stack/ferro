import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CoachComposer } from './CoachComposer'

describe('CoachComposer', () => {
  it('inserta texto en el cursor sin reemplazar el nodo del editor', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [message, setMessage] = useState('hola mundo')
      return <CoachComposer message={message} sendDisabled={false} followUp={false} onChange={setMessage} onSend={vi.fn()} />
    }

    render(<Harness />)
    const editor = screen.getByRole('textbox', { name: 'Mensaje para el coach' }) as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(4, 4)

    await user.keyboard('XYZ')

    expect(editor).toHaveValue('holaXYZ mundo')
    expect(editor.selectionStart).toBe(7)
    expect(screen.getByRole('textbox', { name: 'Mensaje para el coach' })).toBe(editor)
  })

  it('envía con Enter y deja Shift+Enter para insertar un salto', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()

    function Harness() {
      const [message, setMessage] = useState('hola')
      return <CoachComposer message={message} sendDisabled={false} followUp={false} onChange={setMessage} onSend={onSend} />
    }

    render(<Harness />)
    const editor = screen.getByRole('textbox', { name: 'Mensaje para el coach' }) as HTMLTextAreaElement
    await user.click(editor)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(editor).toHaveValue('hola\n')
    expect(onSend).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(editor).toHaveValue('hola\n')
    expect(editor).toHaveFocus()
  })

  it('no envía Enter mientras el estado local de composición está activo', () => {
    const onSend = vi.fn()
    render(<CoachComposer message="texto" sendDisabled={false} followUp={false} onChange={vi.fn()} onSend={onSend} />)
    const editor = screen.getByRole('textbox', { name: 'Mensaje para el coach' })

    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: false })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.compositionEnd(editor)
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('no envía Enter cuando nativeEvent.isComposing está activo sin estado local', () => {
    const onSend = vi.fn()
    render(<CoachComposer message="texto" sendDisabled={false} followUp={false} onChange={vi.fn()} onSend={onSend} />)
    const editor = screen.getByRole('textbox', { name: 'Mensaje para el coach' })

    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(editor, { key: 'Enter', isComposing: false })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('no envía Enter con keyCode 229 sin composición local ni nativa', () => {
    const onSend = vi.fn()
    render(<CoachComposer message="texto" sendDisabled={false} followUp={false} onChange={vi.fn()} onSend={onSend} />)
    const editor = screen.getByRole('textbox', { name: 'Mensaje para el coach' })

    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229, isComposing: false })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 13, isComposing: false })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('permite editar durante una respuesta aunque bloquea el envío', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [message, setMessage] = useState('borrador')
      return <CoachComposer message={message} sendDisabled busy followUp={false} onChange={setMessage} onSend={vi.fn()} />
    }

    render(<Harness />)
    const editor = screen.getByRole('textbox', { name: 'Mensaje para el coach' })
    await user.click(editor)
    await user.keyboard(' nuevo')

    expect(editor).toHaveValue('borrador nuevo')
    expect(editor).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled()
  })

  it('conserva el foco al enviar desde el botón sin robarlo desde otro control', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<><button type="button">Otro control</button><CoachComposer message="listo" sendDisabled={false} followUp={false} onChange={vi.fn()} onSend={onSend} /></>)
    const editor = screen.getByRole('textbox', { name: 'Mensaje para el coach' })
    const send = screen.getByRole('button', { name: 'Enviar' })
    const other = screen.getByRole('button', { name: 'Otro control' })

    await user.click(editor)
    await user.click(send)
    expect(editor).toHaveFocus()

    await user.click(other)
    fireEvent.click(send)
    expect(other).toHaveFocus()
  })
})
