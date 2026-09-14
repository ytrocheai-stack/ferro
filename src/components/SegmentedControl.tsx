import { useId } from 'react'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  panelId?: string
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  const id = useId()
  const select = (index: number) => {
    const option = options[(index + options.length) % options.length]
    onChange(option.value)
    document.getElementById(`${id}-${option.value}`)?.focus()
  }
  return (
    <div className="segmented-control" role="tablist" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            id={`${id}-${option.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={option.panelId}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                select(index + 1)
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault()
                select(index - 1)
              } else if (event.key === 'Home') {
                event.preventDefault()
                select(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                select(options.length - 1)
              }
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
