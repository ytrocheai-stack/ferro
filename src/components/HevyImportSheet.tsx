import { useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { importHevyApi, importHevyFile, type ImportSummary } from '../lib/hevyImport'
import { IconTarget, IconUpload } from './icons'

const HEVY_EXPORT_GUIDE =
  'https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy'

export function HevyImportSheet({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  onImported: (summary: ImportSummary) => void
}) {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo importar Hevy.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Importar desde Hevy">
      <div className="space-y-4 pb-3">
        <div className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-3 text-xs leading-relaxed text-muted">
          Importa entrenos, rutinas, carpetas, medidas y ejercicios. Los datos se guardan en
          este dispositivo y cada lote se puede deshacer.
        </div>

        <section className="card p-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <IconUpload size={16} className="text-primary" /> CSV o XLSX de Hevy
          </div>
          <div className="mt-2 rounded-xl border border-border/70 bg-surface-2/70 p-3">
            <p className="text-xs font-semibold text-text">Primero expórtalo desde Hevy</p>
            <p className="pt-1 text-xs leading-relaxed text-muted">
              En Hevy: Perfil → Ajustes → Exportar e importar datos → Exportar datos → Exportar
              entrenamientos. Después guarda o descarga el CSV en este dispositivo.
            </p>
            <a
              className="mt-2 inline-flex min-h-11 items-center text-xs font-bold text-primary underline decoration-primary/40 underline-offset-4"
              href={HEVY_EXPORT_GUIDE}
              target="_blank"
              rel="noreferrer"
            >
              Ver guía oficial de Hevy
            </a>
          </div>
          <p className="pt-2 text-xs text-muted">
            NextRep lo procesa localmente; el archivo no se sube a ningún servidor. Se aceptan
            exportaciones CSV y Excel (.xlsx).
          </p>
          <button
            className="btn btn-primary mt-3 w-full text-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Leyendo archivo…' : 'Ya tengo el archivo'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void run(() => importHevyFile(file))
              event.currentTarget.value = ''
            }}
          />
        </section>

        <section className="card p-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <IconTarget size={16} className="text-primary" /> API de Hevy Pro
          </div>
          <p className="pt-1 text-xs text-muted">
            Si tienes Hevy Pro, la API evita manejar archivos. La clave solo se usa en esta
            sesión y nunca se persiste.
          </p>
          <label className="mt-3 block text-xs font-semibold text-muted" htmlFor="hevy-api-key">
            API key
          </label>
          <input
            id="hevy-api-key"
            className="input mt-1"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Pega tu API key"
          />
          <button
            className="btn btn-surface mt-2 w-full text-sm"
            disabled={busy || !apiKey.trim()}
            onClick={() => void run(() => importHevyApi(apiKey))}
          >
            {busy ? 'Importando…' : 'Importar todos los datos'}
          </button>
        </section>

        {error && (
          <p className="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  )
}
