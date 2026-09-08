import { changeSetSchema } from '../../adaptation-core/src/contract.ts'
import type { AgentTrace, LabConfig, LabCorpus, LabDecision, LabInput, LabRun, ModelBudget } from './types.ts'
import { INSTRUCTION_VERSION, LAB_VERSION, MODEL_CONFIG_VERSION, TOOL_VERSION } from './types.ts'
import { runResearchAgent, runTrainingAgent } from './agents.ts'
import { validateLabInput, decisionViolations, safetyReason } from './validation.ts'
import { fingerprint } from './identity.ts'
export { validateLabInput } from './validation.ts'

const DEFAULT_BUDGET: ModelBudget = { provider: 'flash', maxCalls: 2, maxInputTokens: 8_000, maxOutputTokens: 2_000, timeoutMs: 12_000 }

function budgetFor(config: LabConfig): ModelBudget {
  return { ...DEFAULT_BUDGET, ...config.budget, provider: 'flash' }
}

function unavailable(_input: LabInput, reason: string): LabDecision {
  const trace: AgentTrace = { agent: 'orchestrator', status: 'blocked', observations: [{ text: reason, kind: 'limitation', source: 'execution' }], evidence: [], durationMs: 0 }
  return { kind: 'unavailable', explanation: reason, reason, observations: trace.observations, evidence: [], trace: [trace], executionMode: 'provider', qualityEvidence: false }
}

function askForUnsupportedEvent(): LabDecision {
  const trace: AgentTrace = { agent: 'orchestrator', status: 'completed', observations: [{ text: 'El evento no activa todavía un especialista de la primera entrega.', kind: 'limitation', source: 'scope' }], evidence: [], durationMs: 0 }
  return { kind: 'ask', explanation: 'Este laboratorio inicial reacciona a session-finished; los demás eventos tienen rutas reservadas.', questions: ['¿Quieres evaluar una sesión terminada?'], observations: trace.observations, evidence: [], trace: [trace], executionMode: 'simulated', qualityEvidence: false }
}

function safeAbstention(reason: string, executionMode: 'simulated' | 'provider'): LabDecision {
  const trace: AgentTrace = { agent: 'orchestrator', status: 'blocked', observations: [{ text: `Solicitud bloqueada por seguridad: ${reason}.`, kind: 'limitation', source: 'security' }], evidence: [], durationMs: 0 }
  return { kind: 'abstain', explanation: 'No puedo ejecutar ni respaldar esa solicitud.', reason: `safety-${reason}`, observations: trace.observations, evidence: [], trace: [trace], executionMode, qualityEvidence: false }
}

export function runOrchestrator(input: LabInput, corpus: LabCorpus, config: LabConfig = {}): LabDecision {
  validateLabInput(input)
  const budget = budgetFor(config)
  if (config.mode === 'provider') return unavailable(input, 'La API síncrona solo simula. Usa runProviderLab con adaptador Flash y presupuesto comprobado.')
  if (input.permissions.accountId !== input.event.accountId) return unavailable(input, 'La cuenta del evento no coincide con la cuenta ficticia autorizada.')
  if (input.permissions.consentVersion !== input.event.contextVersion) return unavailable(input, 'El consentimiento simulado no coincide con la versión del contexto.')
  const unsafeReason = safetyReason(input)
  if (unsafeReason) return safeAbstention(unsafeReason, 'simulated')
  if (input.event.type !== 'session-finished') return askForUnsupportedEvent()
  const training = runTrainingAgent(input, budget)
  if (training.kind !== 'propose') return training
  const researchQuery = `${training.explanation} ${input.profile.goals.join(' ')}`
  const research = runResearchAgent(input, corpus, researchQuery)
  const trace = [...training.trace, research]
  const evidence = research.evidence
  const changeSet = changeSetSchema.parse({ ...training.changeSet, evidence: evidence.map((item) => ({ claim: item.claim, sourceId: item.sourceId, location: item.location, ...(item.excerpt ? { excerpt: item.excerpt } : {}) })) })
  const result = { ...training, changeSet, evidence, trace }
  const violations = decisionViolations(input, result, corpus)
  return violations.length ? { ...unavailable(input, violations.join('; ')), kind: 'abstain', reason: 'invalid-proposal', executionMode: 'simulated' } : result
}

export function runLabContinuation(input: LabInput, corpus: LabCorpus, continuation: Partial<Pick<LabInput, 'history' | 'plan' | 'restrictions' | 'catalog'>>, config: LabConfig = {}): LabRun {
  return runLab({ ...input, ...continuation }, corpus, config)
}

export function runLab(input: LabInput, corpus: LabCorpus, config: LabConfig = {}): LabRun {
  const resolved = {
    labVersion: config.labVersion ?? LAB_VERSION,
    instructionVersion: config.instructionVersion ?? INSTRUCTION_VERSION,
    toolVersion: config.toolVersion ?? TOOL_VERSION,
    modelConfigVersion: config.modelConfigVersion ?? MODEL_CONFIG_VERSION,
  }
  validateLabInput(input)
  const serializedContext = JSON.stringify({ input, corpusVersion: corpus.version })
  const overInput = Math.ceil(serializedContext.length / 4) > (config.budget?.maxInputTokens ?? DEFAULT_BUDGET.maxInputTokens)
  const decision = overInput ? unavailable(input, 'Presupuesto de entrada agotado antes de decidir.') : runOrchestrator(input, corpus, config)
  const serializedInput = JSON.stringify({ input, evidence: decision.evidence, corpusVersion: corpus.version })
  const serializedOutput = JSON.stringify(decision)
  const maxInput = config.budget?.maxInputTokens ?? DEFAULT_BUDGET.maxInputTokens
  const maxOutput = config.budget?.maxOutputTokens ?? DEFAULT_BUDGET.maxOutputTokens
  const inputTokens = Math.ceil(serializedInput.length / 4)
  const outputTokens = Math.ceil(serializedOutput.length / 4)
  const budgetExceeded = inputTokens > maxInput || outputTokens > maxOutput
  const finalDecision = budgetExceeded
    ? unavailable(input, `El presupuesto simulado fue excedido (${inputTokens}/${maxInput} tokens de entrada, ${outputTokens}/${maxOutput} de salida).`)
    : decision
  return { ...resolved, scenarioId: input.event.id, decision: { ...finalDecision, executionMode: config.mode ?? 'simulated' }, calls: 0, uncertainCalls: 0, fingerprint: fingerprint({ input, corpus, config, resolved }), tokenEstimate: { input: inputTokens, output: outputTokens } }
}

export { DEFAULT_BUDGET }
