import { useState } from 'react'
import { Sheet } from './Sheet'
import { IconCheck, IconChevronDown } from './icons'

export interface SelectOption<T extends string | number> {
  value: T
  label: string
  hint?: string
}

/**
 * Sustituto de `<select>` nativo con el mismo aspecto que `.input`: abre una hoja inferior
 * con las opciones en vez del desplegable del sistema operativo (que rompe el tema oscuro).
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  sheetTitle,
  className = '',
  disabled = false,
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (v: T) => void
  /** título de la hoja de opciones; si se omite, la hoja no muestra encabezado */
  sheetTitle?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className={`input flex items-center justify-between gap-2 text-left disabled:opacity-50 ${className}`}
        onClick={() => setOpen(true)}
      >
        <span className="truncate">{current?.label ?? '—'}</span>
        <IconChevronDown size={15} className="shrink-0 text-muted" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={sheetTitle}>
        <div className="flex flex-col pb-2">
          {options.map((o) => {
            const selected = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left active:bg-surface-2"
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${selected ? 'font-semibold text-primary' : ''}`}>
                    {o.label}
                  </span>
                  {o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}
                </span>
                {selected && <IconCheck size={17} className="shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      </Sheet>
    </>
  )
}
