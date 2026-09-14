import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, readThemePreference, resolveTheme } from './theme'

describe('preferencia de apariencia', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
    document.documentElement.style.colorScheme = ''
    document.head.innerHTML = '<meta name="theme-color" content="#F3F0EA" />'
  })

  it('mantiene system cuando el backup local es antiguo o no tiene theme', () => {
    const storage = new Map<string, string>()
    const read = { getItem: (key: string) => storage.get(key) ?? null } as Storage
    expect(readThemePreference(read)).toBe('system')
    storage.set('ferro-settings', JSON.stringify({ state: { units: 'kg' }, version: 0 }))
    expect(readThemePreference(read)).toBe('system')
  })

  it('lee y aplica una elección persistida sin romper datos corruptos', () => {
    const storage = new Map<string, string>([['ferro-settings', JSON.stringify({ state: { theme: 'dark' } })]])
    const read = { getItem: (key: string) => storage.get(key) ?? null } as Storage
    expect(readThemePreference(read)).toBe('dark')
    expect(applyTheme('dark')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themePreference).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#171715')
    storage.set('ferro-settings', '{bad json')
    expect(readThemePreference(read)).toBe('system')
  })

  it('resuelve system según el sistema y respeta elecciones explícitas', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
