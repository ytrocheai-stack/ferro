import { expect, test, type Page } from '@playwright/test'

const anatomyAssets = [
  'front.png',
  'back.png',
  'front-abs.png',
  'front-biceps.png',
  'front-calves.png',
  'front-chest.png',
  'front-forearms.png',
  'front-quads.png',
  'front-shoulders.png',
  'back-back.png',
  'back-calves.png',
  'back-forearms.png',
  'back-glutes.png',
  'back-hamstrings.png',
  'back-shoulders.png',
  'back-triceps.png',
  'body.glb',
] as const

type CatalogExercise = { id: string; target: string }

async function seedTemporaryHistory(page: Page) {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Entrenar' })).toBeVisible()

  // El contexto de Playwright es temporal: estos datos no tocan el navegador del usuario.
  await page.evaluate(async () => {
    const catalog = await fetch(new URL('data/exercises.json', document.baseURI)).then((response) => response.json()) as CatalogExercise[]
    const chest = catalog.find((exercise) => exercise.target === 'pectorals')
    const back = catalog.find((exercise) => exercise.target === 'lats')
    if (!chest || !back) throw new Error('No se encontraron ejercicios de prueba en el catálogo')

    const rows = [0, 1, 2].map((daysAgo, index) => {
      const date = new Date()
      date.setDate(date.getDate() - daysAgo)
      date.setHours(0, 0, 0, 0)
      const exercises = [chest, ...(index < 2 ? [back] : [])].map((exercise) => ({
        exerciseId: exercise.id,
        restSec: 90,
        sets: [{ completed: true, type: 'normal', weightKg: 20, reps: 10 }],
      }))
      return {
        id: `heatmap-test-${index}`,
        name: 'Prueba de mapa',
        startedAt: date.getTime(),
        endedAt: date.getTime() + 1,
        exercises,
        totalSets: exercises.length,
        volumeKg: 200 * exercises.length,
        prs: [],
      }
    })

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('ferro')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('workouts', 'readwrite')
        rows.forEach((row) => transaction.objectStore('workouts').put(row))
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  })

  await page.goto('./analisis')
  const map = page.getByLabel('Mapa de frecuencia muscular')
  await expect(map).toBeVisible()
  return map
}

async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
      })
    }
  })
}

async function expectDecodedImages(map: ReturnType<Page['getByLabel']>) {
  const decoded = await map.locator('image').evaluateAll(async (nodes) => Promise.all(nodes.map(async (node) => {
    const image = new Image()
    const source = node.getAttribute('href')
    if (!source) return false
    image.src = source
    try {
      await image.decode()
      return image.naturalWidth === 492 && image.naturalHeight === 1074
    } catch {
      return false
    }
  })))
  expect(decoded).not.toContain(false)
}

test('el mapa anatómico aparece también sin entrenamientos', async ({ page }) => {
  await page.goto('./analisis')

  const map = page.getByLabel('Mapa de frecuencia muscular')
  await expect(page.getByRole('heading', { name: 'Actividad muscular · 7 días' })).toBeVisible()
  await expect(map.getByRole('button', { name: 'Pecho: 0 días, 0 series' })).toBeVisible()
  await expect(map.getByRole('status')).toHaveText('Sin actividad registrada en estos siete días.')
  await expect(map.locator('figure')).toHaveCount(2)
  expect(await map.locator('[data-muscle]').evaluateAll((nodes) => nodes.every((node) => node.getAttribute('opacity') === '0'))).toBe(true)
  await expect(map.getByRole('button')).toHaveCount(11)
})

test('comprobaciones comunes: imágenes, regiones, selección, cifras y viewport', async ({ page }, testInfo) => {
  const map = await seedTemporaryHistory(page)

  await expect(map.getByRole('button', { name: 'Pecho: 3 días, 3 series' })).toBeVisible()
  await expect(map.getByRole('button', { name: 'Espalda: 2 días, 2 series' })).toBeVisible()
  await expect(map.getByRole('button')).toHaveCount(11)
  await expect(map.locator('figure')).toHaveCount(2)
  await expect(map.locator('[data-muscle-region="chest"][data-view="front"]')).toHaveCount(1)
  await expectDecodedImages(map)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // Captura de viewport real: el componente completo es más alto que algunos móviles.
  await map.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `artifacts/anatomy/app-heatmap-${testInfo.project.name}-anatomy.png`, fullPage: false })

  await map.getByRole('button', { name: 'Pecho: 3 días, 3 series' }).click()
  await expect(map.getByRole('status')).toHaveText('Pecho · 3 días · 3 series')
  await expect(map.getByRole('button', { name: 'Pecho: 3 días, 3 series' })).toHaveAttribute('aria-pressed', 'true')

  await map.getByRole('button', { name: 'Hombros: 0 días, 0 series' }).click()
  await expect(map.getByRole('status')).toHaveText('Hombros · 0 días · 0 series')
  await expect(map.locator('[data-muscle-selection="shoulders"]')).toHaveCount(2)
  await page.screenshot({ path: `artifacts/anatomy/app-heatmap-${testInfo.project.name}-detail.png`, fullPage: false })
})

test('interacción de la página abierta tras cortar la red (señal limitada en WebKit)', async ({ page, context }, testInfo) => {
  const map = await seedTemporaryHistory(page)
  await context.setOffline(true)

  if (testInfo.project.name === 'webkit-iphone') {
    testInfo.annotations.push({
      type: 'limitación',
      description: 'WebKit 1.62.1 permite esta interacción con la página abierta, pero su recarga/fetch offline devuelve error interno o Load failed en Windows.',
    })
  }

  await map.getByRole('button', { name: 'Espalda: 2 días, 2 series' }).click()
  await expect(map.getByRole('status')).toHaveText('Espalda · 2 días · 2 series')
})

test('Chromium recarga, navega y lee el GLB offline', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-android', 'La recarga PWA offline queda validada solo en Chromium')

  await seedTemporaryHistory(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Entrenar' })).toBeVisible()
  await page.goto('./analisis')
  const map = page.getByLabel('Mapa de frecuencia muscular')
  await expect(map.getByRole('button', { name: 'Pecho: 3 días, 3 series' })).toBeVisible()
  await waitForServiceWorker(page)

  const cached = await page.evaluate(async (assets) => Promise.all(assets.map(async (name) => (
    !!await caches.match(new URL(`anatomy/${name}`, document.baseURI), { ignoreSearch: true })
  ))), anatomyAssets)
  expect(cached).not.toContain(false)

  await context.setOffline(true)
  await page.reload()
  await expect(map.getByRole('button', { name: 'Pecho: 3 días, 3 series' })).toBeVisible()
  await map.getByRole('button', { name: 'Espalda: 2 días, 2 series' }).click()
  await expect(map.getByRole('status')).toHaveText('Espalda · 2 días · 2 series')

  const glbMagic = await page.evaluate(async () => {
    const response = await fetch(new URL('anatomy/body.glb', document.baseURI))
    const data = await response.arrayBuffer()
    return new DataView(data).getUint32(0, true)
  })
  expect(glbMagic).toBe(0x46546c67)
})
