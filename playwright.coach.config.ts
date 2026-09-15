import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/coach',
  testMatch: 'coach-agent.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174/ferro/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build -- --mode e2e && npm run preview -- --host 127.0.0.1 --port 4174',
    env: { VITE_CLERK_PUBLISHABLE_KEY: '', VITE_ADAPTATION_WORKER_URL: 'http://127.0.0.1:4174/mock-worker', VITE_E2E_AGENT: 'true', NEXTREP_BUILD_DIR: '.cache/e2e/coach-dist' },
    url: 'http://127.0.0.1:4174/ferro/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium-android', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] } },
  ],
})
