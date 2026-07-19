import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Dish, DishItem, MealKey } from '../db/types'
import { macrosForGrams, searchFoods, useFoodCatalog, type LocalFood } from '../data/foods'
import { parseDec, uid } from '../lib/format'
import { toastUndo } from '../stores/toasts'
import { ActionSheet, Confirm, Sheet } from './Sheet'
import { IconDots, IconPencil, IconPlus, IconSearch, IconTrash } from './icons'

const round1 = (n: number) => Math.round(n * 10) / 10

function dishTotals(items: DishItem[]) {
  return items.reduce(
    (t, it) => ({
      grams: t.grams + it.grams,
      kcal: t.kcal + it.kcal,
      p: t.p + it.p,
      c: t.c + it.c,
      f: t.f + it.f,
    }),
    { grams: 0, kcal: 0, p: 0, c: 0, f: 0 },
  )
}

/** Pestaña «Platos» del selector de comida: registrar un plato guardado (con ración),
 *  y crear/editar/eliminar platos combinando varios alimentos. */
export function DishesTab({ date, meal, onLogged }: { date: string; meal: MealKey; onLogged: () => void }) {
  const dishes = useLiveQuery(() => db.dishes.orderBy('name').toArray(), [], undefined)
  const [portionFor, setPortionFor] = useState<Dish | null>(null)
  const [menuFor, setMenuFor] = useState<Dish | null>(null)
  const [editorFor, setEditorFor] = useState<Dish | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Dish | null>(null)

  const logDish = async (dish: Dish, mult: number) => {
    const t = dishTotals(dish.items)
    await db.foodLog.put({
      id: uid(),
      date,
      meal,
      name: dish.name,
      grams: Math.round(t.grams * mult),
      kcal: Math.round(t.kcal * mult),
      p: round1(t.p * mult),
      c: round1(t.c * mult),
      f: round1(t.f * mult),
    })
    onLogged()
  }

  const removeDish = (dish: Dish) => {
    void db.dishes.delete(dish.id)
    toastUndo('Plato eliminado', () => void db.dishes.put(dish))
  }

  if (dishes === undefined) return null

  return (
    <div className="flex h-full flex-col gap-3">
      <button
        className="flex items-center gap-2 text-sm font-semibold text-primary"
        onClick={() => setEditorFor('new')}
      >
        <IconPlus size={15} />
        Nuevo plato
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {dishes.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            Crea un plato (p. ej. «Ensalada de pollo») combinando varios alimentos, y regístralo
            luego de un solo toque.
          </p>
        ) : (
          dishes.map((d) => {
            const t = dishTotals(d.items)
            return (
              <div key={d.id} className="flex w-full items-center gap-1 border-b border-border/60">
                <button onClick={() => setPortionFor(d)} className="min-w-0 flex-1 py-2.5 text-left">
                  <div className="truncate text-sm font-semibold">{d.name}</div>
                  <div className="text-xs text-muted tabular-nums">
                    {Math.round(t.kcal)} kcal · {d.items.length}{' '}
                    {d.items.length === 1 ? 'alimento' : 'alimentos'} · {Math.round(t.grams)}g
                  </div>
                </button>
                <button
                  className="pressable shrink-0 p-2 text-muted"
                  onClick={() => setMenuFor(d)}
                  aria-label="Opciones del plato"
                >
                  <IconDots size={16} />
                </button>
              </div>
            )
          })
        )}
      </div>

      <DishPortionSheet
        dish={portionFor}
        onClose={() => setPortionFor(null)}
        onConfirm={(mult) => {
          const d = portionFor
          setPortionFor(null)
          if (d) void logDish(d, mult)
        }}
      />
      <ActionSheet
        open={!!menuFor}
        onClose={() => setMenuFor(null)}
        title={menuFor?.name}
        actions={[
          { label: 'Editar plato', icon: <IconPencil size={18} />, onClick: () => setEditorFor(menuFor!) },
          { label: 'Eliminar', danger: true, icon: <IconTrash size={18} />, onClick: () => setConfirmDelete(menuFor!) },
        ]}
      />
      <Confirm
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="¿Eliminar este plato?"
        message="Las comidas ya registradas con él no cambian."
        confirmLabel="Eliminar"
        danger
        onConfirm={() => {
          if (confirmDelete) removeDish(confirmDelete)
        }}
      />
      {editorFor !== null && (
        <DishEditorSheet dish={editorFor === 'new' ? null : editorFor} onClose={() => setEditorFor(null)} />
      )}
    </div>
  )
}

