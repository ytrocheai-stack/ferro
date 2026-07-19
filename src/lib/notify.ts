/** Vibración, sonido y notificación para el fin del descanso. */

export function vibrate(pattern: number | number[] = [250, 120, 250]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* no soportado */
  }
}

let audioCtx: AudioContext | null = null

/**
 * iOS solo permite crear/reanudar el `AudioContext` dentro de un gesto de usuario; el bip del
 * temporizador se dispara desde un `setTimeout` (sin gesto), así que sin este "desbloqueo" previo
 * el contexto queda `suspended` y no suena nunca. Llamar una vez con el primer toque de la app.
 */
export function unlockAudio() {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {
    /* sin audio */
  }
}

/** Doble bip corto con WebAudio (no requiere assets). */
export function beep() {
  try {
    audioCtx ??= new AudioContext()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + dur + 0.05)
    }
    tone(880, 0, 0.18)
    tone(1175, 0.22, 0.25)
  } catch {
    /* sin audio */
  }
}

export async function ensureNotifyPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

/** En Android las notificaciones de página no existen: usar el SW si está disponible. */
export async function notify(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, { body, tag: 'ferro-rest', silent: false })
      return
    }
  } catch {
    /* sigue el fallback */
  }
  try {
    new Notification(title, { body })
  } catch {
    /* no soportado */
  }
}
