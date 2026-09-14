import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('la navegación principal funciona en un viewport móvil', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Entrenar' })).toBeVisible()
  await page.getByRole('link', { name: 'Biblioteca' }).click()
  await expect(page.getByRole('heading', { name: 'Biblioteca' })).toBeVisible()
  await expect(page.getByText(/ejercicios|Cargando biblioteca/).first()).toBeVisible()
})

test('el panel de importación Hevy expone controles accesibles', async ({ page }) => {
  await page.goto('./perfil')
  await page.locator('summary').filter({ hasText: 'Datos' }).click()
  await page.getByRole('button', { name: /Importar datos de Hevy/ }).click()
  await expect(page.getByRole('heading', { name: 'Importar desde Hevy' })).toBeVisible()
  await expect(page.getByLabel('API key')).toHaveAttribute('type', 'password')
})

test('la ruta del coach presenta el gate de cuenta cuando no hay sesión', async ({ page }) => {
  await page.goto('./coach')
  await expect(page.getByRole('heading', { name: 'Coach' })).toBeVisible()
  await expect(page.getByText('Inicia sesión para usar el coach privado.')).toBeVisible()
})

test('importa el dialecto real del CSV de Hevy', async ({ page }) => {
  await page.goto('./perfil')
  await page.locator('summary').filter({ hasText: 'Datos' }).click()
  await page.getByRole('button', { name: /Importar datos de Hevy/ }).click()
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles('e2e/fixtures/hevy-workouts.csv')
  await expect(page.getByText(/Hevy importado: 3 registros/)).toBeVisible()
})

test('la pantalla inicial no tiene violaciones axe críticas', async ({ page }, testInfo) => {
  // axe-core puede quedar bloqueado en la implementación de accesibilidad de
  // WebKit; la auditoría se ejecuta en Chromium y el flujo completo continúa
  // cubierto en ambos proyectos.
  test.skip(testInfo.project.name === 'webkit-iphone', 'axe-core no termina de forma determinista en WebKit')
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Entrenar' })).toBeVisible()
  const result = await new AxeBuilder({ page }).analyze()
  expect(result.violations.filter((violation) => violation.impact === 'critical')).toEqual([])
})

test('Análisis permite cambiar el periodo sin perder el contexto', async ({ page }) => {
  await page.goto('./analisis')
  await expect(page.getByRole('heading', { name: 'Progreso' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Periodo de análisis' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '8 semanas', selected: true })).toBeVisible()
})

test('Nutrición separa el diario de las tendencias', async ({ page }) => {
  await page.goto('./nutricion')
  await expect(page.getByRole('tablist', { name: 'Vista de nutrición' })).toBeVisible()
  const closeWizard = page.getByRole('button', { name: 'Cerrar' })
  if (await closeWizard.isVisible()) await closeWizard.click()
  await page.getByRole('tab', { name: 'Tendencias' }).click()
  await expect(page.getByRole('heading', { name: 'Inteligencia nutricional' })).toBeVisible()
  await expect(page.getByText('Registra comidas para ver tu patrón de ingesta')).toBeVisible()
})

test('Apariencia cambia y conserva el tema elegido', async ({ page }) => {
  await page.goto('./perfil')
  await page.getByRole('button', { name: 'Sistema', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Apariencia' })).toBeVisible()
  await page.getByRole('button', { name: 'Oscuro', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  await page.reload()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
})
