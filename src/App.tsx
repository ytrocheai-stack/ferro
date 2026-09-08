import { Suspense, useEffect } from 'react'
import { Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import { Toasts } from './components/Toasts'
import { GymKeypadBar } from './components/GymKeypad'
import { PageFallback } from './components/Skeleton'
import { useActive } from './stores/activeWorkout'
import { useSettings } from './stores/settings'
import { ensurePersistentStorage } from './db/db'
import { useNow } from './lib/useNow'
import { clock } from './lib/format'
import { beep, notify, unlockAudio, vibrate } from './lib/notify'
import { IconMinus, IconPlay, IconPlus, IconX } from './components/icons'
import { AuthControls } from './components/AuthControls'
import { useAuth } from '@clerk/react'
import { cancelPendingAdaptationProcessing, processPendingAdaptationEvents, processPendingAdaptationJobs, setCoachAccountId } from './lib/adaptationClient'
import { syncPendingCoachRuns } from './lib/coachClient'

export default function App() {
  const { pathname } = useLocation()
  const hideTabs = pathname.startsWith('/entreno') || pathname.startsWith('/rutina')
  const { isLoaded, isSignedIn, getToken, userId } = useAuth()
  // Clerk por sí solo no activa el coach; el gate global se enciende cuando
  // existe un Worker configurado que puede procesar datos de la cuenta.
  const authRequired = Boolean(import.meta.env.VITE_ADAPTATION_WORKER_URL)

  useEffect(() => {
    void ensurePersistentStorage()
    // Primer toque del usuario: desbloquea WebAudio para que el bip del descanso suene en iOS.
    window.addEventListener('pointerdown', unlockAudio, { once: true })
    return () => window.removeEventListener('pointerdown', unlockAudio)
  }, [])

  useEffect(() => {
    setCoachAccountId(isSignedIn ? userId : null)
    return () => setCoachAccountId(null)
  }, [isSignedIn, userId])

  useEffect(() => {
    if (!isSignedIn) return
    const process = () => void Promise.all([processPendingAdaptationJobs(getToken, userId), processPendingAdaptationEvents(getToken, userId), syncPendingCoachRuns(getToken)])
    const onVisible = () => { if (document.visibilityState === 'visible') process() }
    process()
    window.addEventListener('online', process)
    window.addEventListener('nextrep:adaptation-wake', process)
    window.addEventListener('nextrep:coach-consent-changed', process)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.removeEventListener('online', process); window.removeEventListener('nextrep:adaptation-wake', process); window.removeEventListener('nextrep:coach-consent-changed', process); document.removeEventListener('visibilitychange', onVisible); cancelPendingAdaptationProcessing(userId) }
  }, [getToken, isSignedIn, userId])

  if (authRequired && !isLoaded) return <AuthRequiredScreen loading />
  if (authRequired && !isSignedIn) return <AuthRequiredScreen />

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md pt-[env(safe-area-inset-top)]">
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <header className="flex items-center justify-between px-4 pb-1 pt-3">
        <span className="text-sm font-extrabold tracking-tight text-text">NextRep</span>
        <AuthControls />
      </header>
      <main id="main-content" key={pathname} className="page-enter" tabIndex={-1}>
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <div className={hideTabs ? 'h-8' : 'app-nav-spacer'} aria-hidden="true" />
      <ScrollRestoration />
      <RestTimerOverlay hideTabs={hideTabs} />
      <ActiveBanner hideTabs={hideTabs} />
      {!hideTabs && <TabBar />}
      <Toasts hideTabs={hideTabs} />
      <GymKeypadBar />
      <CoachPrivacyNotice />
    </div>
  )
}

function AuthRequiredScreen({ loading = false }: { loading?: boolean }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-5">
      <section className="card w-full px-5 py-6 text-center" aria-labelledby="auth-required-title">
        <h1 id="auth-required-title" className="text-lg font-extrabold text-text">NextRep requiere una cuenta</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{loading ? 'Comprobando tu sesión…' : 'Inicia sesión para acceder a tus entrenamientos y mantener aislados los datos del coach.'}</p>
        {!loading && <div className="mt-4"><AuthControls /></div>}
      </section>
    </div>
  )
}

function CoachPrivacyNotice() {
  const { isSignedIn } = useAuth()
  if (!isSignedIn || !import.meta.env.VITE_ADAPTATION_WORKER_URL) return null
  return <p className="sr-only">El coach solo comparte el contexto tras tu consentimiento: perfil, objetivos, restricciones, rutinas, hasta seis entrenamientos terminados y conversación. Las conversaciones se guardan localmente; el backend conserva temporalmente el contexto necesario para ejecutar y repetir la solicitud. No guarda JWT, correo ni nombre.</p>
}

