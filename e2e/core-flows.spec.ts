import { test, expect } from '@playwright/test'

test.describe('flujos principales Android', () => {
  test('crea un entreno, registra una serie y lo guarda en historial', async ({ page }) => {
    await page.goto('./')
    await page.getByRole('button', { name: 'Empezar entreno vacío' }).click()
    await page.getByPlaceholder('Nombre del entreno').fill('Entreno Android')

    await page.getByRole('button', { name: 'Añadir ejercicios' }).click()
    await expect(page.getByRole('heading', { name: 'Añadir ejercicios' })).toBeVisible()
    await page.getByPlaceholder('Buscar ejercicio…').fill('barbell bench press')
    await page.getByRole('button', { name: /barbell bench press/i }).click()
    await page.getByRole('button', { name: 'Añadir 1 ejercicio' }).click()

    await expect(page.getByRole('link', { name: 'barbell bench press' }).last()).toBeVisible()
    await page.locator('input[inputmode="decimal"]').first().fill('60')
    await page.locator('input[inputmode="numeric"]').first().fill('8')
    await page.getByRole('button', { name: 'Completar serie' }).first().click()
    await page.getByRole('button', { name: 'Finalizar' }).click()
    await page.getByRole('button', { name: 'Finalizar entreno' }).click()

    await expect(page).toHaveURL(/\/historial\/[^/]+\?nuevo=1/)
    await expect(page.getByRole('heading', { name: 'Entreno Android' })).toBeVisible()
  })

  test('crea una rutina con un ejercicio y la inicia', async ({ page }) => {
    await page.goto('./rutina/nueva')
    await expect(page.getByRole('heading', { name: 'Nueva rutina' })).toBeVisible()
    await page.getByPlaceholder(/Nombre de la rutina/).fill('Rutina Android')
    await page.getByRole('button', { name: 'Añadir ejercicios' }).click()
    await page.getByPlaceholder('Buscar ejercicio…').fill('barbell bench press')
    await page.getByRole('button', { name: /barbell bench press/i }).click()
    await page.getByRole('button', { name: 'Añadir 1 ejercicio' }).click()
    await page.getByRole('button', { name: 'Guardar' }).click()

    await expect(page.getByText('Rutina Android', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Empezar rutina' }).click()
    await expect(page.getByPlaceholder('Nombre del entreno')).toHaveValue('Rutina Android')
  })

  test('registra una medida y muestra el historial de ese tipo', async ({ page }) => {
    await page.goto('./medidas')
    await expect(page.getByRole('heading', { name: 'Medidas' })).toBeVisible()
    await page.getByRole('button', { name: 'Registrar medida' }).click()
    await expect(page.getByRole('heading', { name: 'Registrar medida' })).toBeVisible()
    await page.getByLabel(/Valor \(kg\)/).fill('75.5')
    await page.getByRole('button', { name: 'Guardar' }).click()

    const weightRow = page.getByRole('button', { name: /^Peso / })
    await expect(weightRow).toBeVisible()
    await expect(page.getByText('75.5 kg', { exact: true })).toBeVisible()
    await weightRow.click()
    await expect(page.getByRole('heading', { name: 'Peso' })).toBeVisible()
  })

  test('alterna las vistas de lista y calendario del historial', async ({ page }) => {
    await page.goto('./perfil')
    await page.getByRole('button', { name: /Importar datos de Hevy/ }).click()
    await page.locator('input[type="file"][accept*=".csv"]').setInputFiles('e2e/fixtures/hevy-workouts.csv')
    await expect(page.getByText(/Hevy importado: 1 registros/)).toBeVisible()
    await page.goto('./historial')
    await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible()
    await page.getByRole('button', { name: 'Calendario' }).click()
    await expect(page.getByRole('button', { name: 'Calendario' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Mes anterior' })).toBeVisible()
    await page.getByRole('button', { name: 'Lista' }).click()
    await expect(page.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Upper A', { exact: true })).toBeVisible()
  })

  test('busca en el catálogo y crea un ejercicio personalizado', async ({ page }) => {
    await page.goto('./ejercicios')
    await expect(page.getByRole('heading', { name: 'Ejercicios' })).toBeVisible()
    await expect(page.getByText(/ejercicios$/).first()).toBeVisible({ timeout: 10_000 })
    await page.getByPlaceholder('Buscar ejercicio…').fill('barbell bench press')
    await expect(page.getByText('barbell bench press', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Nuevo$/ }).click()
    await expect(page.getByRole('heading', { name: 'Nuevo ejercicio personalizado' })).toBeVisible()
    await page.getByPlaceholder(/Press banca agarre cerrado/).fill('Press Android personalizado')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await page.getByPlaceholder('Buscar ejercicio…').fill('')
    await page.getByRole('button', { name: 'Míos' }).click()
    await expect(page.getByRole('link', { name: /Press Android personalizado/ })).toBeVisible()
  })

  test('registra un alimento local en el diario nutricional', async ({ page }) => {
    await page.goto('./nutricion')
    const wizardHeading = page.getByRole('heading', { name: 'Calcular mis objetivos' })
    await wizardHeading.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
    const closeWizard = page.getByRole('button', { name: 'Cerrar' })
    if (await closeWizard.isVisible()) {
      await page.getByRole('textbox', { name: 'Peso kg' }).fill('75')
      await page.getByRole('button', { name: 'Guardar objetivos' }).click()
      await expect(closeWizard).toBeHidden()
    }
    await page.getByRole('button', { name: /Añadir alimento|Añadir/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Añadir alimento' })).toBeVisible()
    await page.getByPlaceholder('Buscar alimento…').fill('avena')
    const food = page.getByRole('button', { name: /avena/i }).first()
    await expect(food).toBeVisible()
    await food.click()
    await expect(page.getByRole('heading', { name: /avena/i })).toBeVisible()
    await page.getByLabel('Cantidad (g)').fill('50')
    await page.getByRole('button', { name: /Añadir|Guardar/ }).last().click()
    await expect(page.getByText(/avena/i).first()).toBeVisible()
  })
})
