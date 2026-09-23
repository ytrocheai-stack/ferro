import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Workout } from '../db/types'
import { useSettings } from '../stores/settings'
import { useCatalog } from '../data/exercises'
import { exportBackup, exportPhotosBackup, importBackup, importPhotosBackup } from '../lib/backup'
import { exportWorkoutsCsv } from '../lib/csv'
import { downloadAllGifs, getGifCacheStatus, type GifCacheStatus } from '../lib/gifs'
import { ensureNotifyPermission } from '../lib/notify'
import { isIOS, isStandalone } from '../lib/platform'
import { Select } from '../components/Select'
import { Confirm } from '../components/Sheet'
import { PageHeader } from '../components/PageHeader'
import { SectionHeader } from '../components/SectionHeader'
import { HevyImportSheet } from '../components/HevyImportSheet'
import { IconCheck, IconChevronDown, IconDownload, IconShare, IconUpload } from '../components/icons'
import { APP_VERSION, DATASET_URL, REST_OPTIONS, restLabel } from '../lib/constants'
import { undoImport, type ImportSummary } from '../lib/hevyImport'
import { useAuth } from '@clerk/react'
import { COACH_CONSENT_VERSION, getCoachConsent, grantCoachConsent, revokeCoachConsent, saveCoachProfile, type CoachConsent } from '../lib/coachConsent'
import { AuthControls } from '../components/AuthControls'

export default function Profile() {
  const workouts = useLiveQuery(() => db.workouts.toArray(), [], [] as Workout[])

  return (
    <div className="page-content pt-3">
      <PageHeader title="Perfil" back showProfile={false} />
      <section className="card mt-4 px-4 py-3" aria-labelledby="account-title">
        <SectionHeader title="Cuenta" />
        <div id="account-title" className="pt-3"><AuthControls /></div>
        <AccountDiagnostic />
      </section>
      <AppearanceCard />

      <SettingsCard />
      <CoachDisclosure />
      <DataDisclosure workoutsCount={workouts.length} />
      <InstallCard />

      <div className="card mt-4 px-4 py-3 text-xs leading-relaxed text-muted">
        <div className="pb-1 text-sm font-bold text-text">Acerca de</div>
        NextRep v{APP_VERSION} — registro de entrenos 100% offline.
        <br />
        Ejercicios, imágenes y GIFs:{' '}
        <a className="text-primary underline" href={DATASET_URL} target="_blank" rel="noreferrer">
          exercises-dataset
        </a>{' '}
        (hasaneyldrm) · Media © Gym visual.
      </div>
    </div>
  )
}

function CoachDisclosure() {
  if (!import.meta.env.VITE_ADAPTATION_WORKER_URL) return null
  return (
    <details className="profile-disclosure mt-4">
      <summary className="profile-disclosure__summary">
        <span><strong>Contexto y privacidad del coach</strong><small>Consentimiento, contexto editable y uso de datos</small></span>
        <IconChevronDown size={18} className="profile-disclosure__icon" />
      </summary>
      <div>
        <CoachBetaCard />
        <CoachProfileCard />
        <CoachPrivacyCard />
      </div>
    </details>
  )
}

function DataDisclosure({ workoutsCount }: { workoutsCount: number }) {
  return (
    <details className="profile-disclosure mt-4">
      <summary className="profile-disclosure__summary">
        <span><strong>Datos</strong><small>Importar, exportar y restaurar copias</small></span>
        <IconChevronDown size={18} className="profile-disclosure__icon" />
      </summary>
      <div><DataCard workoutsCount={workoutsCount} /></div>
    </details>
  )
}

type ReadinessPayload = {
  ok?: unknown
  checks?: unknown
  configuration?: unknown
}

