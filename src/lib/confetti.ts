/** Confetti ligero en canvas para celebrar PRs. Sin dependencias.
 *  Respeta prefers-reduced-motion (no hace nada). */
export function fireConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  if (document.getElementById('ferro-confetti')) return

  const canvas = document.createElement('canvas')
  canvas.id = 'ferro-confetti'
  canvas.style.cssText = 'position:fixed;inset:0;z-index:100;pointer-events:none'
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }

  const colors = ['#3d8bfd', '#33c076', '#f2a33c', '#f4504f', '#a78bfa', '#f2f2f5']
  const parts = Array.from({ length: 90 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.5,
    y: canvas.height * 0.35,
    vx: (Math.random() - 0.5) * 9,
    vy: -(4 + Math.random() * 9),
    size: 4 + Math.random() * 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
  }))

  const t0 = performance.now()
  const tick = (t: number) => {
    const elapsed = t - t0
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const p of parts) {
      p.vy += 0.28
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 1600)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
      ctx.restore()
    }
    if (elapsed < 1600) requestAnimationFrame(tick)
    else canvas.remove()
  }
  requestAnimationFrame(tick)
}
