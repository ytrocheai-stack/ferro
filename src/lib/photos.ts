import { useEffect, useState } from 'react'

interface DrawableImage {
  width: number
  height: number
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  release: () => void
}

/**
 * Decodifica el archivo respetando la orientación EXIF (fotos verticales de cámara). Safari
 * necesita `imageOrientation: 'from-image'` explícito o dibuja el bitmap sin rotar; en iOS <15,
 * sin `createImageBitmap`, se recurre a un `<img>` normal (que sí orienta al decodificar).
 */
async function loadOrientedImage(file: File | Blob): Promise<DrawableImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
      release: () => bitmap.close?.(),
    }
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        release: () => URL.revokeObjectURL(url),
      }
    } catch (err) {
      URL.revokeObjectURL(url)
      throw err
    }
  }
}

/** Redimensiona una imagen a máx. 1080px de lado mayor y la comprime a JPEG. */
export async function resizeImageToBlob(file: File | Blob, maxSide = 1080, quality = 0.82): Promise<Blob> {
  const image = await loadOrientedImage(file)
  try {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
    const w = Math.round(image.width * scale)
    const h = Math.round(image.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas no disponible')
    image.draw(ctx, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error('No se pudo procesar la imagen')
    return blob
  } finally {
    image.release()
  }
}

/** Object URL ligado al ciclo de vida del componente: se revoca al desmontar o al cambiar
 *  el Blob (URL.createObjectURL sin revoke retiene el Blob en memoria indefinidamente). */
export function useBlobUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) {
      setUrl(undefined)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
