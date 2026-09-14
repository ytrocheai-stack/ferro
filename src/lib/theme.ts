export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const SETTINGS_KEY = 'ferro-settings'

export function readThemePreference(storage?: Storage): ThemePreference {
  try {
    const source = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
    const raw = source?.getItem(SETTINGS_KEY)
    if (!raw) return 'system'
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return 'system'
    const state = (parsed as { state?: unknown }).state
    if (typeof state !== 'object' || state === null) return 'system'
    const theme = (state as { theme?: unknown }).theme
    return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(preference: ThemePreference, matchesDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches): ResolvedTheme {
  return preference === 'system' ? (matchesDark ? 'dark' : 'light') : preference
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  if (typeof document === 'undefined') return resolved
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themePreference = preference
  root.style.colorScheme = resolved
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#171715' : '#F3F0EA')
  return resolved
}