const PORTIONS = [0.5, 1, 1.5, 2]

/** Elegir la ración (multiplicador) de un plato antes de registrarlo. */
function DishPortionSheet({
  dish,
  onClose,
  onConfirm,
}: {
  dish: Dish | null
  onClose: () => void
  onConfirm: (mult: number) => void
}) {
  const [mult, setMult] = useState(1)
  const [custom, setCustom] = useState('')

  useEffect(() => {
    if (dish) {
      setMult(1)
      setCustom('')
    }
  }, [dish])

  const effective = custom.trim() ? parseDec(custom) : mult
  const t = dish ? dishTotals(dish.items) : { grams: 0, kcal: 0, p: 0, c: 0, f: 0 }

  return (
    <Sheet open={!!dish} onClose={onClose} title={dish?.name}>
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <span className="text-xs font-semibold text-muted">Ración</span>
          <div className="flex items-center gap-2 pt-1.5">
            {PORTIONS.map((p) => (
              <button
                key={p}
                className={`chip ${!custom.trim() && mult === p ? 'chip-active' : ''}`}
                onClick={() => {
                  setMult(p)
                  setCustom('')
                }}
              >
                {p}×
              </button>
            ))}
            <input
              className="input w-20 px-2 py-1.5 text-center text-sm"
              inputMode="decimal"
              placeholder="Otra"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Ración personalizada"
            />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <DishMacroBox label="Kcal" value={Math.round(t.kcal * effective)} />
          <DishMacroBox label="Prot." value={`${round1(t.p * effective)}g`} />
          <DishMacroBox label="Carbs" value={`${round1(t.c * effective)}g`} />
          <DishMacroBox label="Grasa" value={`${round1(t.f * effective)}g`} />
        </div>
        <button className="btn btn-primary" disabled={effective <= 0} onClick={() => onConfirm(effective)}>
          Registrar{dish ? ` (${Math.round(t.grams * effective)}g)` : ''}
        </button>
      </div>
    </Sheet>
  )
}

function DishMacroBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card px-1 py-2">
      <div className="text-[10px] font-bold uppercase text-muted">{label}</div>
      <div className="pt-0.5 text-sm font-bold tabular-nums">{value}</div>
    </div>
  )
}