type AccountReadiness = {
  httpStatus: number
  payload?: ReadinessPayload
  unreadable?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readinessLabel(value: unknown): string {
  return typeof value === 'boolean' ? (value ? 'Sí' : 'No') : 'No disponible'
}

function AccountReadinessSummary({ result }: { result: AccountReadiness }) {
  const payload = result.payload
  const config = isRecord(payload?.configuration) ? payload.configuration : undefined
  const flags = isRecord(config?.flags) ? config.flags : undefined
  const models = isRecord(config?.models) ? config.models : undefined
  const allowlist = isRecord(config?.allowlist) ? config.allowlist : undefined
  const headline = result.httpStatus === 401
    ? 'El servidor rechazó la sesión'
    : result.httpStatus === 403
      ? 'La cuenta no tiene acceso al backend'
      : result.unreadable
        ? 'Respuesta recibida; contenido no legible'
        : payload?.ok === true
          ? 'Backend listo'
          : payload?.ok === false
            ? 'Backend requiere atención'
            : 'Respuesta recibida'
  const providerOrder = Array.isArray(config?.providerOrder)
    ? config.providerOrder.filter((provider): provider is string => typeof provider === 'string').slice(0, 5)
    : []
  const orderedProviders = providerOrder.map((provider) => {
    const model = models?.[provider]
    return typeof model === 'string' ? `${provider} (${model})` : provider
  })
  const checks = isRecord(payload?.checks)
    ? Object.entries(payload.checks).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    : []
  const checkNames: Record<string, string> = {
    config: 'Configuración', d1: 'Base de datos', index: 'Índice', corpus: 'Corpus', productionConfig: 'Configuración de producción',
  }

  return (
    <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted" role="status" aria-live="polite">
      <p className="font-semibold text-text">HTTP {result.httpStatus} · {headline}</p>
      {result.unreadable ? <p>No se pudo leer el diagnóstico devuelto por el backend.</p> : (
        <>
          <p>Configuración completa: {readinessLabel(config?.complete)} · Beta: {readinessLabel(flags?.beta)} · Proveedores/modelos: {orderedProviders.length ? orderedProviders.join(' → ') : 'No disponibles'} · Cuentas permitidas: {typeof allowlist?.count === 'number' ? allowlist.count : 'No disponible'}</p>
          {checks.length > 0 && <p>Comprobaciones: {checks.map(([key, value]) => `${checkNames[key] ?? key}: ${readinessLabel(value)}`).join(' · ')}</p>}
        </>
      )}
    </div>
  )
}

export function AccountDiagnostic() {
  const { userId, isSignedIn, getToken } = useAuth()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<AccountReadiness | null>(null)
  const [message, setMessage] = useState('')
  const workerUrl = (import.meta.env.VITE_ADAPTATION_WORKER_URL as string | undefined)?.replace(/\/$/, '')

  const checkBackend = async () => {
    setResult(null)
    setMessage('')
    if (!isSignedIn || !userId) {
      setMessage('Inicia sesión en Clerk para comprobar el backend.')
      return
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setMessage('Sin conexión. Conéctate a internet e inténtalo de nuevo.')
      return
    }
    if (!workerUrl) {
      setMessage('El backend no está configurado en esta instalación.')
      return
    }

    setChecking(true)
    try {
      const token = await getToken()
      if (!token) {
        setMessage('No se obtuvo una sesión de Clerk. Inicia sesión e inténtalo de nuevo.')
        return
      }
      const response = await fetch(`${workerUrl}/readiness`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      })
      let payload: ReadinessPayload | undefined
      let unreadable = false
      try {
        const body: unknown = await response.json()
        if (isRecord(body)) payload = body as ReadinessPayload
        else unreadable = true
      } catch {
        unreadable = true
      }
      setResult({ httpStatus: response.status, payload, unreadable })
    } catch {
      setMessage('No se pudo conectar con el backend. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <details className="mt-3 border-t border-border pt-2 text-xs text-muted">
      <summary className="cursor-pointer select-none">Diagnóstico de cuenta</summary>
      <p className="pt-2">ID de usuario de Clerk: <code className="break-all">{userId ?? 'No disponible'}</code></p>
      {workerUrl ? <><button className="btn btn-surface mt-2 py-1.5 text-xs" type="button" disabled={checking} onClick={() => void checkBackend()}>{checking ? 'Comprobando…' : 'Comprobar backend'}</button><p className="pt-1">La consulta no incluye entrenamientos, perfil ni datos locales.</p></> : <p className="pt-2">Backend no configurado.</p>}
      {message && <p className="pt-2" role="status" aria-live="polite">{message}</p>}
      {result && <AccountReadinessSummary result={result} />}
    </details>
  )
}

export function CoachProfileCard() {
  const { isSignedIn, userId } = useAuth()
  const stored = useLiveQuery(async () => userId ? await db.coachProfiles.get(userId) : undefined, [userId], undefined)
  const [population, setPopulation] = useState('')
  const [goals, setGoals] = useState('')
  const [pain, setPain] = useState('')
  const [equipment, setEquipment] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!stored) return
    setPopulation(stored.population.join(', ')); setGoals(stored.goals.join(', ')); setPain(stored.injuriesOrPain.join(', ')); setEquipment(stored.unavailableEquipment.join(', ')); setConfirmed(stored.populationConfirmed)
  }, [stored])
  if (!isSignedIn || !userId || !import.meta.env.VITE_ADAPTATION_WORKER_URL) return null
  const split = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean)
  const save = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    setSaved(false)
    try {
      await saveCoachProfile({ id: userId, ownerId: userId, population: split(population), populationConfirmed: confirmed, goals: split(goals), injuriesOrPain: split(pain), unavailableEquipment: split(equipment), excludedExercises: stored?.excludedExercises ?? [], nutritionConstraints: stored?.nutritionConstraints ?? [] })
      setSaved(true)
    } catch {
      setSaveError('No se pudo guardar el contexto. Tus cambios siguen en el formulario; vuelve a intentarlo.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  return <section className="card mt-4 px-4 py-3" aria-labelledby="coach-profile-title"><h2 id="coach-profile-title" className="text-sm font-bold">Contexto mínimo del coach</h2><p className="mt-1 text-xs leading-relaxed text-muted">Solo se usará si lo confirmas. Escribe población aplicable (por ejemplo, adulto general), objetivos, dolor/restricciones y equipo no disponible. “No informado” no significa “sin restricciones”.</p><label className="mt-3 block text-xs font-semibold" htmlFor="coach-population">Población confirmada</label><input id="coach-population" className="input mt-1 w-full" value={population} onChange={(event) => setPopulation(event.target.value)} placeholder="adult-general" /><label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmo que la población escrita es aplicable</label><label className="mt-3 block text-xs font-semibold" htmlFor="coach-goals">Objetivos</label><input id="coach-goals" className="input mt-1 w-full" value={goals} onChange={(event) => setGoals(event.target.value)} placeholder="fuerza, adherencia" /><label className="mt-2 block text-xs font-semibold" htmlFor="coach-pain">Dolor o restricciones</label><input id="coach-pain" className="input mt-1 w-full" value={pain} onChange={(event) => setPain(event.target.value)} placeholder="dejar vacío si no informado" /><label className="mt-2 block text-xs font-semibold" htmlFor="coach-equipment">Equipo no disponible</label><input id="coach-equipment" className="input mt-1 w-full" value={equipment} onChange={(event) => setEquipment(event.target.value)} placeholder="barra, discos" /><button className="btn btn-surface mt-3 w-full py-2 text-xs" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar contexto del coach'}</button>{saveError && <p role="alert" className="mt-2 text-sm text-danger">{saveError}</p>}{saved && <p role="status" className="mt-2 text-sm text-success">Contexto guardado.</p>}</section>
}

