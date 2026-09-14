import { useId, type ReactNode } from 'react'

export function EmptyState({ title, description, action, secondary, icon }: { title: string; description: string; action?: ReactNode; secondary?: ReactNode; icon?: ReactNode }) {
  const titleId = useId()
  return (
    <section className="empty-state" aria-labelledby={titleId}>
      {icon && <span className="empty-state__icon" aria-hidden="true">{icon}</span>}
      <h2 id={titleId}>{title}</h2>
      <p>{description}</p>
      {(action || secondary) && <div className="empty-state__actions">{action}{secondary}</div>}
    </section>
  )
}
