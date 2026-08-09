import { Link, useLocation } from 'react-router-dom'
import { IconDumbbell, IconFood, IconHistory, IconList, IconUser } from './icons'

const tabs = [
  { to: '/', label: 'Entrenar', Icon: IconDumbbell, end: true, related: [] },
  { to: '/historial', label: 'Historial', Icon: IconHistory, end: false, related: [] },
  { to: '/nutricion', label: 'Nutrición', Icon: IconFood, end: false, related: [] },
  { to: '/ejercicios', label: 'Ejercicios', Icon: IconList, end: false, related: [] },
  { to: '/perfil', label: 'Perfil', Icon: IconUser, end: false, related: ['/analisis', '/medidas'] },
]

export function TabBar() {
  const { pathname } = useLocation()
  return (
    <nav className="app-nav" aria-label="Navegación principal">
      <div className="app-nav__dock">
        <div className="app-nav__items">
          {tabs.map(({ to, label, Icon, end, related }) => {
            const active = end
              ? pathname === to
              : pathname.startsWith(to) || related.some((route) => pathname.startsWith(route))
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
