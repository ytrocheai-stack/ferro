import { useEffect, useRef, useState } from 'react'
import type { Exercise } from '../data/exercises'
import { mediaUrl } from '../data/exercises'
import { IconDumbbell } from './icons'

/**
 * Miniatura de ejercicio con lazy-loading manual (IntersectionObserver).
 * No se usa `loading="lazy"` porque Chromium no dispara esas cargas sin
 * conexión, aunque el service worker tenga la imagen en caché.
 */
export function ExerciseThumb({
  exercise,
  size = 48,
  gif = false,
  lazy = false,
  className = '',
}: {
  exercise: Exercise | undefined
  size?: number
  /** intenta mostrar el GIF animado (cae a la miniatura si falla u offline) */
  gif?: boolean
  /** carga diferida hasta acercarse al viewport (para listas largas) */
  lazy?: boolean
  className?: string
}) {
  const [gifFailed, setGifFailed] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const [visible, setVisible] = useState(!lazy)
  const holderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible) return
    const el = holderRef.current
    if (!el) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '800px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  const gifSrc = gif && !gifFailed ? mediaUrl(exercise?.gif) : null
  const imgSrc = !imgFailed ? mediaUrl(exercise?.image) : null
  const src = gifSrc ?? imgSrc

  if (!src || !visible) {
    return (
      <div
        ref={holderRef}
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted ${className}`}
      >
        {!src && <IconDumbbell size={Math.max(16, size * 0.45)} />}
      </div>
    )
  }
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={exercise?.name ?? ''}
      onError={() => (gifSrc ? setGifFailed(true) : setImgFailed(true))}
      className={`shrink-0 rounded-xl bg-white object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
