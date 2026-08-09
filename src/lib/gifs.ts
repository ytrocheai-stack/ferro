import type { Exercise } from '../data/exercises'
import { mediaUrl } from '../data/exercises'

/** Debe coincidir con `cacheName` en vite.config.ts (runtimeCaching). */
export const GIF_CACHE = 'gifs'

export interface GifCacheStatus {
  cached: number
  total: number
  complete: boolean
}

function canonicalGifPath(value: string): string {
  const clean = value.split(/[?#]/, 1)[0].replace(/\\/g, '/')
  const marker = clean.lastIndexOf('/videos/')
  if (marker >= 0) return clean.slice(marker + 1)
  return clean.replace(/^\.?\//, '').replace(/^\/+/, '')
}

/** Compara el catálogo vigente con URLs reales de caché; entradas antiguas no inflan el avance. */
export function gifCacheStatus(all: Exercise[], cachedUrls: string[]): GifCacheStatus {
  const required = new Set(
    all
      .filter((exercise) => exercise.gif && !exercise.custom)
      .map((exercise) => canonicalGifPath(exercise.gif!)),
  )
  const available = new Set(cachedUrls.map(canonicalGifPath))
  let cached = 0
  for (const path of required) if (available.has(path)) cached++
  const total = required.size
  return { cached, total, complete: total > 0 && cached === total }
}

export async function getGifCacheStatus(all: Exercise[]): Promise<GifCacheStatus> {
  try {
    if (!('caches' in window)) return gifCacheStatus(all, [])
    const cache = await caches.open(GIF_CACHE)
    const keys = await cache.keys()
    return gifCacheStatus(all, keys.map((request) => request.url))
  } catch {
    return gifCacheStatus(all, [])
  }
}

export async function cachedGifCount(): Promise<number> {
  try {
    if (!('caches' in window)) return 0
    const c = await caches.open(GIF_CACHE)
    return (await c.keys()).length
  } catch {
    return 0
  }
}

/** Calienta la caché del service worker pidiendo todos los GIFs (CacheFirst). */
export async function downloadAllGifs(
  all: Exercise[],
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean,
): Promise<void> {
  const queue = all.filter((e) => e.gif && !e.custom).map((e) => mediaUrl(e.gif)!)
  const total = queue.length
  let done = 0
  const worker = async () => {
    while (queue.length > 0) {
      if (shouldStop()) return
      const url = queue.shift()!
      try {
        const res = await fetch(url)
        await res.blob() // consumir el cuerpo para que el SW complete el cacheo
      } catch {
        /* fallo puntual: se puede reintentar después */
      }
      done++
      onProgress(done, total)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
}
