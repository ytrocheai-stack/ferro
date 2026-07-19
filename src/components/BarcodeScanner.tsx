import { useEffect, useRef, useState } from 'react'
import { IconBarcode } from './icons'

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike
  }
}

/** Escáner de código de barras con la cámara. Si la API no está disponible
 *  (iOS Safari, navegadores viejos), cae a entrada manual del código. */
export function BarcodeScanner({ onDetect }: { onDetect: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window
  // ref para no reiniciar la cámara cuando el padre re-renderiza con un callback nuevo
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  useEffect(() => {
    if (!supported) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        const detector = new window.BarcodeDetector!({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
        })
        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes[0]) {
              onDetectRef.current(codes[0].rawValue)
              return
            }
          } catch {
            /* frame no válido aún, seguir intentando */
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        setError('No se pudo acceder a la cámara. Ingresa el código manualmente.')
      }
    }
    void start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [supported])

  if (!supported || error) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <IconBarcode size={32} className="text-muted" />
        <p className="text-sm text-muted">
          {error ?? 'Tu navegador no soporta el escáner automático. Ingresa el código de barras a mano.'}
        </p>
        <div className="flex w-full gap-2">
          <input
            className="input"
            inputMode="numeric"
            placeholder="Código de barras (EAN)"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button className="btn btn-primary px-4" disabled={!manual.trim()} onClick={() => onDetect(manual.trim())}>
            Buscar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
      <p className="bg-black py-2 text-center text-xs text-white/70">Apunta al código de barras del producto</p>
    </div>
  )
}
