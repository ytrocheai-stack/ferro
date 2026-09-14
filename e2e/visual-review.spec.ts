import { test, expect } from '@playwright/test'

const viewports = [
  { name: '320x568', width: 320, height: 568 },
  { name: '393x852', width: 393, height: 852 },
  { name: '430x932', width: 430, height: 932 },
  { name: '1024x768', width: 1024, height: 768 },
]
const routes = [
  { name: 'home', path: './', heading: 'Entrenar' },
  { name: 'nutrition', path: './nutricion', heading: 'Nutrición' },
  { name: 'progress', path: './analisis', heading: 'Progreso' },
  { name: 'profile', path: './perfil', heading: 'Perfil' },
]

test('revisión visual responsive de las superficies principales', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const theme of ['light', 'dark'] as const) {
      await page.addInitScript(({ theme: nextTheme }) => {
        localStorage.setItem('ferro-settings', JSON.stringify({ state: { theme: nextTheme }, version: 0 }))
      }, { theme })
      for (const route of routes) {
        await page.goto(route.path)
        await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible()
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({
          path: `artifacts/visual-review/${testInfo.project.name}/${theme}/${route.name}-${viewport.name}.png`,
          fullPage: false,
        })
      }
    }
  }
})
