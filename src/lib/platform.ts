/** true en iOS/iPadOS (Safari y cualquier navegador basado en WebKit en iOS). */
export function isIOS(): boolean {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ se identifica como Mac en el user-agent, pero soporta multitáctil (un Mac real no).
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** true si la app ya corre instalada en modo standalone (añadida a pantalla de inicio). */
export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}
