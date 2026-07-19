import { useState } from 'react'
import { db } from '../db/db'
import type { MealKey } from '../db/types'
import { macrosForGrams, markFoodUsed, saveCustomFood, searchFoods, toggleFavoriteFood, useFoodCatalog, useOnline, type LocalFood } from '../data/foods'
import { lookupBarcode, searchOpenFoodFacts } from '../lib/openFoodFacts'
import { parseDec, uid } from '../lib/format'
import { Sheet } from './Sheet'
import { BarcodeScanner } from './BarcodeScanner'
import { DishesTab } from './DishPicker'
import { SkeletonList } from './Skeleton'
import { IconBarcode, IconFood, IconPlus, IconSearch, IconStar } from './icons'

type Tab = 'local' | 'dishes' | 'online' | 'scan'

export function FoodPickerSheet({
  open,
  onClose,
  date,
  meal,
}: {
  open: boolean
  onClose: () => void
  date: string
  meal: MealKey
}) {
  const [tab, setTab] = useState<Tab>('local')
  const [picked, setPicked] = useState<LocalFood | null>(null)
  const online = useOnline()

  const close = () => {
    onClose()
    setTab('local')
    setPicked(null)
  }

  const addEntry = async (food: LocalFood, grams: number) => {
    const m = macrosForGrams(food, grams)
    await db.foodLog.put({
      id: uid(),
      date,
      meal,
      foodId: food.id.startsWith('seed-') ? undefined : food.id,
      name: food.name,
      grams,
      ...m,
    })
    void markFoodUsed(food.id)
    close()
  }

  if (picked) {
    return (
      <Sheet open={open} onClose={close} title={picked.name}>
        <GramsForm food={picked} onCancel={() => setPicked(null)} onConfirm={(g) => void addEntry(picked, g)} />
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onClose={close} title="Añadir alimento" full>
      <div className="flex gap-2 overflow-x-auto pb-3">
        <button className={`chip ${tab === 'local' ? 'chip-active' : ''}`} onClick={() => setTab('local')}>
          Local
        </button>
        <button className={`chip ${tab === 'dishes' ? 'chip-active' : ''}`} onClick={() => setTab('dishes')}>
          <IconFood size={13} />
          Platos
        </button>
        <button className={`chip ${tab === 'online' ? 'chip-active' : ''}`} onClick={() => setTab('online')}>
          Buscar online
        </button>
        <button className={`chip ${tab === 'scan' ? 'chip-active' : ''}`} onClick={() => setTab('scan')}>
          <IconBarcode size={13} />
          Escanear
        </button>
      </div>

      {tab === 'local' && <LocalTab onPick={setPicked} />}
      {tab === 'dishes' && <DishesTab date={date} meal={meal} onLogged={close} />}
      {tab === 'online' && <OnlineTab online={online} onPick={setPicked} />}
      {tab === 'scan' && <ScanTab online={online} onPick={setPicked} />}
    </Sheet>
  )
}

function LocalTab({ onPick }: { onPick: (f: LocalFood) => void }) {
  const all = useFoodCatalog()
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const results = searchFoods(all, query)

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <IconSearch size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input pl-9"
          placeholder="Buscar alimento…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
        />
      </div>
      <button
        className="flex items-center gap-2 text-sm font-semibold text-primary"
        onClick={() => setCreateOpen(true)}
      >
        <IconPlus size={15} />
        Crear alimento personalizado
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.map((f) => (
          <FoodRow key={f.id} food={f} onClick={() => onPick(f)} onToggleFavorite={(x) => void toggleFavoriteFood(x)} />
        ))}
        {results.length === 0 && <p className="py-8 text-center text-sm text-muted">Sin resultados.</p>}
      </div>
      <CreateFoodSheet open={createOpen} onClose={() => setCreateOpen(false)} onCreated={onPick} />
    </div>
  )
}

function OnlineTab({ online, onPick }: { online: boolean; onPick: (f: LocalFood) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LocalFood[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const foods = await searchOpenFoodFacts(query.trim())
      setResults(
        foods.map((f) => ({
          id: f.id,
          name: f.name + (f.brand ? ` (${f.brand})` : ''),
          kcal100: f.kcal100,
          p100: f.p100,
          c100: f.c100,
          f100: f.f100,
          servingG: f.servingG ?? 100,
          source: 'off',
          favorite: f.favorite,
        })),
      )
    } catch {
      setError('No se pudo buscar. Comprueba tu conexión.')
    } finally {
      setLoading(false)
    }
  }

  if (!online) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        Sin conexión: la búsqueda online no está disponible ahora. Usa la pestaña «Local» (incluye
        alimentos ya buscados antes).
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Buscar producto (Open Food Facts)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
        <button className="btn btn-primary px-4" onClick={() => void search()} disabled={loading}>
          Buscar
        </button>
      </div>
      {loading && <SkeletonList rows={4} />}
      {error && <p className="text-sm text-danger">{error}</p>}
      {results && !loading && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {results.map((f) => (
            <FoodRow
              key={f.id}
              food={f}
              onClick={() => onPick(f)}
              onToggleFavorite={(x) => {
                void toggleFavoriteFood(x)
                // los resultados online son un snapshot local: reflejar el cambio a mano
                setResults((rs) => rs?.map((y) => (y.id === x.id ? { ...y, favorite: !y.favorite } : y)) ?? rs)
              }}
            />
          ))}
          {results.length === 0 && <p className="py-8 text-center text-sm text-muted">Sin resultados.</p>}
        </div>
      )}
    </div>
  )
}

