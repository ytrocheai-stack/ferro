import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, startOfWeek, subWeeks } from 'date-fns'
import { es } from 'date-fns/locale'
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { db } from '../db/db'
import type { Workout } from '../db/types'
import { useSettings } from '../stores/settings'
import { useCatalog } from '../data/exercises'
import { exportBackup, exportPhotosBackup, importBackup, importPhotosBackup } from '../lib/backup'
import { exportWorkoutsCsv } from '../lib/csv'
import { downloadAllGifs, getGifCacheStatus, type GifCacheStatus } from '../lib/gifs'
import { ensureNotifyPermission } from '../lib/notify'
import { formatDuration, formatVolume } from '../lib/format'
import { isIOS, isStandalone } from '../lib/platform'
import { Select } from '../components/Select'
import { Confirm } from '../components/Sheet'
import { HevyImportSheet } from '../components/HevyImportSheet'
import { IconCheck, IconDownload, IconFlame, IconRuler, IconShare, IconUpload } from '../components/icons'
import { APP_VERSION, DATASET_URL, REST_OPTIONS, restLabel } from '../lib/constants'
import { useLocalDateKey } from '../lib/useLocalDateKey'
import { undoImport, type ImportSummary } from '../lib/hevyImport'

const weekKey = (d: Date | number) => format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')

function weeklyStreak(workouts: Workout[]): number {
  if (!workouts.length) return 0
  const weeks = new Set(workouts.map((w) => weekKey(w.startedAt)))
  let cursor = startOfWeek(new Date(), { weekStartsOn: 1 })
  let streak = 0
  if (!weeks.has(weekKey(cursor))) cursor = subWeeks(cursor, 1) // la semana actual puede no haber empezado
  while (weeks.has(weekKey(cursor))) {
    streak++
    cursor = subWeeks(cursor, 1)
  }
  return streak
}

export default function Profile() {
  const workouts = useLiveQuery(() => db.workouts.toArray(), [], [] as Workout[])
  useLocalDateKey()
  const settings = useSettings()
  const units = settings.units

  const stats = useMemo(() => {
    const now = new Date()
    const thisWeek = weekKey(now)
    const thisMonth = format(now, 'yyyy-MM')
    return {
      total: workouts.length,
      week: workouts.filter((w) => weekKey(w.startedAt) === thisWeek).length,
      month: workouts.filter((w) => format(w.startedAt, 'yyyy-MM') === thisMonth).length,
      volume: workouts.reduce((a, w) => a + w.volumeKg, 0),
      time: workouts.reduce((a, w) => a + (w.endedAt - w.startedAt) / 1000, 0),
      streak: weeklyStreak(workouts),
    }
  }, [workouts])

  const weeklyData = useMemo(() => {
    const buckets: { label: string; count: number }[] = []
    for (let i = 7; i >= 0; i--) {
      const start = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
      const key = weekKey(start)
      buckets.push({
        label: format(start, 'd MMM', { locale: es }),
        count: workouts.filter((w) => weekKey(w.startedAt) === key).length,
      })
    }
    return buckets
  }, [workouts])

  return (
    <div className="px-4 pt-6">
      <h1 className="pb-4 text-2xl font-extrabold">Perfil</h1>

      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Entrenos" value={String(stats.total)} />
        <StatCard label="Esta semana" value={String(stats.week)} />
        <StatCard label="Racha" value={`${stats.streak} sem`} />
        <StatCard label="Este mes" value={String(stats.month)} />
        <StatCard label="Volumen total" value={formatVolume(stats.volume, units)} />
        <StatCard label="Tiempo total" value={stats.time ? formatDuration(stats.time) : '0 min'} />
      </div>

      <div className="card mt-4 px-2 py-3">
        <h2 className="px-2 pb-2 text-sm font-bold">Entrenos por semana</h2>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={weeklyData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
            <XAxis dataKey="label" stroke="#8f8f9b" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#8f8f9b" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
            <Bar dataKey="count" fill="#3d8bfd" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link to="/medidas" className="card pressable flex items-center gap-3 px-4 py-3.5">
          <IconRuler size={20} className="text-primary" />
          <div>
            <div className="text-sm font-bold">Medidas</div>
            <div className="text-[11px] text-muted">Peso, fotos, cm</div>
          </div>
        </Link>
        <Link to="/analisis" className="card pressable flex items-center gap-3 px-4 py-3.5">
          <IconFlame size={20} className="text-primary" />
          <div>
            <div className="text-sm font-bold">Análisis</div>
            <div className="text-[11px] text-muted">Volumen muscular</div>
          </div>
        </Link>
      </div>

      <InstallCard />
      <SettingsCard />
      <DataCard workoutsCount={workouts.length} />

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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-2 py-3 text-center">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="pt-1 text-base font-extrabold">{value}</div>
    </div>
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
      <h2 className="pb-2 text-sm font-bold">Ajustes</h2>
      <Row label="Unidades">
        <div className="flex overflow-hidden rounded-lg border border-border">
          {(['kg', 'lb'] as const).map((u) => (
            <button
              key={u}
              className={`px-3.5 py-1.5 text-sm font-bold ${
                s.units === u ? 'bg-primary text-white' : 'bg-surface-2 text-muted'
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
  const latestImportBatch = useLiveQuery(
    () => db.importBatches.orderBy('createdAt').reverse().filter((batch) => batch.status === 'completed').first(),
    [],
    null,
  )

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
    const warning = summary.anomalies.length
      ? ` Aviso: ${summary.anomalies.map((anomaly) => `${anomaly.name} duró ${anomaly.hours.toFixed(1)} h`).join('; ')}. Se conservaron las marcas de tiempo.`
      : ''
    setMsg(`Hevy importado: ${total} registros y ${summary.sets} series. Puedes deshacer este lote.${warning}`)
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
      {(lastImport?.batchId ?? latestImportBatch?.id) && (
        <button
          className="mb-3 w-full rounded-xl border border-danger/30 px-3 py-2 text-xs font-semibold text-danger"
          onClick={() => {
            const batchId = lastImport?.batchId ?? latestImportBatch?.id
            if (!batchId) return
            void undoImport(batchId).then(
              () => { setMsg('Importación de Hevy deshecha.'); setLastImport(null) },
              (error: unknown) => setMsg(error instanceof Error ? error.message : 'No se pudo deshacer la importación.'),
            )
          }}
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
