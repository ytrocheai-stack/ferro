import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IconChevronLeft, IconUser } from './icons'

export function PageHeader({
  title,
  subtitle,
  back = false,
  action,
  showProfile = true,
  onBack,
}: {
  title: string
  subtitle?: string
  back?: boolean
  action?: ReactNode
  showProfile?: boolean
  onBack?: () => void
}) {
  const navigate = useNavigate()
  return (
    <header className="page-header">
      <div className="flex min-w-0 items-center gap-2">
        {back && (
          <button className="pressable page-header__back" onClick={onBack ?? (() => navigate(-1))} aria-label="Volver">
            <IconChevronLeft size={22} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        {showProfile && (
          <Link className="page-header__profile pressable" to="/perfil" aria-label="Perfil">
            <IconUser size={19} />
          </Link>
        )}
      </div>
    </header>
  )
}
