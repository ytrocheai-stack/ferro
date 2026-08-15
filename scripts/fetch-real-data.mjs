// Genera snapshots compactos y reproducibles de USDA Foundation Foods.
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

mkdirSync(cacheDir, { recursive: true })
mkdirSync(snapshotDir, { recursive: true })
mkdirSync(publicDir, { recursive: true })

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
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

const usda = await ensureUsdaSnapshot()
writeFileSync(path.join(publicDir, 'usda-foundation.json'), usda)

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
  },
}, null, 2) + '\n')
console.log(`Snapshots listos: USDA ${JSON.parse(usda).length}`)
