import type { Exercise } from '../data/exercises'
import { mediaUrl } from '../data/exercises'

/** Debe coincidir con `cacheName` en vite.config.ts (runtimeCaching). */
export const GIF_CACHE = 'gifs'

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
