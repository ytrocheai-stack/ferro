/** Placeholders con shimmer para estados de carga (>300 ms). */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden="true" />
}

/** Fila de lista de ejercicios (thumb + dos líneas). */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5" aria-hidden="true">
      <Skeleton className="h-[46px] w-[46px] shrink-0 rounded-xl" />
      <div className="flex-1">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="mt-1.5 h-3 w-1/2" />
      </div>
    </div>
  )
}

export function SkeletonList({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}

export function SkeletonChart() {
  return (
    <div className="card px-3 py-3" aria-hidden="true">
      <Skeleton className="h-[220px] w-full rounded-xl" />
    </div>
  )
}

/** Fallback para páginas lazy. */
export function PageFallback() {
  return (
    <div className="px-4 pt-6" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-5 h-24 w-full rounded-2xl" />
      <Skeleton className="mt-3 h-24 w-full rounded-2xl" />
      <Skeleton className="mt-3 h-24 w-full rounded-2xl" />
    </div>
  )
}
