/** Redimensiona una imagen a máx. 1080px de lado mayor y la comprime a JPEG. */
export async function resizeImageToBlob(file: File | Blob, maxSide = 1080, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas no disponible')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('No se pudo procesar la imagen')
  return blob
}

const urlCache = new WeakMap<Blob, string>()

/** Object URL con caché por Blob (evita recrear en cada render). */
export function blobUrl(blob: Blob): string {
  let url = urlCache.get(blob)
  if (!url) {
    url = URL.createObjectURL(blob)
    urlCache.set(blob, url)
  }
  return url
}