function CoachPrivacyCard() {
  const { isSignedIn } = useAuth()
  if (!isSignedIn || !import.meta.env.VITE_ADAPTATION_WORKER_URL) return null
  return (
    <div className="card mt-4 px-4 py-3 text-xs leading-relaxed text-muted">
      <div className="pb-1 text-sm font-bold text-text">Privacidad del coach adaptativo</div>
      <p>Tus datos se guardan primero en este dispositivo. Con tu consentimiento, el contexto seleccionado (perfil, objetivos, restricciones, rutinas, conversación y hasta seis entrenamientos terminados) puede enviarse al backend privado de NextRep en Cloudflare. Google Gemini 3.5 Flash Lite es el único proveedor que genera las respuestas. Si la búsqueda RAG está disponible, NVIDIA recibe la consulta para crear el embedding usado al recuperar pasajes; NVIDIA no genera respuestas.</p>
      <p className="mt-2">Google puede usar el contenido enviado mediante el nivel gratuito de Gemini para mejorar sus productos. Para procesar, reanudar y consultar solicitudes, Cloudflare conserva temporalmente la solicitud validada y la decisión/respuesta asociada. Las ejecuciones terminadas se eliminan después de siete días; la telemetría operativa se elimina después de 30 días. No guardamos JWT ni credenciales; evita incluir información personal innecesaria en los mensajes.</p>
    </div>
  )
}

