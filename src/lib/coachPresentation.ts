import { agentDecisionSchema } from '../../packages/adaptation-core/src/contract'
import type { CoachRunRecord } from '../db/types'

export function isRenderableCoachProposal(run: CoachRunRecord): boolean {
  return run.status === 'completed' && run.reconciliationState !== 'pending' && run.reconciliationState !== 'uncertain' && run.decision?.kind === 'propose' && agentDecisionSchema.safeParse(run.decision).success
}
