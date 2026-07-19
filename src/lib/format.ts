import { format, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'

export const KG_PER_LB = 0.45359237

export function kgToDisplay(kg: number, units: 'kg' | 'lb'): number {
  const v = units === 'kg' ? kg : kg / KG_PER_LB
  return Math.round(v * 100) / 100
}

export function displayToKg(value: number, units: 'kg' | 'lb'): number {
  return units === 'kg' ? value : value * KG_PER_LB
}

export function formatWeight(kg: number, units: 'kg' | 'lb'): string {
  const v = kgToDisplay(kg, units)
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, '')
  return `${s} ${units}`
}

/** '45 min' / '1 h 12 min' — para duración de entrenos */
export function formatDuration(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** 'mm:ss' o 'h:mm:ss' — para cronómetros */
export function clock(sec: number): string {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`
}

export function formatDay(ts: number): string {
  const d = new Date(ts)
  if (isToday(d)) return 'Hoy'
  if (isYesterday(d)) return 'Ayer'
  return format(d, "EEEE d 'de' MMMM", { locale: es })
}

export function formatMonth(ts: number): string {
  const s = format(new Date(ts), 'MMMM yyyy', { locale: es })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatShortDate(ts: number): string {
  return format(new Date(ts), 'd MMM yyyy', { locale: es })
}

export function formatTime(ts: number): string {
  return format(new Date(ts), 'HH:mm')
}

/** minúsculas y sin acentos, para búsqueda */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

const nfEs = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

/** Volumen con separador de miles: '12.345 kg' */
export function formatVolume(kg: number, units: 'kg' | 'lb'): string {
  return `${nfEs.format(Math.round(kgToDisplay(kg, units)))} ${units}`
}

/** UUID v4. `crypto.randomUUID` no existe en iOS < 15.4; fallback con `getRandomValues`. */
export function uid(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Convierte un input numérico de texto aceptando coma decimal española ("12,5" -> 12.5). */
export function parseDec(s: string): number {
  const n = parseFloat(s.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Descarga un archivo o, si el navegador soporta compartir archivos (Web Share API), abre la
 * hoja nativa de compartir/"Guardar en Archivos" — en iOS, `<a download>` dentro de una PWA
 * instalada suele abrir el archivo en vez de descargarlo, así que ahí es la única vía fiable.
 */
export async function shareOrDownloadFile(blob: Blob, filename: string, mimeType: string) {
  const file = new File([blob], filename, { type: mimeType })
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // el usuario canceló
      // cualquier otro fallo: seguir con la descarga normal
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