/** Crear o editar un plato: nombre + lista de alimentos con sus gramos. */
function DishEditorSheet({ dish, onClose }: { dish: Dish | null; onClose: () => void }) {
  const catalog = useFoodCatalog()
  const [name, setName] = useState(dish?.name ?? '')
  const [items, setItems] = useState<DishItem[]>(dish?.items ?? [])
  const [addOpen, setAddOpen] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)

  const t = dishTotals(items)

  const save = async () => {
    if (!name.trim() || items.length === 0) return
    await db.dishes.put({
      id: dish?.id ?? uid(),
      name: name.trim(),
      items,
      createdAt: dish?.createdAt ?? Date.now(),
    })
    onClose()
  }

  const setItemGrams = (idx: number, g: number) => {
    setItems((xs) =>
      xs.map((it, i) => {
        if (i !== idx) return it
        const food = catalog.find((f) => f.id === it.foodId)
        if (food) return { ...it, grams: g, ...macrosForGrams(food, g) }
        // el alimento origen ya no existe: escala proporcional
        const ratio = g / it.grams
        return {
          ...it,
          grams: g,
          kcal: Math.round(it.kcal * ratio),
          p: round1(it.p * ratio),
          c: round1(it.c * ratio),
          f: round1(it.f * ratio),
        }
      }),
    )
  }

  return (
    <Sheet open onClose={onClose} title={dish ? 'Editar plato' : 'Nuevo plato'} full>
      <div className="flex h-full flex-col gap-3">
        <input
          className="input"
          placeholder="Nombre del plato (p. ej. Ensalada de pollo)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="flex items-center gap-2 text-sm font-semibold text-primary"
          onClick={() => setAddOpen(true)}
        >
          <IconPlus size={15} />
          Añadir alimento
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Añade al menos un alimento.</p>
          ) : (
            items.map((it, i) => (
              <div key={`${it.foodId}-${i}`} className="flex items-center gap-1 border-b border-border/60 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.name}</div>
                  <div className="text-xs text-muted tabular-nums">
                    {it.grams}g · {Math.round(it.kcal)} kcal
                  </div>
                </div>
                <button
                  className="pressable shrink-0 p-2 text-muted"
                  onClick={() => setEditIdx(i)}
                  aria-label={`Cambiar gramos de ${it.name}`}
                >
                  <IconPencil size={15} />
                </button>
                <button
                  className="pressable shrink-0 p-2 text-danger"
                  onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                  aria-label={`Quitar ${it.name}`}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            ))
          )}
        </div>
        {items.length > 0 && (
          <p className="text-center text-xs text-muted tabular-nums">
            Total: {Math.round(t.grams)}g · {Math.round(t.kcal)} kcal · P{round1(t.p)} C{round1(t.c)} G{round1(t.f)}
          </p>
        )}
        <button
          className="btn btn-primary mb-2"
          disabled={!name.trim() || items.length === 0}
          onClick={() => void save()}
        >
          {dish ? 'Guardar cambios' : 'Guardar plato'}
        </button>
      </div>

      <AddDishItemSheet open={addOpen} onClose={() => setAddOpen(false)} onAdd={(it) => setItems((xs) => [...xs, it])} />
      <EditItemGramsSheet
        item={editIdx !== null ? (items[editIdx] ?? null) : null}
        onClose={() => setEditIdx(null)}
        onSave={(g) => {
          if (editIdx !== null) setItemGrams(editIdx, g)
          setEditIdx(null)
        }}
      />
    </Sheet>
  )
}

/** Buscar un alimento del catálogo y elegir sus gramos para añadirlo al plato. */
function AddDishItemSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (item: DishItem) => void
}) {
  const all = useFoodCatalog()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<LocalFood | null>(null)
  const [grams, setGrams] = useState('100')

  const close = () => {
    onClose()
    setQuery('')
    setPicked(null)
  }

  if (picked) {
    const g = parseDec(grams)
    const m = macrosForGrams(picked, g)
    return (
      <Sheet open={open} onClose={close} title={picked.name}>
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
          <p className="text-center text-xs text-muted tabular-nums">
            {m.kcal} kcal · P{m.p} C{m.c} G{m.f}
          </p>
          <div className="flex gap-3">
            <button className="btn btn-surface flex-1" onClick={() => setPicked(null)}>
              Volver
            </button>
            <button
              className="btn btn-primary flex-1"
              disabled={g <= 0}
              onClick={() => {
                onAdd({ foodId: picked.id, name: picked.name, grams: g, ...m })
                close()
              }}
            >
              Añadir
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  const results = searchFoods(all, query)
  return (
    <Sheet open={open} onClose={close} title="Añadir alimento al plato" full>
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          {results.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setPicked(f)
                setGrams(String(f.servingG || 100))
              }}
              className="flex w-full items-center justify-between gap-2 border-b border-border/60 py-2.5 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{f.name}</div>
                <div className="text-xs text-muted tabular-nums">
                  {f.kcal100} kcal · P{f.p100} C{f.c100} G{f.f100} /100g
                </div>
              </div>
            </button>
          ))}
          {results.length === 0 && <p className="py-8 text-center text-sm text-muted">Sin resultados.</p>}
        </div>
      </div>
    </Sheet>
  )
}

/** Cambiar los gramos de un alimento ya añadido al plato. */
function EditItemGramsSheet({
  item,
  onClose,
  onSave,
}: {
  item: DishItem | null
  onClose: () => void
  onSave: (grams: number) => void
}) {
  const [grams, setGrams] = useState('')

  useEffect(() => {
    if (item) setGrams(String(item.grams))
  }, [item])

  return (
    <Sheet open={!!item} onClose={onClose} title={item?.name}>
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
        <button className="btn btn-primary" disabled={parseDec(grams) <= 0} onClick={() => onSave(parseDec(grams))}>
          Guardar
        </button>
      </div>
    </Sheet>
  )
}
