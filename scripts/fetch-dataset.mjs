// Descarga el dataset de ejercicios (hasaneyldrm/exercises-dataset) fijado a un
// commit concreto, genera un JSON slim (solo es/en) y copia miniaturas y GIFs a public/.
// Corre en local (setup/dev) y en CI (deploy). Idempotente: cachea la descarga en .cache/.
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  cpSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA = '118e4bd6b14da6df0e36605d7169b65db18389a4' // main @ 2026-07-15

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache')
const tarPath = path.join(cacheDir, `dataset-${SHA.slice(0, 12)}.tar.gz`)
const extractedDir = path.join(cacheDir, `exercises-dataset-${SHA}`)
const publicDir = path.join(root, 'public')

mkdirSync(cacheDir, { recursive: true })

if (!existsSync(tarPath)) {
  console.log('Descargando dataset (~150 MB)…')
  const res = await fetch(`https://codeload.github.com/hasaneyldrm/exercises-dataset/tar.gz/${SHA}`)
  if (!res.ok) throw new Error(`Descarga falló: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tarPath + '.tmp'))
  renameSync(tarPath + '.tmp', tarPath)
  console.log(`Descargado: ${(statSync(tarPath).size / 1e6).toFixed(1)} MB`)
} else {
  console.log('Tarball ya en caché, no se descarga de nuevo.')
}

if (!existsSync(extractedDir)) {
  console.log('Extrayendo…')
  execFileSync('tar', ['-xzf', tarPath, '-C', cacheDir], { stdio: 'inherit' })
}

console.log('Generando JSON slim (es/en)…')
const raw = JSON.parse(readFileSync(path.join(extractedDir, 'data', 'exercises.json'), 'utf8'))

const slim = raw.map((e) => {
  let steps = e.instruction_steps?.es
  if (!steps?.length) steps = e.instruction_steps?.en
  if (!steps?.length) {
    const text = e.instructions?.es || e.instructions?.en
    steps = text ? [text] : []
  }
  return {
    id: e.id,
    name: e.name,
    bodyPart: e.body_part,
    equipment: e.equipment,
    target: e.target,
    muscleGroup: e.muscle_group,
    secondaryMuscles: e.secondary_muscles ?? [],
    image: e.image ?? null,
    gif: e.gif_url ?? null,
    steps,
  }
})

mkdirSync(path.join(publicDir, 'data'), { recursive: true })
const outJson = path.join(publicDir, 'data', 'exercises.json')
writeFileSync(outJson, JSON.stringify(slim))

console.log('Copiando miniaturas y GIFs a public/…')
cpSync(path.join(extractedDir, 'images'), path.join(publicDir, 'images'), { recursive: true })
cpSync(path.join(extractedDir, 'videos'), path.join(publicDir, 'videos'), { recursive: true })

const count = (dir) => readdirSync(dir).length
const mb = (p) => (statSync(p).size / 1e6).toFixed(2)
console.log(`Listo:
  - ${slim.length} ejercicios → public/data/exercises.json (${mb(outJson)} MB)
  - ${count(path.join(publicDir, 'images'))} miniaturas en public/images/
  - ${count(path.join(publicDir, 'videos'))} GIFs en public/videos/`)
const sinEs = raw.filter((e) => !e.instruction_steps?.es?.length).length
if (sinEs > 0) console.log(`  - Aviso: ${sinEs} ejercicios sin instrucciones en español (fallback a inglés)`)
