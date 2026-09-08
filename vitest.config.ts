import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': fileURLToPath(new URL('./worker/src/cloudflare-workers.test-stub.ts', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}', 'worker/**/*.test.{ts,tsx}'],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
  },
})
