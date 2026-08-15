import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('la navegación principal funciona en un viewport móvil', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Entrenar' })).toBeVisible()
  await page.getByRole('link', { name: 'Ejercicios' }).click()
  await expect(page.getByRole('heading', { name: 'Ejercicios' })).toBeVisible()
  await expect(page.getByText(/ejercicios|Cargando biblioteca/).first()).toBeVisible()
})

test('el panel de importación Hevy expone controles accesibles', async ({ page }) => {
  await page.goto('./perfil')
  await page.getByRole('button', { name: /Importar datos de Hevy/ }).click()
  await expect(page.getByRole('heading', { name: 'Importar desde Hevy' })).toBeVisible()
  await expect(page.getByLabel('API key')).toHaveAttribute('type', 'password')
})

test('importa el dialecto real del CSV de Hevy', async ({ page }) => {
  await page.goto('./perfil')
  await page.getByRole('button', { name: /Importar datos de Hevy/ }).click()
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles('e2e/fixtures/hevy-workouts.csv')
  await expect(page.getByText(/Hevy importado: 1 registros y 2 series/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Deshacer última importación/ })).toBeVisible()
})

test('la importación Hevy es idempotente y se puede deshacer tras recargar', async ({ page }) => {
  await page.goto('./perfil')
  const importButton = page.getByRole('button', { name: /Importar datos de Hevy/ })
  await importButton.click()
  const input = page.locator('input[type="file"][accept*=".csv"]')
  await input.setInputFiles('e2e/fixtures/hevy-workouts.csv')
  await expect(page.getByText(/Hevy importado: 1 registros/)).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: /Deshacer última importación/ })).toBeVisible()
  await page.getByRole('button', { name: /Deshacer última importación/ }).click()
  await expect(page.getByText('Importación de Hevy deshecha.')).toBeVisible()
  await expect(page.getByText('Entrenos0', { exact: true })).toBeVisible()
})

test('un archivo binario con extensión CSV muestra un error accionable', async ({ page }) => {
  await page.goto('./perfil')
  await page.getByRole('button', { name: /Importar datos de Hevy/ }).click()
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({
    name: 'workout_data.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('PK\u0003\u0004[Content_Types].xml'),
  })
  await expect(page.getByRole('alert')).toContainText(/Excel|XLSX|CSV válido/)
  await expect(page.getByRole('alert')).not.toContainText(/Content_Types|workbook\.xml/)
})

test('exporta las series en un CSV descargable desde Android', async ({ page }) => {
  await page.goto('./perfil')
  await page.getByRole('button', { name: /Importar datos de Hevy/ }).click()
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles('e2e/fixtures/hevy-workouts.csv')
  await expect(page.getByText(/Hevy importado: 1 registros/)).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar series a CSV' }).click()
  await expect((await download).suggestedFilename()).toMatch(/^nextrep-series-\d{4}-\d{2}-\d{2}\.csv$/)
})

test('la pantalla inicial no tiene violaciones axe críticas', async ({ page }) => {
  await page.goto('./')
  const result = await new AxeBuilder({ page }).analyze()
  expect(result.violations.filter((violation) => violation.impact === 'critical')).toEqual([])
})

test('Análisis permite cambiar el periodo sin perder el contexto', async ({ page }) => {
  await page.goto('./analisis')
  await expect(page.getByRole('heading', { name: 'Análisis' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Periodo de análisis' })).toBeVisible()
  await expect(page.getByRole('button', { name: '8 semanas', pressed: true })).toBeVisible()
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
