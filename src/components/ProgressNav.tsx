import { NavLink } from 'react-router-dom'

const links = [
  { to: '/analisis', label: 'Análisis', end: true },
  { to: '/historial', label: 'Historial', end: false },
  { to: '/medidas', label: 'Medidas', end: false },
]

export function ProgressNav() {
  return (
    <nav className="progress-nav" aria-label="Secciones de progreso">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) => isActive ? 'progress-nav__link progress-nav__link--active' : 'progress-nav__link'}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  )
}