function ScanTab({ online, onPick }: { online: boolean; onPick: (f: LocalFood) => void }) {
  const [code, setCode] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'notfound' | 'error'>('idle')

  const handleDetect = async (raw: string) => {
    if (code) return
    setCode(raw)
    // sin conexión también se intenta: lookupBarcode resuelve primero desde la caché Dexie
    setState('loading')
    try {
      const food = await lookupBarcode(raw)
      if (!food) {
        setState('notfound')
        return
      }
      onPick({
        id: food.id,
        name: food.name + (food.brand ? ` (${food.brand})` : ''),
        kcal100: food.kcal100,
        p100: food.p100,
        c100: food.c100,
        f100: food.f100,
        servingG: food.servingG ?? 100,
        source: 'off',
      })
    } catch {
      setState('error')
    }
  }

  return (
    <div>
      {!online && !code && (
        <p className="pb-2 text-center text-xs text-muted">
          Sin conexión: solo se reconocerán códigos ya escaneados o buscados antes.
        </p>
      )}
      {!code && <BarcodeScanner onDetect={(c) => void handleDetect(c)} />}
      {state === 'loading' && <p className="pt-3 text-center text-sm text-muted">Buscando código {code}…</p>}
      {state === 'notfound' && (
        <div className="pt-3 text-center text-sm text-muted">
          No encontramos el código {code} en Open Food Facts.
          <button className="mt-2 block w-full text-primary" onClick={() => setCode(null)}>
            Escanear otro
          </button>
        </div>
      )}
      {state === 'error' && (
        <div className="pt-3 text-center text-sm text-danger">
          {online
            ? 'No se pudo consultar el producto (error de red).'
            : 'Sin conexión y este código no está en la caché local.'}
          <button className="mt-2 block w-full text-primary" onClick={() => setCode(null)}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  )
}

function FoodRow({
  food,
  onClick,
  onToggleFavorite,
}: {
  food: LocalFood
  onClick: () => void
  onToggleFavorite?: (f: LocalFood) => void
}) {
  return (
    <div className="flex w-full items-center gap-1 border-b border-border/60">
      <button onClick={onClick} className="min-w-0 flex-1 py-2.5 text-left">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{food.name}</span>
          {food.favorite && !onToggleFavorite && <IconStar size={12} className="shrink-0 text-warning" />}
        </div>
        <div className="text-xs text-muted tabular-nums">
          {food.kcal100} kcal · P{food.p100} C{food.c100} G{food.f100} /100g
        </div>
      </button>
      {onToggleFavorite && (
        <button
          className="pressable shrink-0 p-2"
          onClick={() => onToggleFavorite(food)}
          aria-label={food.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'}
        >
          <IconStar size={17} className={food.favorite ? 'text-warning' : 'text-muted/30'} />
        </button>
      )}
    </div>
  )
}

function GramsForm({
  food,
  onCancel,
  onConfirm,
}: {
  food: LocalFood
  onCancel: () => void
  onConfirm: (grams: number) => void
}) {
  const [grams, setGrams] = useState(String(food.servingG || 100))
  const g = parseDec(grams)
  const m = macrosForGrams(food, g)

  return (
    <div className="flex flex-col gap-4 pb-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted">Cantidad (g)</span>
        <input
          autoFocus
          className="input text-center text-lg font-bold"
          inputMode="decimal"
          value={grams}
          onChange={(e) => setGrams(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
      </label>
      <div className="grid grid-cols-4 gap-2 text-center">
        <MacroBox label="Kcal" value={m.kcal} />
        <MacroBox label="Prot." value={`${m.p}g`} />
        <MacroBox label="Carbs" value={`${m.c}g`} />
        <MacroBox label="Grasa" value={`${m.f}g`} />
      </div>
      <div className="flex gap-3">
        <button className="btn btn-surface flex-1" onClick={onCancel}>
          Volver
        </button>
        <button className="btn btn-primary flex-1" disabled={g <= 0} onClick={() => onConfirm(g)}>
          Añadir
        </button>
      </div>
    </div>
  )
}

function MacroBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card px-1 py-2">
      <div className="text-[10px] font-bold uppercase text-muted">{label}</div>
      <div className="pt-0.5 text-sm font-bold tabular-nums">{value}</div>
    </div>
  )
}

function CreateFoodSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (f: LocalFood) => void
}) {
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')
  const [p, setP] = useState('')
  const [c, setC] = useState('')
  const [f, setF] = useState('')

  const save = async () => {
    if (!name.trim()) return
    const values = { kcal100: parseDec(kcal), p100: parseDec(p), c100: parseDec(c), f100: parseDec(f) }
    const id = await saveCustomFood({ name: name.trim(), ...values })
    onCreated({ id, name: name.trim(), ...values, servingG: 100, source: 'custom' })
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Alimento personalizado">
      <div className="flex flex-col gap-3 pb-2">
        <input className="input" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="text-xs text-muted">Valores por 100 g</p>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="Kcal" inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} />
          <input className="input" placeholder="Proteína (g)" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} />
          <input className="input" placeholder="Carbohidratos (g)" inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} />
          <input className="input" placeholder="Grasas (g)" inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} />
        </div>
        <button className="btn btn-primary mt-1" disabled={!name.trim()} onClick={() => void save()}>
          Guardar y usar
        </button>
      </div>
    </Sheet>
  )
}
