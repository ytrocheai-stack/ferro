import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { db } from '../db/db'
import type { Measurement, MeasurementKind, ProgressPhoto } from '../db/types'
import { MEASUREMENT_LABELS, MEASUREMENT_ORDER, MEASUREMENT_UNIT } from '../data/measurementLabels'
import { resizeImageToBlob, blobUrl } from '../lib/photos'
import { formatShortDate, uid } from '../lib/format'
import { toastUndo } from '../stores/toasts'
import { Confirm, Sheet } from '../components/Sheet'
import { SkeletonChart } from '../components/Skeleton'
import { IconCamera, IconChevronLeft, IconPlus, IconRuler, IconTrash } from '../components/icons'

type Tab = 'measurements' | 'photos'

export default function Measurements() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('measurements')

  return (
    <div className="px-4 pt-4">
      <header className="flex items-center gap-2 pb-2">
        <button
          className="pressable -ml-2 rounded-lg p-1.5 text-muted"
          onClick={() => navigate(-1)}
          aria-label="Volver"
        >
          <IconChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-extrabold">Medidas</h1>
      </header>

      <div className="flex gap-2 pb-4">
        <button
          className={`chip ${tab === 'measurements' ? 'chip-active' : ''}`}
          onClick={() => setTab('measurements')}
        >
          <IconRuler size={13} />
          Medidas
        </button>
        <button className={`chip ${tab === 'photos' ? 'chip-active' : ''}`} onClick={() => setTab('photos')}>
          <IconCamera size={13} />
          Fotos
        </button>
      </div>

      {tab === 'measurements' ? <MeasurementsTab /> : <PhotosTab />}
    </div>
  )
}

