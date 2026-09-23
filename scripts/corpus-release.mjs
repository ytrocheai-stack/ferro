#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { canonicalJson, sha256Hex } from '../packages/corpus-identity/src/index.mjs'
import { scientificReviewReady } from '../packages/corpus-evaluation/src/scientific-review.mjs'
import { benchmarkEvidence, CANDIDATE_FLAGS, labEvidence, productionFlagValues, workingTreeSnapshot } from './corpus-status.mjs'

const filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(filename), '..')
const args = process.argv.slice(2)
const GEMINI_MODEL = 'gemini-3.5-flash-lite'
const EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b'

function option(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}

async function readJson(file) { return JSON.parse(await fs.readFile(path.resolve(root, file), 'utf8')) }
async function fileHash(file) { return createHash('sha256').update(await fs.readFile(path.resolve(root, file))).digest('hex') }

function tomlValue(config, name) {
  return config.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"\\s*$`, 'm'))?.[1]
}

function productionContract(config) {
  const accountIds = (tomlValue(config, 'ALLOWED_CLERK_IDS') ?? '').split(',').map(value => value.trim()).filter(Boolean)
  if (accountIds.length !== 1) throw new Error('La configuración de producción debe permitir exactamente una cuenta Clerk')
  if (canonicalJson(productionFlagValues(config)) !== canonicalJson(CANDIDATE_FLAGS)) throw new Error('La configuración base debe mantener ENABLE_BETA=false, Gemini y embeddings habilitados, y las demás flags apagadas')
  if (tomlValue(config, 'ENABLE_EMBEDDINGS') !== 'true' || tomlValue(config, 'COACH_PROVIDER_ORDER') !== 'gemini' || tomlValue(config, 'GEMINI_MODEL') !== GEMINI_MODEL || tomlValue(config, 'EMBEDDING_MODEL') !== EMBEDDING_MODEL) throw new Error('La configuración no coincide con Gemini para generación y NVIDIA solo para embeddings')
  return { allowlist: { accountId: accountIds[0], count: 1 }, flags: productionFlagValues(config) }
}

