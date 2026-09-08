import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv, readJson, writeJson, KIMI_MODEL } from '../packages/corpus-pipeline/src/runtime.ts'

// Diagnóstico sin generar respuestas, embeddings ni imprimir secretos.
const root = new URL('../', import.meta.url)
const local = (name: string) => fileURLToPath(new URL(name, root))
const present = (key: string) => Boolean(process.env[key]?.trim())
const before = present('NVIDIA_API_KEY')
loadLocalEnv()
const ledgerPath = local('.cache/corpus/hevy/provider-ledger/ledger.json')
const ledger = existsSync(ledgerPath) ? readJson<{ attempts: Record<string, { state: string }> }>(ledgerPath) : null
const attempts = Object.values(ledger?.attempts ?? {})
const report = {
  schema: 'nextrep-provider-diagnostic-v1', checkedAt: new Date().toISOString(),
  credentials: {
    nvidia: present('NVIDIA_API_KEY'),
    nvidiaSource: before ? 'process-environment' : present('NVIDIA_API_KEY') ? '.env.providers.local' : 'missing',
    cloudflareToken: present('CLOUDFLARE_API_TOKEN'), cloudflareAccount: present('CLOUDFLARE_ACCOUNT_ID'),
  },
  ledger: ledger ? { attempts: attempts.length, completed: attempts.filter(a => a.state === 'completed').length, rejected: attempts.filter(a => a.state === 'rejected').length, pending: attempts.filter(a => a.state === 'pending').length } : null,
  remote: { checked: false, httpStatus: null as number | null, kimiAvailable: false, error: null as string | null },
}
if (process.argv.includes('--verify-remote') && report.credentials.nvidia) {
  report.remote.checked = true
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` }, signal: AbortSignal.timeout(30_000),
    })
    report.remote.httpStatus = response.status
    if (response.ok) {
      const result = await response.json() as { data?: Array<{ id: string }> }
      report.remote.kimiAvailable = result.data?.some(model => model.id === KIMI_MODEL) ?? false
    }
  } catch { report.remote.error = 'network-or-timeout' }
}
const output = process.argv.indexOf('--output')
if (output >= 0) {
  const target = process.argv[output + 1]
  if (!target || target.startsWith('--')) throw new Error('Falta ruta de --output')
  writeJson(target, report)
}
console.log(JSON.stringify(report, null, 2))
if (!report.credentials.nvidia || (report.remote.checked && !report.remote.kimiAvailable)) process.exitCode = 1
