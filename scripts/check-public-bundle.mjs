import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const forbidden = ['NVIDIA_API_KEY', 'CLERK_SECRET_KEY', 'CLERK_JWT_KEY']
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else result.push(path)
  }
  return result
}
for (const path of await files('dist')) {
  const content = await readFile(path, 'utf8')
  const found = forbidden.find((name) => content.includes(name))
  if (found) throw new Error(`Secreto detectado en el bundle público: ${found}`)
}
console.log('Bundle público verificado: no contiene nombres de secretos ni claves NVIDIA.')
