import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { evaluateBenchmark, validateBenchmark } from '../../corpus-evaluation/src/index.mjs'
import { evaluateAcceptance, continuedScenario } from './evaluation.ts'
import type { DecisionReview, LabEvaluationReport } from './evaluation.ts'
import { runLab } from './orchestrator.ts'
import { runProviderLab, createGeminiLabProvider, PRIVATE_TRAINING_INSTRUCTIONS, TRAINING_INSTRUCTIONS } from './provider.ts'
import { createSemanticSearchEvidence } from './tools.ts'
import { LabJournal } from './journal.ts'
import { fingerprint, stableAuthorizationIdentity } from './identity.ts'
import { planDiff } from './diff.ts'
import { acceptanceScenarios, developmentScenarios, safetyScenarios } from './scenarios.ts'
import { LAB_VERSION, INSTRUCTION_VERSION, TOOL_VERSION, MODEL_CONFIG_VERSION } from './types.ts'
import type { LabCorpus, LabRun, LabScenario } from './types.ts'
import { loadLocalEnv, ProviderSession, readAuthorization, type Authorization } from '../../corpus-pipeline/src/runtime.ts'
import type { EmbeddingMatrix } from '../../corpus-retrieval/src/index.ts'
import { scientificReviewReady } from '../../corpus-evaluation/src/scientific-review.mjs'
import { GEMINI_GENERATION_MODEL, GEMINI_PROJECT_LEDGER_DIRECTORY, readGeminiAuthorization } from '../../corpus-pipeline/src/gemini-session.ts'
import type { GeminiAuthorization } from '../../corpus-pipeline/src/gemini-session.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(3)
function option(name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Falta valor de ${name}`)
  return args[index + 1]
}
async function json(file: string): Promise<unknown> { return JSON.parse(await readFile(path.resolve(file), 'utf8')) }
async function save(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(`${file}.tmp`, file)
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'run'
  const manifest = await json(option('--manifest') ?? path.join(root, 'worker/corpus/manifest.json')) as { corpusVersion: string; status: LabCorpus['status']; sources: LabCorpus['sources']; chunks: LabCorpus['chunks'] }
  const corpus: LabCorpus = { version: manifest.corpusVersion, status: manifest.status, sources: manifest.sources, chunks: manifest.chunks }
  if (command === 'rag') {
    const reference = await json(option('--reference') ?? path.join(root, 'worker/corpus/evaluation-queries.json'))
    validateBenchmark(reference, manifest)
    const resultsPath = option('--results')
    if (!resultsPath) throw new Error('RAG requiere --results con vectores Nemotron 2048, consultas y citas para 512/1024. No se deducen etiquetas desde fuentes.')
    const benchmark = evaluateBenchmark(reference, manifest, await json(resultsPath)) as { baseGate: boolean }
    const safetyPath = option('--safety-report')
    const safety = safetyPath ? await json(safetyPath) as LabEvaluationReport : undefined
    const safetyValid = (safety?.security?.passesGate === true || safety?.safetyPassesGate === true) && safety.corpusFingerprint === fingerprint(corpus) && safetyScenarios.every(s => safety.checkpoint.scenarioIds.includes(s.id))
    const report = { ...benchmark, passesGate: benchmark.baseGate && safetyValid, failures: [...(!benchmark.baseGate ? ['No supera Recall@5 y precisión de citas'] : []), ...(!safetyValid ? ['Falta informe aprobado de las diez entradas de seguridad para este corpus'] : [])] }
    console.log(JSON.stringify(report, null, 2))
    if (!report.passesGate) process.exitCode = 1
    return
  }
  if (!['run', 'evaluate'].includes(command)) throw new Error('Usa run, evaluate o rag')
  const directory = path.resolve(option('--checkpoint') ?? path.join(root, '.cache/agent-lab', `${command}-${LAB_VERSION}`))
  const journal = new LabJournal(directory)
  const useProvider = args.includes('--provider')
  let authorization: GeminiAuthorization | undefined
  let embeddingAuthorization: Authorization | undefined
  if (useProvider) {
    const reference = await json(option('--reference') ?? path.join(root, '.cache/corpus/hevy/reference-final.json')) as { status?: string; corpusVersion?: string; queries?: unknown[]; scientificReview?: Record<string, unknown> }
    if (reference.status !== 'approved' || reference.corpusVersion !== manifest.corpusVersion || reference.queries?.length !== 50 || !scientificReviewReady(reference)) throw new Error('Modo proveedor requiere la aprobación científica completa y vinculada antes de llamar a Gemini')
    const authorizationPath = option('--authorization')
    if (!authorizationPath) throw new Error('Modo proveedor requiere --authorization Gemini fresca, de coste adicional cero y con cuota del proyecto gratuita verificada')
    loadLocalEnv()
    authorization = readGeminiAuthorization(authorizationPath)
    if (authorization.model !== GEMINI_GENERATION_MODEL) throw new Error('El laboratorio requiere gemini-3.5-flash-lite para generar texto')
    const embeddingAuthorizationPath = option('--embedding-authorization')
    if (!embeddingAuthorizationPath) throw new Error('Modo proveedor requiere --embedding-authorization fresca y de coste adicional cero para Nemotron query embeddings')
    embeddingAuthorization = readAuthorization(embeddingAuthorizationPath)
    if (!embeddingAuthorization.allocations?.embeddings) throw new Error('La autorización NVIDIA debe reservar una asignación explícita para embeddings')
    if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Modo proveedor requiere GEMINI_API_KEY configurada localmente; no se hicieron llamadas')
    if (!process.env.NVIDIA_API_KEY?.trim()) throw new Error('Modo proveedor requiere NVIDIA_API_KEY configurada localmente solo para Nemotron query embeddings; no se hicieron llamadas')
  }
  const provider = authorization ? createGeminiLabProvider({ authorization, directory: GEMINI_PROJECT_LEDGER_DIRECTORY, apiKey: process.env.GEMINI_API_KEY }) : undefined
  const embeddingAllocation = embeddingAuthorization?.allocations?.embeddings
  const scopedEmbeddingAuthorization = embeddingAuthorization && embeddingAllocation ? {
    ...embeddingAuthorization,
    maxCalls: Math.min(embeddingAuthorization.maxCalls, embeddingAllocation.calls),
    maxInputTokens: Math.min(embeddingAuthorization.maxInputTokens, embeddingAllocation.inputTokens),
    maxTotalCalls: Math.min(embeddingAuthorization.maxTotalCalls, embeddingAllocation.calls),
    maxTotalInputTokens: Math.min(embeddingAuthorization.maxTotalInputTokens, embeddingAllocation.inputTokens),
    maxTotalOutputTokens: Math.min(embeddingAuthorization.maxTotalOutputTokens, embeddingAllocation.outputTokens),
  } : undefined
  const semanticSession = scopedEmbeddingAuthorization ? new ProviderSession({ apiKey: process.env.NVIDIA_API_KEY ?? '', authorization: scopedEmbeddingAuthorization, directory: path.join(root, '.cache/corpus/hevy/nemotron-query-ledger') }) : undefined
  const semanticSearchEvidence = semanticSession ? createSemanticSearchEvidence(corpus, await json(option('--matrix') ?? path.join(root, '.cache/corpus/hevy/embeddings/matrix-2048.json')) as EmbeddingMatrix, query => semanticSession.embed(query, 'query')) : undefined
  if (useProvider && !semanticSearchEvidence) throw new Error('Modo proveedor requiere recuperación semántica Nemotron y una matriz válida; no se permite fallback léxico')
  const revisions = { LAB_VERSION, INSTRUCTION_VERSION, TOOL_VERSION, MODEL_CONFIG_VERSION, providerTurnOutputLimit: useProvider ? 2_000 : null, instructions: useProvider ? PRIVATE_TRAINING_INSTRUCTIONS : TRAINING_INSTRUCTIONS }
  // Authorization freshness is temporal access control, not result identity.
  // Renewing it must allow a confirmed journal entry to resume unchanged.
  const authorizationIdentity = authorization ? {
    provider: 'google-ai-studio',
    model: authorization.model,
    projectNumber: authorization.projectNumber,
    embeddingModel: authorization.embeddingModel,
    labAllocation: authorization.allocations.lab,
    maxInputTokens: authorization.maxInputTokens,
    maxOutputTokens: authorization.maxOutputTokens,
    maxTotalCalls: authorization.maxTotalCalls,
    maxTotalInputTokens: authorization.maxTotalInputTokens,
    maxTotalOutputTokens: authorization.maxTotalOutputTokens,
    timeoutMs: authorization.timeoutMs,
  } : undefined
  const embeddingAuthorizationIdentity = embeddingAuthorization ? {
    ...stableAuthorizationIdentity(embeddingAuthorization),
    embeddingAllocation: embeddingAuthorization.allocations?.embeddings,
  } : undefined
  const execute = async (scenario: LabScenario, repetition: number): Promise<LabRun> => {
    const key = `${repetition}:${scenario.input.event.accountId}:${scenario.input.event.id}:${scenario.id.endsWith(':continuation') ? 'continuation' : 'initial'}`
    return journal.execute(key, { input: scenario.input, corpus, revisions, authorization: authorizationIdentity, embeddingAuthorization: embeddingAuthorizationIdentity, providerId: useProvider ? GEMINI_GENERATION_MODEL : 'simulated', mode: useProvider ? 'provider' : 'simulated' }, async beforeAttempt => {
      const run = provider && authorization ? await runProviderLab(scenario.input, corpus, provider, {
        providerAvailable: true, budgetVerified: true,
        runKey: key,
        semanticSearchEvidence,
        maxOutputTokensPerCall: Math.min(2_000, authorization.maxOutputTokens, authorization.allocations.lab.outputTokens),
        budget: {
          maxCalls: Math.min(8, authorization.allocations.lab.calls),
          maxInputTokens: Math.min(authorization.maxInputTokens, authorization.allocations.lab.inputTokens),
          maxOutputTokens: Math.min(
            authorization.allocations.lab.outputTokens,
            Math.min(2_000, authorization.maxOutputTokens, authorization.allocations.lab.outputTokens) * Math.min(8, authorization.allocations.lab.calls),
          ),
          timeoutMs: authorization.timeoutMs,
        },
        beforeAttempt: async reservation => {
          // Persist each pre-dispatch estimate for crash recovery. GeminiGenerationSession
          // applies the authoritative per-call, allocation, and project limits using
          // reservations before dispatch and measured usage after the response.
          await beforeAttempt(reservation)
        },
      }) : runLab(scenario.input, corpus)
      run.scenarioId = scenario.id
      run.repetition = repetition
      return run
    })
  }
  if (command === 'run') {
    const selected = args.find(v => !v.startsWith('--'))
    const scenario = selected && !selected.includes('/') && !selected.includes('\\') ? developmentScenarios.find(s => s.id === selected) : developmentScenarios[0]
    if (!scenario) throw new Error('Escenario de desarrollo desconocido')
    const run = await execute(scenario, 0)
    console.log(JSON.stringify({ ...run, diff: planDiff(scenario.input, run.decision) }, null, 2))
    if (run.decision.kind === 'unavailable') process.exitCode = 1
    return
  }
  const scenarios = [...acceptanceScenarios, ...safetyScenarios]
  const cached = new Map<string, LabRun>()
  for (let repetition = 0; repetition < 3; repetition++) for (const scenario of scenarios) {
    const run = await execute(scenario, repetition)
    cached.set(`${repetition}:${scenario.id}`, run)
    if (scenario.repeatEvent) {
      const duplicate = await execute(scenario, repetition)
      if (fingerprint(duplicate) !== fingerprint(run)) throw new Error('El evento repetido no es idempotente')
    }
    if (scenario.continuation && run.decision.kind === 'ask') {
      const next = continuedScenario(scenario)
      cached.set(`${repetition}:${next.id}`, await execute(next, repetition))
    }
    if (useProvider && run.decision.kind === 'unavailable') throw new Error('Evaluación detenida por proveedor/presupuesto; resultados parciales conservados en el diario')
  }
  const reviewsPath = option('--reviews')
  const report = evaluateAcceptance(scenarios, corpus, 3, { reviews: reviewsPath ? await json(reviewsPath) as DecisionReview[] : undefined, runner: (s, _c, repetition) => structuredClone(cached.get(`${repetition}:${s.id}`)!) })
  await save(path.join(directory, 'report.json'), { ...report, corpusVersion: corpus.version })
  await save(path.join(directory, 'security-report.json'), { schema: 'agent-lab-security-report-v1', labVersion: report.labVersion, corpusVersion: corpus.version, corpusFingerprint: report.corpusFingerprint, repetitions: report.repetitions, ...report.security, safetyFailures: report.safetyFailures })
  await save(path.join(directory, 'quality-report.json'), { schema: 'agent-lab-quality-report-v1', labVersion: report.labVersion, corpusVersion: corpus.version, corpusFingerprint: report.corpusFingerprint, repetitions: report.repetitions, acceptanceScenarios: report.acceptanceScenarios, accepted: report.accepted, acceptanceRate: report.acceptanceRate, threshold: report.threshold, passesGate: report.passesGate, qualityBlockers: report.qualityBlockers, failures: report.failures })
  console.log(JSON.stringify({ ...report, reports: { all: `${directory}/report.json`, security: `${directory}/security-report.json`, quality: `${directory}/quality-report.json` }, checkpoint: { ...report.checkpoint, runs: `${directory}/report.json` } }, null, 2))
  if (!report.passesGate) process.exitCode = 1
}

try { await main() } catch (error) {
  console.log(JSON.stringify({ passesGate: false, failures: [error instanceof Error ? error.message : 'Fallo de laboratorio'] }, null, 2))
  process.exitCode = 1
}
