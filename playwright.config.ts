import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'coach-agent.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/ferro/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    // El E2E general es offline y no tiene sesión Clerk. La producción mantiene
    // el gate porque usa sus variables públicas reales al construir.
    env: { VITE_CLERK_PUBLISHABLE_KEY: '', VITE_ADAPTATION_WORKER_URL: '' },
    url: 'http://127.0.0.1:4173/ferro/',
    // El config del coach compila con un mock de Clerk distinto; nunca reutilizar
    // ese preview para evitar contaminar el gate de sesión del E2E general.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium-android', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] } },
  ],
})