/** Barra "entreno en curso" visible fuera de la pantalla de sesión. */
function ActiveBanner({ hideTabs }: { hideTabs: boolean }) {
  const session = useActive((s) => s.session)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onSession = pathname.startsWith('/entreno')
  const now = useNow(1000, !!session && !onSession)
  if (!session || onSession) return null

  const bottom = hideTabs
    ? 'calc(0.5rem + env(safe-area-inset-bottom))'
    : 'calc(5.6rem + env(safe-area-inset-bottom))'
  return (
    <div className="fixed inset-x-0 z-40" style={{ bottom }}>
      <button
        onClick={() => navigate('/entreno')}
        className="pressable mx-auto flex w-[calc(100%-1.5rem)] max-w-md items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-white shadow-lg shadow-black/40"
      >
        <IconPlay size={18} />
        <span className="min-w-0 flex-1 truncate text-left font-semibold">
          {session.editingWorkoutId ? `Editando: ${session.name}` : session.name}
        </span>
        {!session.editingWorkoutId && (
          <span className="font-mono text-sm tabular-nums">
            {clock((now - session.startedAt) / 1000)}
          </span>
        )}
        <span className="rounded-lg bg-white/20 px-2 py-1 text-xs font-bold">Reanudar</span>
      </button>
    </div>
  )
}

/** Temporizador de descanso flotante, global para sobrevivir a la navegación. */
function RestTimerOverlay({ hideTabs }: { hideTabs: boolean }) {
  const rest = useActive((s) => s.rest)
  const session = useActive((s) => s.session)
  const skipRest = useActive((s) => s.skipRest)
  const adjustRest = useActive((s) => s.adjustRest)
  const { pathname } = useLocation()
  const now = useNow(250, !!rest)

  // aviso exacto al terminar (por timestamp, no por ticks)
  useEffect(() => {
    if (!rest) return
    let fired = false
    const fire = () => {
      if (fired) return
      fired = true
      const { sound, vibration, restNotification } = useSettings.getState()
      if (vibration) vibrate([300, 120, 300])
      if (sound) beep()
      if (restNotification) void notify('Descanso terminado', '¡A por la siguiente serie! 💪')
      useActive.getState().skipRest()
    }
    const ms = rest.endsAt - Date.now()
    if (ms <= 0) {
      fire()
      return
    }
    const t = setTimeout(fire, ms)
    // iOS congela los timers en segundo plano: al volver a primer plano, comprobar por
    // timestamp si el descanso ya venció y avisar de inmediato en vez de esperar a que el
    // `setTimeout`, ya vencido, se reprograme.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= rest.endsAt) fire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [rest])

  if (!rest) return null

  const remaining = Math.max(0, (rest.endsAt - now) / 1000)
  const pct = Math.max(0, Math.min(100, (remaining / rest.totalSec) * 100))
  const urgent = remaining <= 10
  const onSession = pathname.startsWith('/entreno')
  const bannerVisible = !!session && !onSession
  const base = hideTabs && !onSession ? 8 : onSession ? 8 : 90
  const offset = base + (bannerVisible ? 60 : 0)

  return (
    <div
      className="fixed inset-x-0 z-40"
      style={{ bottom: `calc(${offset}px + env(safe-area-inset-bottom))` }}
    >
      <div className="mx-auto w-[calc(100%-1.5rem)] max-w-md overflow-hidden rounded-2xl border border-border bg-surface-2 shadow-lg shadow-black/40">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            className="pressable rounded-lg bg-surface px-2.5 py-1.5 text-xs font-bold text-muted"
            onClick={() => adjustRest(-15)}
          >
            <span className="flex items-center gap-0.5">
              <IconMinus size={12} />
              15s
            </span>
          </button>
          <div className="flex-1 text-center">
            <div
              className={`font-mono text-2xl font-bold tabular-nums text-primary ${
                urgent ? 'timer-pulse' : ''
              }`}
            >
              {clock(Math.ceil(remaining))}
            </div>
          </div>
          <button
            className="pressable rounded-lg bg-surface px-2.5 py-1.5 text-xs font-bold text-muted"
            onClick={() => adjustRest(15)}
          >
            <span className="flex items-center gap-0.5">
              <IconPlus size={12} />
              15s
            </span>
          </button>
          <button
            className="pressable ml-1 rounded-lg bg-surface px-2.5 py-1.5 text-xs font-bold text-muted"
            onClick={skipRest}
            aria-label="Saltar descanso"
          >
            <IconX size={14} />
          </button>
        </div>
        <div className="h-1 bg-surface">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}
