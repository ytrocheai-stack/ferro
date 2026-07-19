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
        name: 'NextRep — Registro de entrenos',
        short_name: 'NextRep',
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
          {
            // Búsqueda de alimentos (Open Food Facts): red primero, caché como
            // respaldo si no hay conexión (los resultados también se guardan en Dexie).
            urlPattern: /^https:\/\/es\.openfoodfacts\.org\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'openfoodfacts',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
}))
