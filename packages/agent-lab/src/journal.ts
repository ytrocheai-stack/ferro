import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fingerprint } from './identity.ts'
import type { LabRun } from './types.ts'

type Reservation = { fingerprint: string; calls: number; inputTokens: number; outputTokens: number }
interface Entry {
  schema: 'agent-lab-journal-v1'
  identity: string
  state: 'pending' | 'completed'
  reservation?: Reservation
  run?: LabRun
  runHash?: string
}

function durableWrite(file: string, value: unknown, exclusive = false): void {
  const descriptor = openSync(file, exclusive ? 'wx' : 'w')
  try { writeFileSync(descriptor, JSON.stringify(value, null, 2)); fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

/** Diario local: creación exclusiva, reserva antes de facturar y commit por rename. */
export class LabJournal {
  private directory: string
  constructor(directory: string) { this.directory = directory; mkdirSync(directory, { recursive: true }) }

  reservedCalls(): number {
    return this.reservedUsage().calls
  }

  reservedUsage(): { calls: number; inputTokens: number; outputTokens: number } {
    return readdirSync(this.directory).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).reduce((total, file) => {
      const entry = JSON.parse(readFileSync(join(this.directory, file), 'utf8')) as Entry
      if (entry.schema !== 'agent-lab-journal-v1') throw new Error('Diario corrupto')
      const reservation = entry.reservation
      const run = entry.run
      return {
        calls: total.calls + Math.max(reservation?.calls ?? 0, run?.calls ?? 0),
        inputTokens: total.inputTokens + Math.max(reservation?.inputTokens ?? 0, run?.usage?.inputTokens ?? 0),
        outputTokens: total.outputTokens + Math.max(reservation?.outputTokens ?? 0, run?.usage?.outputTokens ?? 0),
      }
    }, { calls: 0, inputTokens: 0, outputTokens: 0 })
  }

  async execute(key: string, identity: unknown, action: (beforeAttempt: (reservation: Reservation) => Promise<void>) => Promise<LabRun>): Promise<LabRun> {
    const file = join(this.directory, `${fingerprint(key)}.json`)
    const identityHash = fingerprint(identity)
    const restore = (): LabRun => {
      const entry = JSON.parse(readFileSync(file, 'utf8')) as Entry
      if (entry.schema !== 'agent-lab-journal-v1' || entry.identity !== identityHash) throw new Error('Checkpoint corrupto o identidad distinta; usa un nuevo directorio para una nueva evaluación')
      if (entry.state !== 'completed') throw new Error(`Intento incierto pendiente de conciliación: ${entry.reservation?.calls ?? 0} llamadas reservadas. No se reintenta automáticamente.`)
      if (!entry.run || entry.runHash !== fingerprint(entry.run)) throw new Error('Checkpoint corrupto: huella de run inválida')
      return structuredClone(entry.run)
    }
    if (existsSync(file)) return restore()
    const entry: Entry = { schema: 'agent-lab-journal-v1', identity: identityHash, state: 'pending' }
    try { durableWrite(file, entry, true) } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return restore()
      throw error
    }
    const update = () => {
      const temporary = `${file}.tmp`
      durableWrite(temporary, entry)
      renameSync(temporary, file)
    }
    const run = await action(async reservation => { entry.reservation = reservation; update() })
    entry.state = 'completed'; entry.run = run; entry.runHash = fingerprint(run)
    update()
    return structuredClone(run)
  }
}
