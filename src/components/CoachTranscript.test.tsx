import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CoachMessage, CoachRunRecord } from '../db/types'
import { CoachTranscript } from './CoachTranscript'

const decision = {
  kind: 'propose' as const,
  explanation: 'Aumentar una serie.', observations: [], evidence: [],
  changeSet: {
    id: 'changeset-1', accountId: 'owner-1', eventId: 'event-1', domain: 'training' as const, expectedContextVersion: 'ctx',
    explanation: 'Aumentar una serie.', observations: [], evidence: [], createdAt: 1, policyVersion: 'v1',
    operations: [{ kind: 'routine' as const, operationId: 'op-1', expectedRevision: 1, routineId: 'routine-1', occurrenceId: 'occ-1', patch: { plannedSets: 4 } }],
  },
}
const message: CoachMessage = { id: 'message-1', ownerId: 'owner-1', runId: 'run-1', conversationId: 'conversation-1', sequence: 1, role: 'assistant', content: 'Respuesta parcial', createdAt: 1, contextVersion: 'ctx' }
const baseRun = { id: 'run-1', ownerId: 'owner-1', conversationId: 'conversation-1', eventId: 'event-1', contextVersion: 'ctx', request: { event: { payload: { message: 'Ajusta' } } }, createdAt: 1, updatedAt: 2, decision } as unknown as CoachRunRecord

describe('CoachTranscript', () => {
  it('no etiqueta una decisión parcial o incierta como propuesta aplicable', () => {
    const { rerender } = render(<CoachTranscript conversationId="conversation-1" messages={[message]} runs={[{ ...baseRun, status: 'running' }]} onLoadOlder={() => undefined} hasOlder={false} loadingOlder={false} />)
    expect(screen.queryByText('Propuesta validada')).not.toBeInTheDocument()
    rerender(<CoachTranscript conversationId="conversation-1" messages={[message]} runs={[{ ...baseRun, status: 'completed', reconciliationState: 'uncertain' }]} onLoadOlder={() => undefined} hasOlder={false} loadingOlder={false} />)
    expect(screen.queryByText('Propuesta validada')).not.toBeInTheDocument()
    rerender(<CoachTranscript conversationId="conversation-1" messages={[message]} runs={[{ ...baseRun, status: 'completed' }]} onLoadOlder={() => undefined} hasOlder={false} loadingOlder={false} />)
    expect(screen.queryByText('Propuesta validada')).not.toBeInTheDocument()
    rerender(<CoachTranscript conversationId="conversation-1" messages={[message]} runs={[{ ...baseRun, status: 'completed', reconciliationState: 'reconciled' }]} onLoadOlder={() => undefined} hasOlder={false} loadingOlder={false} />)
    expect(screen.getByText('Propuesta validada')).toBeInTheDocument()
  })
})