export async function createReleaseCandidate({ manifestPath = '.cache/corpus/hevy/manifest.json', referencePath = '.cache/corpus/hevy/reference-final.json', resultPath = '.cache/corpus/hevy/results.generated.json', benchmarkCheckpointPath = `${resultPath}.checkpoint.json`, reviewPath = '.cache/corpus/hevy/review-report.json', reviewsPath = '.cache/corpus/hevy/response-reviews.json', labPath = '.cache/corpus/hevy/agent-lab/report.json', configPath = 'worker/wrangler.production.toml', outputPath = '.cache/corpus/hevy/release-candidate.json', now = Date.now() } = {}) {
  const [manifest, reference, result, benchmarkCheckpoint, review, reviews, lab, configBytes] = await Promise.all([
    readJson(manifestPath), readJson(referencePath), readJson(resultPath), readJson(benchmarkCheckpointPath), readJson(reviewPath), readJson(reviewsPath), readJson(labPath), fs.readFile(path.resolve(root, configPath)),
  ])
  const sourceSnapshot = workingTreeSnapshot()
  const { allowlist, flags } = productionContract(configBytes.toString('utf8'))
  if (manifest.status !== 'approved' || manifest.sources?.length !== 88 || manifest.chunks?.length !== 2708) throw new Error('El expediente solo puede fijarse para un corpus aprobado de 88 fuentes y 2.708 fragmentos')
  if (reference.status !== 'approved' || reference.corpusVersion !== manifest.corpusVersion || reference.queries?.length !== 50 || !scientificReviewReady(reference)) throw new Error('El benchmark debe estar ligado y contar con revisión científica completa de las 50 consultas antes de fijar el release')
  const resultWithoutFingerprint = structuredClone(result)
  delete resultWithoutFingerprint.fingerprints
  const resultFingerprint = sha256Hex(canonicalJson(resultWithoutFingerprint))
  if (result.schema !== 'generated-benchmark-v1' || result.corpusVersion !== manifest.corpusVersion || result.benchmarkVersion !== reference.version || result.execution !== 'remote-gemini-complete' || result.generationModel !== GEMINI_MODEL || result.model !== EMBEDDING_MODEL || result.formalRemoteResponsesRequired !== 300 || result.formalRemoteResponsesComplete !== 300 || result.authorization?.provider !== 'google-ai-studio' || result.authorization?.model !== GEMINI_MODEL || result.authorization?.embeddingModel !== EMBEDDING_MODEL || result.provider?.calls !== 300 || result.provider?.uncertainCalls !== 0 || result.fingerprints?.results !== resultFingerprint || result.repetitions !== 3 || !Array.isArray(result.runs) || result.runs.length !== 3) throw new Error('El expediente requiere 300 respuestas Gemini remotas completas, medidas y ligadas al corpus y benchmark exactos')
  const benchmarkGate = benchmarkEvidence(manifest, reference, result, review, benchmarkCheckpoint, reviews, [], now)
  if (!benchmarkGate.ok) throw new Error(`El expediente requiere evidencia reciente y completa de Gemini: ${benchmarkGate.errors.join('; ')}`)
  if (review.schema !== 'hevy-independent-review-v1' || review.corpusVersion !== manifest.corpusVersion || review.complete !== true || !['human', 'agent'].includes(review.reviewerType) || review.reviewerType !== reviews?.reviewerType || review.independentReviewer !== true || !review.reviewerId?.trim() || review.reviewerId === GEMINI_MODEL || review.generatorId !== GEMINI_MODEL || review.responses !== 300 || review.reviewedResponses !== 300 || review.resultFingerprint !== resultFingerprint || review.fingerprints?.results !== resultFingerprint || !review.reviewsFingerprint || !Array.isArray(reviews?.responses) || reviews.responses.length !== 300 || review.reviewsFingerprint !== sha256Hex(canonicalJson(reviews))) throw new Error('El expediente requiere revisión independiente humana o agente completa y ligada a las 300 respuestas Gemini')
  const labGate = labEvidence(manifest, lab, now)
  if (!labGate.ok) throw new Error(`El expediente requiere los gates Gemini del laboratorio: ${labGate.errors.join('; ')}`)
  const candidateConfigPath = path.relative(root, path.join(path.dirname(path.resolve(root, outputPath)), 'release-candidate-deployment.toml')).replaceAll('\\', '/')
  const candidateConfigFile = path.resolve(root, candidateConfigPath)
  await fs.mkdir(path.dirname(candidateConfigFile), { recursive: true })
  try { await fs.writeFile(candidateConfigFile, configBytes, { flag: 'wx' }) } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
    const existing = await fs.readFile(candidateConfigFile)
    if (!existing.equals(configBytes)) throw new Error('La copia inmutable de configuración candidata ya existe con bytes distintos', { cause: error })
  }
  const candidate = {
    schema: 'coach-release-candidate-v2', status: 'candidate', createdAt: new Date(now).toISOString(),
    ...sourceSnapshot,
    corpusVersion: manifest.corpusVersion, benchmarkVersion: reference.version,
    hashes: { manifest: sha256Hex(canonicalJson(manifest)), benchmark: sha256Hex(canonicalJson(reference)), benchmarkResult: result.fingerprints.results, benchmarkCheckpoint: sha256Hex(canonicalJson(benchmarkCheckpoint)), review: sha256Hex(canonicalJson(review)), lab: sha256Hex(canonicalJson(lab)), deploymentConfig: await fileHash(candidateConfigPath), activatedConfig: await fileHash(configPath) },
    paths: { manifest: manifestPath, benchmark: referencePath, benchmarkResult: resultPath, benchmarkCheckpoint: benchmarkCheckpointPath, review: reviewPath, lab: labPath, deploymentConfig: candidateConfigPath, activatedConfig: configPath },
    generation: { provider: 'google-ai-studio', model: GEMINI_MODEL },
    embeddings: { provider: 'nvidia', model: EMBEDDING_MODEL },
    allowlist,
    flags,
  }
  candidate.fingerprint = sha256Hex(canonicalJson(candidate))
  const target = path.resolve(root, outputPath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(candidate, null, 2) + '\n', 'utf8')
  return { output: target, candidate }
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  try {
    const result = await createReleaseCandidate({
      manifestPath: option('--manifest'), referencePath: option('--benchmark'), resultPath: option('--results'), reviewPath: option('--review-report'), labPath: option('--lab-report'), configPath: option('--config'), outputPath: option('--output'),
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
