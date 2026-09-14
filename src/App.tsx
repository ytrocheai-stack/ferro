import { Suspense, useEffect, useState } from 'react'
import { Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import { Toasts } from './components/Toasts'
import { GymKeypadBar } from './components/GymKeypad'
import { BottomDock, BottomDockProvider } from './components/BottomDock'
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
import { applyTheme } from './lib/theme'

export default function App() {
  const { pathname } = useLocation()
  const hideTabs = pathname.startsWith('/entreno') || pathname.startsWith('/rutina')
  const { isLoaded, isSignedIn, getToken, userId } = useAuth()
  const theme = useSettings((state) => state.theme)
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
    const process = () => void Promise.all([processPendingAdaptationJobs(getToken, userId), processPendingAdaptationEvents(getToken, userId), syncPendingCoachRuns(getToken)]).catch(() => undefined)
    const onVisible = () => { if (document.visibilityState === 'visible') process() }
    process()
    window.addEventListener('online', process)
    window.addEventListener('nextrep:adaptation-wake', process)
    window.addEventListener('nextrep:coach-wake', process)
    window.addEventListener('nextrep:coach-consent-changed', process)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.removeEventListener('online', process); window.removeEventListener('nextrep:adaptation-wake', process); window.removeEventListener('nextrep:coach-wake', process); window.removeEventListener('nextrep:coach-consent-changed', process); document.removeEventListener('visibilitychange', onVisible); cancelPendingAdaptationProcessing(userId) }
  }, [getToken, isSignedIn, userId])

  useEffect(() => {
    applyTheme(theme)
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
    if (!media || theme !== 'system') return
    const onChange = () => applyTheme('system')
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [theme])

  if (authRequired && !isLoaded) return <AuthRequiredScreen loading />
  if (authRequired && !isSignedIn) return <AuthRequiredScreen />

  return (
    <BottomDockProvider>
      <AppShell hideTabs={hideTabs} />
    </BottomDockProvider>
  )
}

function AppShell({ hideTabs }: { hideTabs: boolean }) {
  const [dockSpace, setDockSpace] = useState(0)
  return (
    <div className="app-shell min-h-dvh pt-[env(safe-area-inset-top)]">
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <main id="main-content" style={{ paddingBottom: `${Math.max(hideTabs ? 16 : 112, dockSpace + 16)}px` }} tabIndex={-1}>
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <ScrollRestoration />
      <BottomDock
        onHeightChange={setDockSpace}
        accessory={<GymKeypadBar />}
        navigation={!hideTabs ? <TabBar inDock /> : undefined}
        session={<ActiveBanner inDock />}
        rest={<RestTimerOverlay inDock />}
        toasts={<Toasts inDock />}
      />
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
  return <p className="sr-only">El coach solo comparte tras tu consentimiento el perfil, objetivos, restricciones, rutinas, hasta seis entrenamientos terminados y la conversación reciente limitada a 100 mensajes, 4.000 caracteres por mensaje y 36.000 en total. La conversación completa se guarda localmente; D1 conserva temporalmente el request_json y la decisión para ejecutar y consultar la solicitud, y elimina las ejecuciones terminales después de siete días. No guarda JWT, correo ni nombre.</p>
}

/** Barra "entreno en curso" visible fuera de la pantalla de sesión. */
function ActiveBanner({ inDock = false }: { inDock?: boolean }) {
  const session = useActive((s) => s.session)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onSession = pathname.startsWith('/entreno')
  const now = useNow(1000, !!session && !onSession)
  if (!session || onSession) return null

  return (
    <div className={inDock ? 'w-full' : 'fixed inset-x-0 z-40'}>
      <button
        onClick={() => navigate('/entreno')}
        className="pressable dock-card mx-auto flex items-center gap-3 px-4 py-3 text-text"
      >
        <IconPlay size={18} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-left font-semibold line-clamp-2">
          {session.editingWorkoutId ? `Editando: ${session.name}` : session.name}
        </span>
        {!session.editingWorkoutId && (
          <span className="text-sm tabular-nums">
            {clock((now - session.startedAt) / 1000)}
          </span>
        )}
        <span className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary">Reanudar</span>
      </button>
    </div>
  )
}

/** Temporizador de descanso flotante, global para sobrevivir a la navegación. */
function RestTimerOverlay({ inDock = false }: { inDock?: boolean }) {
  const rest = useActive((s) => s.rest)
  const skipRest = useActive((s) => s.skipRest)
  const adjustRest = useActive((s) => s.adjustRest)
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
  return (
    <div className={inDock ? 'w-full' : 'fixed inset-x-0 z-40'}>
      <div className="dock-card mx-auto overflow-hidden bg-surface-2">
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
              className={`text-2xl font-bold tabular-nums text-primary ${
                urgent ? 'text-warning' : ''
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
          <div className={`rest-progress h-full ${urgent ? 'bg-warning' : 'bg-primary'}`} style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
      </div>
    </div>
  )
}
