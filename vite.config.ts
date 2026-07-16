import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Base '/ferro/' en producción (GitHub Pages) y en `vite preview`; '/' en dev
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/ferro/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Ferro — Registro de entrenos',
        short_name: 'Ferro',
        description: 'Registro de entrenamientos de gimnasio, 100% offline',
        lang: 'es',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0b0f',
        theme_color: '#0b0b0f',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache: shell + JSON de ejercicios + todas las miniaturas (~15 MB)
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}', 'data/exercises.json', 'images/*.jpg'],
        // Los GIFs (~130 MB) NO se precachean: caché en tiempo de ejecución
        globIgnores: ['videos/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/\.(?:jpg|gif|json)$/],
        runtimeCaching: [
          {
            urlPattern: /\/videos\/.+\.gif$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gifs',
              expiration: { maxEntries: 1500, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
}))
