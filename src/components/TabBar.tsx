import { Link, useLocation } from 'react-router-dom'
import { IconDumbbell, IconFood, IconHistory, IconList, IconMessage } from './icons'

const tabs = [
  { to: '/', label: 'Entrenar', Icon: IconDumbbell, end: true, related: [] },
  { to: '/nutricion', label: 'Nutrición', Icon: IconFood, end: true, related: [] },
  { to: '/coach', label: 'Coach', Icon: IconMessage, end: true, related: [] },
  { to: '/analisis', label: 'Progreso', Icon: IconHistory, end: false, related: ['/historial', '/medidas'] },
  { to: '/ejercicios', label: 'Biblioteca', Icon: IconList, end: false, related: [] },
]

export function TabBar({ inDock = false }: { inDock?: boolean }) {
  const { pathname } = useLocation()
  return (
    <nav className={`app-nav ${inDock ? 'app-nav--embedded' : ''}`} aria-label="Navegación principal">
      <div className="app-nav__dock">
        <div className="app-nav__items">
          {tabs.map(({ to, label, Icon, end, related }) => {
            const active = end ? pathname === to : pathname.startsWith(to) || related.some((route) => pathname.startsWith(route))
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={`app-nav__item ${active ? 'app-nav__item--active' : ''}`}
              >
                <span className="app-nav__icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.9} />
                </span>
                <span className="app-nav__label">{label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
