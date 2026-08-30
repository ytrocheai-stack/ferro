import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}', 'worker/**/*.test.{ts,tsx}'],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
  },
})
