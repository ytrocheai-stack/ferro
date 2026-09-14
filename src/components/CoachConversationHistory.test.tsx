import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CoachConversationHistory } from './CoachConversationHistory'

const conversation = { id: 'conversation-1', ownerId: 'owner-1', title: 'Fuerza', createdAt: 1, updatedAt: 1, nextSequence: 1 }

describe('CoachConversationHistory', () => {
  it('expone la siguiente página sin reemplazar el historial actual', async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()
    render(<CoachConversationHistory conversations={[conversation]} selectedId={conversation.id} onSelect={vi.fn()} onNew={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onLoadMore={onLoadMore} hasMore loadingMore={false} />)
    await user.click(screen.getByRole('button', { name: 'Cargar más conversaciones' }))
    expect(onLoadMore).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Fuerza' })).toBeInTheDocument()
  })
})
