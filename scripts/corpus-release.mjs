#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { canonicalJson, sha256Hex } from '../packages/corpus-identity/src/index.mjs'
import { scientificReviewReady } from '../packages/corpus-evaluation/src/scientific-review.mjs'

const execFileAsync = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)

function option(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}

async function readJson(file) { return JSON.parse(await fs.readFile(path.resolve(root, file), 'utf8')) }
async function fileHash(file) { return createHash('sha256').update(await fs.readFile(path.resolve(root, file))).digest('hex') }
async function git(args) { return (await execFileAsync('git', args, { cwd: root })).stdout.trim() }

function safeChangedPath(value) {
  return value && !/^\.env(?:\.|$)/i.test(value) && !/(?:^|[\\/])\.cache(?:[\\/]|$)/.test(value) && !/(?:^|[\\/])node_modules(?:[\\/]|$)/.test(value) && !/(?:^|[\\/])dist(?:[\\/]|$)/.test(value)
}

export async function createReleaseCandidate({ manifestPath = '.cache/corpus/hevy/manifest.json', referencePath = '.cache/corpus/hevy/reference-final.json', resultPath = '.cache/corpus/hevy/results.kimi-k3-generated.json', reviewPath = '.cache/corpus/hevy/review-report.json', labPath = '.cache/corpus/hevy/agent-lab/report.json', configPath = 'worker/wrangler.production.toml', outputPath = '.cache/corpus/hevy/release-candidate.json' } = {}) {
  const [manifest, reference, result, review, lab, commit, status, tracked, untracked] = await Promise.all([
    readJson(manifestPath), readJson(referencePath), readJson(resultPath), readJson(reviewPath), readJson(labPath), git(['rev-parse', 'HEAD']), git(['status', '--porcelain=v1']), git(['diff', '--name-only', 'HEAD']), git(['ls-files', '--others', '--exclude-standard']),
  ])
  if (manifest.status !== 'approved' || manifest.sources?.length !== 88 || manifest.chunks?.length !== 2708) throw new Error('El expediente solo puede fijarse para un corpus aprobado de 88 fuentes y 2.708 fragmentos')
  if (reference.status !== 'approved' || reference.corpusVersion !== manifest.corpusVersion || reference.queries?.length !== 50 || !scientificReviewReady(reference)) throw new Error('El benchmark debe estar ligado y contar con revisión científica completa de las 50 consultas antes de fijar el release')
  if (result.schema !== 'generated-benchmark-v1' || result.corpusVersion !== manifest.corpusVersion || result.benchmarkVersion !== reference.version || result.execution !== 'remote-flash' || result.authorization?.model !== 'moonshotai/kimi-k3' || result.provider?.calls !== 300 || typeof result.fingerprints?.results !== 'string' || result.repetitions !== 3 || !Array.isArray(result.runs) || result.runs.length !== 3) throw new Error('El expediente requiere 300 resultados Flash remotos de moonshotai/kimi-k3 en tres repeticiones del corpus y benchmark exactos')
  if (review.schema !== 'hevy-independent-review-v1' || review.corpusVersion !== manifest.corpusVersion || review.complete !== true || review.responses !== 300 || review.reviewedResponses !== 300 || review.resultFingerprint !== result.fingerprints.results) throw new Error('El expediente requiere revisión independiente completa y ligada a las 300 respuestas')
  if (lab.corpusVersion !== manifest.corpusVersion || lab.repetitions !== 3 || lab.acceptanceScenarios !== 28 || lab.safetyScenarios !== 10 || lab.passesGate !== true || lab.safetyPassesGate !== true) throw new Error('El expediente requiere gates completos del laboratorio')
  const changedFiles = [...new Set([...tracked.split(/\r?\n/), ...untracked.split(/\r?\n/)].filter(safeChangedPath))].sort()
  const changedFileHashes = Object.fromEntries(await Promise.all(changedFiles.map(async file => {
    try { return [file, await fileHash(file)] }
    catch { return [file, 'deleted'] }
  })))
  const candidateConfigPath = path.relative(root, path.join(path.dirname(path.resolve(root, outputPath)), 'release-candidate-deployment.toml')).replaceAll('\\', '/')
  const candidateConfigFile = path.resolve(root, candidateConfigPath)
  await fs.mkdir(path.dirname(candidateConfigFile), { recursive: true })
  const configBytes = await fs.readFile(path.resolve(root, configPath))
  try { await fs.writeFile(candidateConfigFile, configBytes, { flag: 'wx' }) } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
    const existing = await fs.readFile(candidateConfigFile)
    if (!existing.equals(configBytes)) throw new Error('La copia inmutable de configuración candidata ya existe con bytes distintos', { cause: error })
  }
  const candidate = {
    schema: 'coach-release-candidate-v2', status: 'candidate', createdAt: new Date().toISOString(),
    commit, workingTreeDirty: Boolean(status), changedFiles, changedFileHashes, workingTreeFingerprint: sha256Hex(canonicalJson(changedFileHashes)),
    corpusVersion: manifest.corpusVersion, benchmarkVersion: reference.version,
    hashes: { manifest: sha256Hex(canonicalJson(manifest)), benchmark: sha256Hex(canonicalJson(reference)), benchmarkResult: result.fingerprints.results, review: sha256Hex(canonicalJson(review)), lab: sha256Hex(canonicalJson(lab)), deploymentConfig: await fileHash(candidateConfigPath), activatedConfig: await fileHash(configPath) },
    paths: { manifest: manifestPath, benchmark: referencePath, benchmarkResult: resultPath, review: reviewPath, lab: labPath, deploymentConfig: candidateConfigPath, activatedConfig: configPath },
    flags: { ENABLE_BETA: false, ENABLE_EMBEDDINGS: false, ENABLE_FLASH: false, ENABLE_PRO: false, ENABLE_RERANKING: false, ENABLE_PROVIDER_PROBE: false },
  }
  candidate.fingerprint = sha256Hex(canonicalJson(candidate))
  const target = path.resolve(root, outputPath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(candidate, null, 2) + '\n', 'utf8')
  return { output: target, candidate }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
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