function CoachBetaCard() {
  const { isSignedIn, userId } = useAuth()
  const jobs = useLiveQuery(() => db.adaptationJobs.where('ownerId').equals(userId ?? '__no-account__').toArray(), [userId], [])
  const routines = useLiveQuery(() => db.routines.toArray(), [], [])
  const [consent, setConsent] = useState<CoachConsent | null>(() => getCoachConsent(userId))
  useEffect(() => setConsent(getCoachConsent(userId)), [userId])
  const configured = Boolean(import.meta.env.VITE_ADAPTATION_WORKER_URL)
  const reviewed = routines.filter((routine) => routine.coachReviewed).length
  const pending = jobs.filter((job) => job.status === 'pending' || job.status === 'processing').length

  if (!configured) return null
  return (
    <section className="card mt-4 px-4 py-3" aria-labelledby="coach-beta-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="coach-beta-title" className="text-sm font-bold">Coach adaptativo · beta privada</h2>
          <p className="pt-1 text-xs text-muted">El consentimiento es por cuenta y dispositivo; usar el coach también depende de que beta y backend estén habilitados.</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${consent ? 'bg-success/10 text-success' : 'bg-surface-2 text-muted'}`}>{consent ? 'Activo' : 'Apagado'}</span>
      </div>
      <div className="mt-3 space-y-1 text-xs text-muted">
        <p>{isSignedIn ? '✓ Sesión iniciada' : '• Inicia sesión para solicitar acceso'}</p>
        <p>{consent ? '✓ Consentimiento vigente' : '• Falta aceptar el consentimiento del coach'}</p>
        <p>{reviewed} rutina{reviewed === 1 ? '' : 's'} revisada{reviewed === 1 ? '' : 's'} · {pending} solicitud{pending === 1 ? '' : 'es'} pendiente{pending === 1 ? '' : 's'}</p>
      </div>
      {isSignedIn && userId && !consent && (
        <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
          Al activar, autorizas enviar tu perfil editable, objetivos, restricciones, rutinas, conversación y hasta seis entrenamientos recientes terminados al backend privado de NextRep en Cloudflare. Google Gemini 3.5 Flash Lite genera las respuestas. Si la búsqueda RAG está disponible, NVIDIA recibe la consulta para crear el embedding de búsqueda, pero no genera respuestas. Google puede usar el contenido enviado mediante su nivel gratuito para mejorar sus productos. Cloudflare conserva temporalmente la solicitud validada y la decisión/respuesta asociada para procesarla y consultarla; elimina las ejecuciones terminadas tras siete días. Los datos no se comparten con otras cuentas; puedes desactivar el coach cuando quieras. Versión de consentimiento: {COACH_CONSENT_VERSION}. Si cambia esta versión tendrás que aceptar de nuevo en este dispositivo.
          <button className="btn btn-primary mt-2 w-full py-2" type="button" onClick={async () => setConsent(await grantCoachConsent(userId))}>Aceptar y activar coach</button>
        </div>
      )}
      {consent && <><Link className="btn btn-primary mt-3 w-full py-2 text-xs" to="/coach">Abrir coach</Link><button className="btn btn-surface mt-3 w-full py-2 text-xs" type="button" onClick={async () => { await revokeCoachConsent(consent.userId); setConsent(null) }}>Desactivar coach y detener nuevos envíos</button></>}
    </section>
  )
}

/** Guía de instalación para iOS: ahí no existe `beforeinstallprompt`, así que sin este aviso el
 *  usuario no tiene forma de saber que puede instalar la app desde el menú Compartir de Safari. */
function InstallCard() {
  if (!isIOS() || isStandalone()) return null
  return (
    <div className="card mt-4 flex items-start gap-3 px-4 py-3.5">
      <IconShare size={20} className="mt-0.5 shrink-0 text-primary" />
      <div className="text-sm">
        <div className="font-bold">Instala NextRep en tu iPhone</div>
        <div className="pt-0.5 text-xs text-muted">
          Toca <span className="font-semibold text-text">Compartir</span> en Safari y luego{' '}
          <span className="font-semibold text-text">«Añadir a pantalla de inicio»</span> para
          usarla como app, con acceso sin conexión.
        </div>
      </div>
    </div>
  )
}

function AppearanceCard() {
  const theme = useSettings((state) => state.theme)
  const update = useSettings((state) => state.update)
  return (
    <section className="card mt-3 px-4 py-3" aria-labelledby="appearance-title">
      <SectionHeader title="Apariencia" />
      <div id="appearance-title" className="pt-3">
        <Select
          value={theme}
          onChange={(value) => update({ theme: value })}
          options={[{ value: 'system' as const, label: 'Sistema' }, { value: 'light' as const, label: 'Claro' }, { value: 'dark' as const, label: 'Oscuro' }]}
          sheetTitle="Apariencia"
        />
      </div>
    </section>
  )
}

function SettingsCard() {
  const s = useSettings()

  const toggleNotification = async (v: boolean) => {
    if (!v) {
      s.update({ restNotification: false })
      return
    }
    const ok = await ensureNotifyPermission()
    s.update({ restNotification: ok })
  }

  return (
    <div className="card mt-4 px-4 py-3">
      <h2 className="pb-2 text-xl font-semibold">Preferencias de entrenamiento</h2>
      <Row label="Unidades">
        <div className="flex overflow-hidden rounded-lg border border-border">
          {(['kg', 'lb'] as const).map((u) => (
            <button
              key={u}
              className={`px-3.5 py-1.5 text-sm font-bold ${
                s.units === u ? 'bg-primary-strong text-on-primary' : 'bg-surface-2 text-muted'
              }`}
              onClick={() => s.update({ units: u })}
            >
              {u}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Descanso por defecto">
        <Select
          className="w-28"
          value={s.defaultRestSec}
          onChange={(v) => s.update({ defaultRestSec: v })}
          options={REST_OPTIONS.map((o) => ({ value: o, label: restLabel(o) }))}
          sheetTitle="Descanso por defecto"
        />
      </Row>
      <Row label="Registrar RPE por serie">
        <Toggle checked={s.trackRpe} onChange={(v) => s.update({ trackRpe: v })} />
      </Row>
      <Row label="Registrar RIR por serie">
        <Toggle checked={s.trackRir} onChange={(v) => s.update({ trackRir: v })} />
      </Row>
      <Row label="Objetivo semanal de entrenos">
        <Select
          className="w-20"
          value={s.weeklyGoal}
          onChange={(v) => s.update({ weeklyGoal: v })}
          options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))}
          sheetTitle="Objetivo semanal de entrenos"
        />
      </Row>
      <Row label="Peso de la barra">
        <Select
          className="w-24"
          value={s.barWeightKg}
          onChange={(v) => s.update({ barWeightKg: v })}
          options={[10, 15, 20].map((n) => ({ value: n, label: `${n} kg` }))}
          sheetTitle="Peso de la barra"
        />
      </Row>
      <div className="border-b border-border/50 py-2 text-sm">
        <div className="pb-2">Discos disponibles (kg)</div>
        <div className="flex flex-wrap gap-1.5">
          {[25, 20, 15, 10, 5, 2.5, 1.25, 0.5].map((p) => {
            const on = s.platesKg.includes(p)
            return (
              <button
                key={p}
                className={`chip ${on ? 'chip-active' : ''}`}
                onClick={() =>
                  s.update({
                    platesKg: on
                      ? s.platesKg.filter((x) => x !== p)
                      : [...s.platesKg, p].sort((a, b) => b - a),
                  })
                }
              >
                {p}
              </button>
            )
          })}
        </div>
      </div>
      <Row label="Sonido al fin del descanso">
        <Toggle checked={s.sound} onChange={(v) => s.update({ sound: v })} />
      </Row>
      {!isIOS() && (
        <Row label="Vibración">
          <Toggle checked={s.vibration} onChange={(v) => s.update({ vibration: v })} />
        </Row>
      )}
      <Row label="Notificación de descanso">
        <Toggle checked={s.restNotification} onChange={(v) => void toggleNotification(v)} />
      </Row>
      <Row label="Pantalla encendida al entrenar">
        <Toggle checked={s.keepAwake} onChange={(v) => s.update({ keepAwake: v })} />
      </Row>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-b-0">
      <span>{label}</span>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`h-7 w-12 shrink-0 rounded-full p-1 transition-colors ${
        checked ? 'bg-primary' : 'border border-border bg-surface-2'
      }`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  )
}

function DataCard({ workoutsCount }: { workoutsCount: number }) {
  const { all } = useCatalog()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [storage, setStorage] = useState<{ usageMB: number; persisted: boolean } | null>(null)
  const [hevyOpen, setHevyOpen] = useState(false)
  const [lastImport, setLastImport] = useState<ImportSummary | null>(null)

  // GIFs offline
  const swReady = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller
  const totalGifs = useMemo(() => all.filter((e) => e.gif && !e.custom).length, [all])
  const [gifStatus, setGifStatus] = useState<GifCacheStatus>({ cached: 0, total: 0, complete: false })
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const stopRef = useRef(false)

  useEffect(() => {
    void getGifCacheStatus(all).then(setGifStatus)
  }, [all])

  useEffect(() => {
    void (async () => {
      try {
        const est = await navigator.storage?.estimate?.()
        const persisted = (await navigator.storage?.persisted?.()) ?? false
        if (est) setStorage({ usageMB: (est.usage ?? 0) / 1e6, persisted })
      } catch {
        /* sin API de almacenamiento */
      }
    })()
  }, [])

  const startDownload = async () => {
    stopRef.current = false
    setProgress({ done: 0, total: totalGifs })
    await downloadAllGifs(
      all,
      (done, total) => setProgress({ done, total }),
      () => stopRef.current,
    )
    setProgress(null)
    setGifStatus(await getGifCacheStatus(all))
  }

  const onImportFile = (f: File | undefined) => {
    if (f) setPendingFile(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  const doImport = async () => {
    if (!pendingFile) return
    try {
      const r = await importBackup(pendingFile)
      setMsg(`Backup restaurado: ${r.workouts} entrenos, ${r.routines} rutinas, ${r.customExercises} ejercicios propios.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo importar el archivo')
    } finally {
      setPendingFile(null)
    }
  }

  const onHevyImported = (summary: ImportSummary) => {
    setLastImport(summary)
    const total = Object.values(summary.counts).reduce((sum, count) => sum + (count ?? 0), 0)
    const warning = summary.unclassifiedExercises.length
      ? ` Sin grupo muscular: ${summary.unclassifiedExercises.join(', ')}.`
      : ''
    setMsg(`Hevy importado: ${total} registros. Puedes deshacer este lote.${warning}`)
  }

  const photosFileRef = useRef<HTMLInputElement>(null)
  const [photosMsg, setPhotosMsg] = useState<string | null>(null)
  const onImportPhotos = async (f: File | undefined) => {
    if (!f) return
    try {
      const n = await importPhotosBackup(f)
      setPhotosMsg(`${n} fotos añadidas.`)
    } catch (e) {
      setPhotosMsg(e instanceof Error ? e.message : 'No se pudo importar el archivo')
    } finally {
      if (photosFileRef.current) photosFileRef.current.value = ''
    }
  }

  return (
    <div className="card mt-4 px-4 py-3">
      <h2 className="pb-2 text-sm font-bold">Datos</h2>

      <div className="flex gap-2">
        <button className="btn btn-surface flex-1 text-sm" onClick={() => void exportBackup()}>
          <IconDownload size={16} />
          Exportar backup
        </button>
        <button className="btn btn-surface flex-1 text-sm" onClick={() => fileRef.current?.click()}>
          <IconUpload size={16} />
          Importar
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => onImportFile(e.target.files?.[0])}
        />
      </div>
      {msg && <p className="pt-2 text-xs text-success">{msg}</p>}

      <button className="btn my-3 w-full bg-primary/15 text-sm text-primary" onClick={() => setHevyOpen(true)}>
        <IconDownload size={16} />
        Importar datos de Hevy
      </button>
      {lastImport && (
        <button
          className="mb-3 w-full rounded-xl border border-danger/30 px-3 py-2 text-xs font-semibold text-danger"
          onClick={() => void undoImport(lastImport.batchId).then(() => { setMsg('Importación de Hevy deshecha.'); setLastImport(null) })}
        >
          Deshacer última importación de Hevy
        </button>
      )}

      <div className="flex gap-2 border-b border-border/50 pb-3 pt-3">
        <button
          className="btn btn-surface flex-1 text-sm"
          onClick={() => void exportPhotosBackup().then((n) => setPhotosMsg(`${n} fotos exportadas.`))}
        >
          <IconDownload size={16} />
          Backup de fotos
        </button>
        <button className="btn btn-surface flex-1 text-sm" onClick={() => photosFileRef.current?.click()}>
          <IconUpload size={16} />
          Importar fotos
        </button>
        <input
          ref={photosFileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void onImportPhotos(e.target.files?.[0])}
        />
      </div>
      {photosMsg && <p className="border-b border-border/50 pb-3 pt-2 text-xs text-success">{photosMsg}</p>}

      <button
        className="btn btn-surface my-3 w-full text-sm"
        onClick={() => void exportWorkoutsCsv()}
      >
        <IconDownload size={16} />
        Exportar series a CSV
      </button>

      <div className="border-b border-border/50 pb-3 pt-3">
        <div className="flex items-center justify-between text-sm">
          <span>GIFs para uso offline</span>
          <span className="text-xs text-muted">
            {gifStatus.cached} / {gifStatus.total || totalGifs || '…'}
          </span>
        </div>
        {progress ? (
          <div className="pt-2">
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between pt-1.5">
              <span className="text-xs text-muted">
                {progress.done} / {progress.total}
              </span>
              <button className="text-xs font-bold text-danger" onClick={() => (stopRef.current = true)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : gifStatus.complete ? (
          <div
            className="mt-2 flex items-center gap-2 rounded-xl border border-success/25 bg-success/10 px-3 py-2.5 text-xs font-semibold text-success"
            role="status"
          >
            <IconCheck size={16} />
            Biblioteca completa disponible sin conexión
          </div>
        ) : swReady ? (
          <button className="btn mt-2 w-full bg-primary/15 py-2 text-sm text-primary" onClick={() => void startDownload()}>
            Descargar GIFs pendientes (~130 MB total)
          </button>
        ) : (
          <p className="pt-1.5 text-xs text-muted">
            Disponible cuando la app esté instalada (los GIFs vistos se guardan solos).
          </p>
        )}
      </div>

      {storage && (
        <p className="pt-2.5 text-xs text-muted">
          Almacenamiento usado: {storage.usageMB.toFixed(1)} MB ·{' '}
          {storage.persisted
            ? 'protegido contra borrado ✓'
            : isIOS()
              ? 'iOS podría liberar este espacio si el dispositivo anda muy justo de memoria'
              : 'no persistente aún'}
        </p>
      )}

      <Confirm
        open={!!pendingFile}
        onClose={() => setPendingFile(null)}
        title="¿Restaurar backup?"
        message={`Se reemplazarán TODOS los datos actuales (${workoutsCount} entrenos) por los del archivo "${pendingFile?.name}".`}
        confirmLabel="Restaurar"
        danger
        onConfirm={() => void doImport()}
      />
      <HevyImportSheet open={hevyOpen} onClose={() => setHevyOpen(false)} onImported={onHevyImported} />
    </div>
  )
}
