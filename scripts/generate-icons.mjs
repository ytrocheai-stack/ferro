// Genera los íconos PWA (PNG) y el favicon (SVG) a partir de un SVG inline.
// Los resultados se commitean en public/ para no depender de sharp en CI.
import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(publicDir, { recursive: true })

// Mancuerna rotada 45° sobre fondo oscuro. `rx`: radio de esquinas del fondo;
// `s`: escala del dibujo (los íconos maskable necesitan margen de seguridad).
const icon = (rx, s) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rx}" fill="#0e0e13"/>
  <g transform="translate(256 256) scale(${s}) rotate(-45) translate(-256 -256)">
    <rect x="116" y="242" width="280" height="28" rx="14" fill="#dcdce2"/>
    <rect x="148" y="182" width="44" height="148" rx="18" fill="#3d8bfd"/>
    <rect x="320" y="182" width="44" height="148" rx="18" fill="#3d8bfd"/>
    <rect x="96" y="202" width="34" height="108" rx="14" fill="#2f6fe0"/>
    <rect x="382" y="202" width="34" height="108" rx="14" fill="#2f6fe0"/>
  </g>
</svg>`

const png = (svg, size, name) =>
  sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(publicDir, name))

await png(icon(112, 1), 192, 'pwa-192x192.png')
await png(icon(112, 1), 512, 'pwa-512x512.png')
await png(icon(0, 0.72), 512, 'pwa-maskable-512.png')
await png(icon(0, 0.9), 180, 'apple-touch-icon.png')
writeFileSync(path.join(publicDir, 'favicon.svg'), icon(112, 1).trim())
console.log('Íconos generados en public/')