function MeasurementsTab() {
  const all = useLiveQuery(() => db.measurements.orderBy('date').reverse().toArray(), [], undefined)
  const [selected, setSelected] = useState<MeasurementKind | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const latestByKind = useMemo(() => {
    const m = new Map<MeasurementKind, Measurement>()
    for (const item of all ?? []) if (!m.has(item.kind)) m.set(item.kind, item)
    return m
  }, [all])

  if (all === undefined) return <SkeletonChart />

  return (
    <div>
      <button className="btn btn-primary mb-4 w-full" onClick={() => setAddOpen(true)}>
        <IconPlus size={17} />
        Registrar medida
      </button>

      {all.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-muted">
          Registra tu primera medida (peso, cintura, brazo…) para empezar a ver tu evolución.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border/50">
          {MEASUREMENT_ORDER.filter((k) => latestByKind.has(k)).map((k) => {
            const m = latestByKind.get(k)!
            return (
              <button
                key={k}
                className="flex items-center justify-between py-3 text-left"
                onClick={() => setSelected(k)}
              >
                <div>
                  <div className="text-sm font-semibold">{MEASUREMENT_LABELS[k]}</div>
                  <div className="text-xs text-muted">{formatShortDate(m.date)}</div>
                </div>
                <div className="text-lg font-bold tabular-nums text-primary">
                  {m.value} {MEASUREMENT_UNIT[k]}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <AddMeasurementSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <MeasurementDetailSheet kind={selected} onClose={() => setSelected(null)} history={all} />
    </div>
  )
}

function AddMeasurementSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<MeasurementKind>('weight')
  const [value, setValue] = useState('')

  const save = async () => {
    const n = parseFloat(value.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return
    await db.measurements.put({ id: uid(), date: Date.now(), kind, value: n })
    setValue('')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Registrar medida">
      <div className="flex flex-col gap-3 pb-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Tipo</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as MeasurementKind)}>
            {MEASUREMENT_ORDER.map((k) => (
              <option key={k} value={k}>
                {MEASUREMENT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Valor ({MEASUREMENT_UNIT[kind]})</span>
          <input
            className="input"
            type="text"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === 'weight' ? '75.5' : kind === 'bodyfat' ? '15' : '38'}
          />
        </label>
        <button className="btn btn-primary mt-1" disabled={!value.trim()} onClick={() => void save()}>
          Guardar
        </button>
      </div>
    </Sheet>
  )
}

function MeasurementDetailSheet({
  kind,
  onClose,
  history,
}: {
  kind: MeasurementKind | null
  onClose: () => void
  history: Measurement[] | undefined
}) {
  const points = useMemo(() => {
    if (!kind || !history) return []
    return history
      .filter((m) => m.kind === kind)
      .slice()
      .reverse()
      .map((m) => ({ date: m.date, value: m.value, id: m.id }))
  }, [kind, history])

  const [confirmDelete, setConfirmDelete] = useState<Measurement | null>(null)

  return (
    <Sheet open={kind !== null} onClose={onClose} title={kind ? MEASUREMENT_LABELS[kind] : ''}>
      {kind && (
        <>
          {points.length < 2 ? (
            <p className="py-6 text-center text-sm text-muted">
              Registra al menos 2 valores para ver la gráfica de evolución.
            </p>
          ) : (
            <div className="card px-1 py-3">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={points} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#2a2a33" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: number) => format(d, 'd MMM', { locale: es })}
                    stroke="#8f8f9b"
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis stroke="#8f8f9b" fontSize={11} width={38} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#1f1f27', border: '1px solid #2a2a33', borderRadius: 12, fontSize: 12 }}
                    labelFormatter={(d) => format(Number(d), "d 'de' MMMM yyyy", { locale: es })}
                    formatter={(v) => [`${v} ${MEASUREMENT_UNIT[kind]}`, MEASUREMENT_LABELS[kind]]}
                  />
                  <Line type="monotone" dataKey="value" stroke="#3d8bfd" strokeWidth={2.5} dot={{ r: 3, fill: '#3d8bfd' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="flex flex-col divide-y divide-border/50 pt-3">
            {points
              .slice()
              .reverse()
              .map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-muted">{formatShortDate(p.date)}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold tabular-nums">
                      {p.value} {MEASUREMENT_UNIT[kind]}
                    </span>
                    <button
                      className="pressable text-danger"
                      onClick={() => setConfirmDelete(history!.find((m) => m.id === p.id)!)}
                      aria-label="Eliminar"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
      <Confirm
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="¿Eliminar este registro?"
        confirmLabel="Eliminar"
        danger
        onConfirm={() => {
          const snap = confirmDelete!
          void db.measurements.delete(snap.id)
          toastUndo('Medida eliminada', () => void db.measurements.put(snap))
        }}
      />
    </Sheet>
  )
}

function PhotosTab() {
  const photos = useLiveQuery(() => db.photos.orderBy('date').reverse().toArray(), [], undefined)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState<ProgressPhoto | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const blob = await resizeImageToBlob(file)
      await db.photos.put({ id: uid(), date: Date.now(), blob })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const toggleCompare = (id: string) => {
    setCompareIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id)
      if (ids.length >= 2) return [ids[1], id]
      return [...ids, id]
    })
  }

  const compareSelection =
    compareIds.length === 2 ? compareIds.map((id) => photos?.find((p) => p.id === id)!).filter(Boolean) : null

  if (photos === undefined) return <SkeletonChart />

  return (
    <div>
      <div className="flex gap-2 pb-4">
        <button className="btn btn-primary flex-1" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <IconCamera size={17} />
          {uploading ? 'Procesando…' : 'Añadir foto'}
        </button>
        {photos.length >= 2 && (
          <button
            className={`btn flex-1 ${compareMode ? 'btn-primary' : 'btn-surface'}`}
            onClick={() => {
              setCompareMode(!compareMode)
              setCompareIds([])
            }}
          >
            Comparar
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {photos.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-muted">
          Tus fotos se guardan solo en este teléfono. Añade la primera para empezar a comparar tu progreso.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {photos.map((p) => {
            const picked = compareIds.includes(p.id)
            return (
              <button
                key={p.id}
                className={`pressable relative aspect-[3/4] overflow-hidden rounded-lg ${
                  picked ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => (compareMode ? toggleCompare(p.id) : setConfirmDelete(p))}
              >
                <img src={blobUrl(p.blob)} className="h-full w-full object-cover" alt={formatShortDate(p.date)} />
                <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-center text-[9px] font-semibold text-white">
                  {formatShortDate(p.date)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {compareSelection && (
        <CompareSheet
          open
          onClose={() => {
            setCompareIds([])
            setCompareMode(false)
          }}
          before={compareSelection[0]}
          after={compareSelection[1]}
        />
      )}

      <Confirm
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="¿Eliminar esta foto?"
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void db.photos.delete(confirmDelete!.id)}
      />
    </div>
  )
}

function CompareSheet({
  open,
  onClose,
  before,
  after,
}: {
  open: boolean
  onClose: () => void
  before: ProgressPhoto
  after: ProgressPhoto
}) {
  const [pos, setPos] = useState(50)
  const [orderedBA, setOrderedBA] = useState(before.date <= after.date)
  const left = orderedBA ? before : after
  const right = orderedBA ? after : before

  return (
    <Sheet open={open} onClose={onClose} title="Comparar">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-surface-2">
        <img src={blobUrl(right.blob)} className="absolute inset-0 h-full w-full object-cover" alt="después" />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
          <img
            src={blobUrl(left.blob)}
            className="h-full object-cover"
            style={{ width: `${(100 / pos) * 100}%`, maxWidth: 'none' }}
            alt="antes"
          />
        </div>
        <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${pos}%` }} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {formatShortDate(left.date)}
        </span>
        <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {formatShortDate(right.date)}
        </span>
      </div>
      <input
        type="range"
        min={2}
        max={98}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="mt-4 w-full"
        aria-label="Posición del comparador"
      />
      <button className="btn btn-surface mt-2 w-full text-sm" onClick={() => setOrderedBA(!orderedBA)}>
        Invertir orden
      </button>
    </Sheet>
  )
}
