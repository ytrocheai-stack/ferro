// Genera snapshots compactos y reproducibles de USDA Foundation Foods y wger.
// Sin --refresh sólo lee snapshots versionados y copia los artefactos al build.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache')
const snapshotDir = path.join(root, 'data', 'snapshots')
const publicDir = path.join(root, 'public', 'data')
const refresh = process.argv.includes('--refresh')
const usdaZip = path.join(cacheDir, 'FoodData_Central_foundation_food_json_2026-04-30.zip')
const usdaUrl = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip'
const wgerUrl = 'https://wger.de/api/v2/exerciseinfo/?language=2&limit=1000'

mkdirSync(cacheDir, { recursive: true })
mkdirSync(snapshotDir, { recursive: true })
mkdirSync(publicDir, { recursive: true })

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const nutrient = (food, number) => {
  const item = food.foodNutrients?.find((entry) => String(entry.nutrient?.number) === number)
  return Number(item?.amount ?? item?.median ?? 0)
}

function normalizeUsda(raw) {
  return raw.FoundationFoods.filter(Boolean).map((food) => {
    const servingG = Number(food.foodPortions?.find((portion) => Number(portion.gramWeight) > 0)?.gramWeight ?? 100)
    return {
      id: `usda-${food.fdcId}`,
      name: String(food.description).trim(),
      source: 'usda',
      usdaFdcId: food.fdcId,
      kcal100: Math.round((nutrient(food, '208') || nutrient(food, '1008')) * 10) / 10,
      p100: Math.round(nutrient(food, '203') * 10) / 10,
      c100: Math.round(nutrient(food, '205') * 10) / 10,
      f100: Math.round(nutrient(food, '204') * 10) / 10,
      servingG: Math.round(servingG * 10) / 10,
    }
  }).filter((food) => food.name && Number.isFinite(food.kcal100))
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<li[^>]*>/gi, '')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function normalizeWger(raw) {
  return raw.results.map((exercise) => {
    const translations = exercise.translations ?? []
    const english = translations.find((item) => item.language === 2) ?? translations[0]
    const spanish = translations.find((item) => item.language === 4)
    const name = String(english?.name ?? `wger ${exercise.id}`).trim()
    const aliases = [spanish?.name, ...(english?.aliases ?? []).map((item) => item.alias)]
      .filter((value) => value && value.trim() && value.trim().toLowerCase() !== name.toLowerCase())
    const mainMuscle = exercise.muscles?.[0]
    return {
      id: `wger-${exercise.uuid ?? exercise.id}`,
      name,
      aliases: [...new Set(aliases)],
      bodyPart: exercise.category?.name ?? 'Other',
      equipment: exercise.equipment?.[0]?.name ?? 'none',
      target: mainMuscle?.name_en || mainMuscle?.name || exercise.category?.name || 'other',
      muscleGroup: mainMuscle?.name_en || mainMuscle?.name || exercise.category?.name || 'other',
      secondaryMuscles: (exercise.muscles_secondary ?? []).map((item) => item.name_en || item.name).filter(Boolean),
      image: null,
      gif: null,
      steps: stripHtml(english?.description ?? spanish?.description).slice(0, 20),
      source: 'wger',
      sourceUrl: `https://wger.de/exercise/${exercise.id}`,
      license: exercise.license?.short_name ?? 'CC-BY-SA',
    }
  })
}

async function ensureUsdaSnapshot() {
  const target = path.join(snapshotDir, 'usda-foundation.json')
  if (refresh || !existsSync(target)) {
    if (!existsSync(usdaZip)) {
      const response = await fetch(usdaUrl)
      if (!response.ok) throw new Error(`USDA: HTTP ${response.status}`)
      writeFileSync(usdaZip, Buffer.from(await response.arrayBuffer()))
    }
    const extractDir = path.join(cacheDir, 'usda-foundation-current')
    mkdirSync(extractDir, { recursive: true })
    // macOS/Windows suelen exponer bsdtar; los runners Linux traen unzip.
    // Elegir por plataforma evita que el workflow falle intentando leer ZIP como TAR.
    if (process.platform === 'win32' || process.platform === 'darwin') {
      execFileSync('tar', ['-xf', usdaZip, '-C', extractDir])
    } else {
      execFileSync('unzip', ['-oq', usdaZip, '-d', extractDir])
    }
    const jsonFile = path.join(extractDir, 'FoodData_Central_foundation_food_json_2026-04-30.json')
    writeFileSync(target, JSON.stringify(normalizeUsda(readJson(jsonFile))))
  }
  return readFileSync(target)
}

async function ensureWgerSnapshot() {
  const target = path.join(snapshotDir, 'wger-exercises.json')
  if (refresh || !existsSync(target)) writeFileSync(target, JSON.stringify(normalizeWger(await fetchJson(wgerUrl))))
  return readFileSync(target)
}

const usda = await ensureUsdaSnapshot()
const wger = await ensureWgerSnapshot()
writeFileSync(path.join(publicDir, 'usda-foundation.json'), usda)
writeFileSync(path.join(publicDir, 'exercises-wger.json'), wger)

const lockFile = path.join(root, 'data', 'sources.lock.json')
const existing = existsSync(lockFile) ? readJson(lockFile) : {}
writeFileSync(lockFile, JSON.stringify({
  ...existing,
  generatedAt: existing.generatedAt ?? new Date().toISOString(),
  sources: {
    usdaFoundation: {
      url: usdaUrl,
      release: 'April 2026',
      license: 'CC0',
      sha256: sha256(usda),
      records: JSON.parse(usda).length,
    },
    wgerExercises: {
      url: wgerUrl,
      license: 'CC-BY-SA',
      sha256: sha256(wger),
      records: JSON.parse(wger).length,
    },
  },
}, null, 2) + '\n')
console.log(`Snapshots listos: USDA ${JSON.parse(usda).length}, wger ${JSON.parse(wger).length}`)
