import { useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { importHevyApi, importHevyCsvFile, type ImportSummary } from '../lib/hevyImport'
import { IconTarget, IconUpload } from './icons'

export function HevyImportSheet({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (summary: ImportSummary) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (task: () => Promise<ImportSummary>) => {
    setBusy(true)
    setError(null)
    try {
      onImported(await task())
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo importar Hevy.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Importar desde Hevy">
      <div className="space-y-4 pb-3">
        <div className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-3 text-xs leading-relaxed text-muted">
          Importa entrenos, rutinas, carpetas, medidas y ejercicios. Los datos se guardan en este dispositivo y cada lote se puede deshacer.
        </div>

        <section className="card p-3">
          <div className="flex items-center gap-2 text-sm font-bold"><IconUpload size={16} className="text-primary" /> CSV de Hevy</div>
          <p className="pt-1 text-xs text-muted">Selecciona el CSV exportado desde Hevy. No se sube a ningún servidor.</p>
          <button className="btn btn-primary mt-3 w-full text-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            Elegir archivo CSV
          </button>
          <input ref={fileRef} type="file" accept="text/csv,.csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void run(() => importHevyCsvFile(file)); e.currentTarget.value = '' }} />
        </section>

        <section className="card p-3">
          <div className="flex items-center gap-2 text-sm font-bold"><IconTarget size={16} className="text-primary" /> API de Hevy Pro</div>
          <p className="pt-1 text-xs text-muted">La API requiere una key de Hevy Pro. Solo se usa en esta sesión y no se persiste.</p>
          <label className="mt-3 block text-xs font-semibold text-muted" htmlFor="hevy-api-key">API key</label>
          <input id="hevy-api-key" className="input mt-1" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Pega tu API key" />
          <button className="btn btn-surface mt-2 w-full text-sm" disabled={busy || !apiKey.trim()} onClick={() => void run(() => importHevyApi(apiKey))}>
            {busy ? 'Importando…' : 'Importar todos los datos'}
          </button>
        </section>

        {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}
