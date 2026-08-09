import { useEffect, useState } from 'react'
import { format } from 'date-fns'

export function localDateKey(value: Date | number = new Date()): string {
  return format(value, 'yyyy-MM-dd')
}

/** Actualiza la fecha local al cruzar medianoche y al volver del background. */
export function useLocalDateKey(): string {
  const [key, setKey] = useState(() => localDateKey())

  useEffect(() => {
    let timer: number | undefined
    const sync = () => {
      setKey(localDateKey())
      const now = new Date()
      const next = new Date(now)
      next.setHours(24, 0, 0, 100)
      timer = window.setTimeout(sync, Math.max(250, next.getTime() - now.getTime()))
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync()
    }
    sync()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return key
}
