import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { z } from 'zod'
import { evaluateBenchmark, validateBenchmark } from '../../corpus-evaluation/src/index.mjs'
import { evaluateAcceptance, continuedScenario } from './evaluation.ts'
import type { DecisionReview, LabEvaluationReport } from './evaluation.ts'
import { runLab } from './orchestrator.ts'
import { runProviderLab, createResumableFlashProvider, PRIVATE_TRAINING_INSTRUCTIONS, TRAINING_INSTRUCTIONS } from './provider.ts'
import { createSemanticSearchEvidence } from './tools.ts'
import { LabJournal } from './journal.ts'
import { fingerprint, stableAuthorizationIdentity } from './identity.ts'
import { planDiff } from './diff.ts'
import { acceptanceScenarios, developmentScenarios, safetyScenarios } from './scenarios.ts'
import { LAB_VERSION, INSTRUCTION_VERSION, TOOL_VERSION, MODEL_CONFIG_VERSION } from './types.ts'
import type { LabCorpus, LabRun, LabScenario } from './types.ts'
import { KIMI_MODEL, loadLocalEnv, ProviderSession, readAuthorization, type Authorization } from '../../corpus-pipeline/src/runtime.ts'
import type { EmbeddingMatrix } from '../../corpus-retrieval/src/index.ts'
import { scientificReviewReady } from '../../corpus-evaluation/src/scientific-review.mjs'

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
  let authorization: (Authorization & { reviewer: string; evidence: string }) | undefined
  if (useProvider) {
    const reference = await json(option('--reference') ?? path.join(root, '.cache/corpus/hevy/reference-final.json')) as { status?: string; corpusVersion?: string; queries?: unknown[]; scientificReview?: Record<string, unknown> }
    if (reference.status !== 'approved' || reference.corpusVersion !== manifest.corpusVersion || reference.queries?.length !== 50 || !scientificReviewReady(reference)) throw new Error('Modo proveedor requiere la aprobación científica completa y vinculada antes de llamar a Flash')
    const authorizationPath = option('--authorization')
    if (!authorizationPath) throw new Error('Modo proveedor requiere --authorization con acceso y presupuesto sin gasto adicional verificados')
    loadLocalEnv()
    const baseAuthorization = readAuthorization(authorizationPath)
    if (baseAuthorization.model !== KIMI_MODEL) throw new Error(`Modo proveedor privado requiere ${KIMI_MODEL}; la autorización Flash histórica no se reutiliza para datos reales`)
    const reviewAuthorization = z.object({ reviewer: z.string().trim().min(1), evidence: z.string().trim().min(1) }).parse(await json(authorizationPath))
    authorization = { ...baseAuthorization, ...reviewAuthorization }
    if (!process.env.NVIDIA_API_KEY?.trim()) throw new Error('Modo proveedor requiere NVIDIA_API_KEY configurada localmente; no se hicieron llamadas')
  }
  const provider = authorization ? createResumableFlashProvider({ apiKey: process.env.NVIDIA_API_KEY ?? '', authorization, directory: path.join(root, '.cache/corpus/hevy/provider-ledger') }) : undefined
  const semanticSession = authorization ? new ProviderSession({ apiKey: process.env.NVIDIA_API_KEY ?? '', authorization, directory: path.join(root, '.cache/corpus/hevy/provider-ledger') }) : undefined
  const semanticSearchEvidence = semanticSession ? createSemanticSearchEvidence(corpus, await json(option('--matrix') ?? path.join(root, '.cache/corpus/hevy/embeddings/matrix-2048.json')) as EmbeddingMatrix, query => semanticSession.embed(query, 'query')) : undefined
  const revisions = { LAB_VERSION, INSTRUCTION_VERSION, TOOL_VERSION, MODEL_CONFIG_VERSION, instructions: useProvider ? PRIVATE_TRAINING_INSTRUCTIONS : TRAINING_INSTRUCTIONS }
  // Authorization freshness is temporal access control, not result identity.
  // Renewing it must allow a confirmed journal entry to resume unchanged.
  const authorizationIdentity = authorization ? stableAuthorizationIdentity(authorization) : undefined
  const execute = async (scenario: LabScenario, repetition: number): Promise<LabRun> => {
    const key = `${repetition}:${scenario.input.event.accountId}:${scenario.input.event.id}:${scenario.id.endsWith(':continuation') ? 'continuation' : 'initial'}`
    return journal.execute(key, { input: scenario.input, corpus, revisions, authorization: authorizationIdentity, mode: useProvider ? 'provider' : 'simulated' }, async beforeAttempt => {
      const run = provider && authorization ? await runProviderLab(scenario.input, corpus, provider, {
        providerAvailable: true, budgetVerified: true,
        accountingMode: authorization.accountingMode,
        runKey: key,
        semanticSearchEvidence,
        budget: { maxCalls: authorization.maxCalls, maxInputTokens: authorization.maxInputTokens, maxOutputTokens: authorization.maxOutputTokens, timeoutMs: authorization.timeoutMs },
        beforeAttempt: async reservation => {
          const reserved = journal.reservedUsage()
          if (reserved.calls + reservation.calls > authorization!.maxTotalCalls || (authorization!.accountingMode !== 'requests' && (reserved.inputTokens + reservation.inputTokens > authorization!.maxTotalInputTokens || reserved.outputTokens + reservation.outputTokens > authorization!.maxTotalOutputTokens))) throw new Error('Presupuesto global de laboratorio agotado')
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
