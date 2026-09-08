#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  const value = index < 0 ? undefined : args[index + 1]
  return value && !value.startsWith('--') ? value : fallback
}
const manifestPath = path.resolve(root, option('--manifest', '.cache/corpus/hevy/manifest.json'))
const base = path.dirname(manifestPath)
const outputPath = path.resolve(root, option('--output', path.join(base, 'evidence-inventory.json')))

async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')) }
async function fileHash(file) { return createHash('sha256').update(await fs.readFile(file)).digest('hex') }
async function addArtifact(artifacts, relativePath, required = true) {
  if (!relativePath) return
  const absolutePath = path.resolve(root, relativePath)
  try {
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) throw new Error('not-file')
    artifacts.push({ path: path.relative(root, absolutePath).replaceAll('\\', '/'), required, bytes: stat.size, sha256: await fileHash(absolutePath) })
  } catch {
    artifacts.push({ path: path.relative(root, absolutePath).replaceAll('\\', '/'), required, missing: true })
  }
}

const manifest = await readJson(manifestPath)
const artifacts = []
const required = [
  path.relative(root, manifestPath),
  path.relative(root, path.join(base, 'reference-final.json')),
  path.relative(root, path.join(base, 'embeddings', 'matrix-2048.json')),
  path.relative(root, path.join(base, 'embeddings', 'checkpoint.json')),
  path.relative(root, path.join(base, 'embeddings', 'queries-2048.jsonl')),
  path.relative(root, path.join(base, 'upload-checkpoint.json')),
  path.relative(root, path.join(base, 'remote-verification.json')),
  ...(await fs.readdir(base)).filter(file => /^results(?:\..+)?\.json(?:\.checkpoint)?$/.test(file)).map(file => path.relative(root, path.join(base, file))),
  path.relative(root, path.join(base, 'response-reviews.json')),
  path.relative(root, path.join(base, 'review-report.json')),
  path.relative(root, path.join(base, 'agent-lab', 'report.json')),
  path.relative(root, path.join(base, 'agent-lab', 'security-report.json')),
  path.relative(root, path.join(base, 'agent-lab', 'quality-report.json')),
  path.relative(root, path.join(base, 'smoke-report.json')),
  path.relative(root, path.join(base, 'release-candidate.json')),
  path.relative(root, path.join(base, 'release-approval.json')),
  path.relative(root, path.join(base, 'deployment-verification.json')),
  'worker/wrangler.production.toml',
]
let uploadCheckpoint
try { uploadCheckpoint = await readJson(path.join(base, 'upload-checkpoint.json')) } catch { /* inventory records the missing checkpoint below */ }
required.push(...(uploadCheckpoint?.backupPath ? [path.relative(root, path.resolve(uploadCheckpoint.backupPath))] : []))
let releaseCandidate
try { releaseCandidate = await readJson(path.join(base, 'release-candidate.json')) } catch { /* inventory records the missing candidate below */ }
required.push(...[releaseCandidate?.paths?.deploymentConfig, releaseCandidate?.paths?.activatedConfig].filter(Boolean))
const migrationFiles = (await fs.readdir(path.join(root, 'worker', 'migrations'))).filter(file => file.endsWith('.sql')).sort()
required.push(...migrationFiles.map(file => path.join('worker', 'migrations', file)))
for (const file of [...new Set(required)]) await addArtifact(artifacts, file, true)

const inventory = {
  schema: 'coach-evidence-inventory-v1',
  generatedAt: new Date().toISOString(),
  corpusVersion: manifest.corpusVersion ?? null,
  artifacts,
  migrationFiles,
  privateArtifactsOnly: true,
}
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, JSON.stringify(inventory, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ output: outputPath, schema: inventory.schema, corpusVersion: inventory.corpusVersion, artifacts: artifacts.length, missingRequired: artifacts.filter(item => item.required && item.missing).map(item => item.path) }, null, 2))
if (artifacts.some(item => item.required && item.missing)) process.exitCode = 1
