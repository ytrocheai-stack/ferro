import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readJson, writeJson } from '../packages/corpus-pipeline/src/runtime.ts'

const directory = '.cache/corpus/hevy'
const reviewPath = `${directory}/population-review-2026-09-08.json`
const manifestPath = `${directory}/manifest.json`
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
const review = readJson<{ manifest: { corpusVersion: string; sha256: string }; reviewer: unknown; sources: Array<{ sourceId: string; sourceHash: string; status: string; population: string[]; reason: string; evidence: Array<{ chunkId: string; textHash: string; passage: string }> }> }>(reviewPath)
const manifest = readJson<{ corpusVersion: string; populationReviewFingerprint?: string; sources: Array<{ id: string; sourceHash: string; population: string[]; populationReviewed: boolean; populationScope?: string }>; chunks: Array<{ id: string; sourceId: string; text: string; textHash: string; population: string[]; populationReviewed: boolean }> }>(manifestPath)
const reviewFingerprint = sha(readFileSync(reviewPath))
if (manifest.populationReviewFingerprint === reviewFingerprint) {
  console.log('Revisión ya aplicada; no se modificó el corpus.')
} else {
  if (manifest.corpusVersion !== review.manifest.corpusVersion || sha(readFileSync(manifestPath)) !== review.manifest.sha256) throw new Error('Revisión de otro manifiesto; revisar antes de aplicar')
  const chunks = new Map(manifest.chunks.map(chunk => [chunk.id, chunk]))
  for (const sourceReview of review.sources.filter(item => item.status === 'included')) {
    const source = manifest.sources.find(item => item.id === sourceReview.sourceId)
    if (!source || source.sourceHash !== sourceReview.sourceHash || !sourceReview.evidence.length) throw new Error('Fuente de revisión no verificable')
    for (const evidence of sourceReview.evidence) {
      const chunk = chunks.get(evidence.chunkId)
      if (!chunk || chunk.sourceId !== source.id || chunk.textHash !== evidence.textHash || sha(chunk.text) !== evidence.textHash || !chunk.text.includes(evidence.passage)) throw new Error(`Pasaje de revisión no coincide: ${evidence.chunkId}`)
    }
    source.population = sourceReview.population
    source.populationReviewed = true
    source.populationScope = sourceReview.reason
    for (const chunk of manifest.chunks.filter(item => item.sourceId === source.id)) {
      chunk.population = sourceReview.population
      chunk.populationReviewed = true
    }
  }
  // Identidad de contenido/IDs vectoriales estable; revisión de recuperación separada.
  // Se actualizan los mismos vectores con respaldo: duplicarlos excedería los 5M gratuitos.
  manifest.populationReviewFingerprint = reviewFingerprint
  const backup = `${directory}/manifest.before-population-review.json`
  if (existsSync(backup)) throw new Error('El respaldo ya existe; conciliar antes de sobrescribir')
  copyFileSync(manifestPath, backup)
  writeJson(manifestPath, manifest)
  writeJson(`${directory}/population-review-application.json`, { at: new Date().toISOString(), reviewFingerprint, reviewer: review.reviewer, corpusVersion: manifest.corpusVersion, contentUnchanged: true, vectorIdsUnchanged: true, includedSources: manifest.sources.filter(s => s.populationReviewed).map(s => s.id), backup })
  console.log(JSON.stringify({ reviewFingerprint, includedSources: manifest.sources.filter(s => s.populationReviewed).length }))
}
