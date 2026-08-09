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

test('la pantalla inicial no tiene violaciones axe críticas', async ({ page }) => {
  await page.goto('./')
  const result = await new AxeBuilder({ page }).analyze()
  expect(result.violations.filter((violation) => violation.impact === 'critical')).toEqual([])
})
