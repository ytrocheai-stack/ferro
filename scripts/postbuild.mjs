// GitHub Pages no tiene rewrites de SPA: servir index.html como 404.html
// hace que las rutas profundas (/historial, /ejercicios/0001…) carguen la app.
import { copyFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.NEXTREP_BUILD_DIR || 'dist')
copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'))
const commit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
writeFileSync(path.join(dist, 'version.json'), JSON.stringify({ commit, builtAt: new Date().toISOString() }) + '\n')
console.log('dist/404.html creado (fallback SPA para GitHub Pages)')
