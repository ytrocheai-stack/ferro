// GitHub Pages no tiene rewrites de SPA: servir index.html como 404.html
// hace que las rutas profundas (/historial, /ejercicios/0001…) carguen la app.
import { copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'))
console.log('dist/404.html creado (fallback SPA para GitHub Pages)')
