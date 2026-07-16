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

export function uid(): string {
  return crypto.randomUUID()
}
