import { NavLink } from 'react-router-dom'
import { IconDumbbell, IconHistory, IconList, IconUser } from './icons'

const tabs = [
  { to: '/', label: 'Entrenar', Icon: IconDumbbell, end: true },
  { to: '/historial', label: 'Historial', Icon: IconHistory, end: false },
  { to: '/ejercicios', label: 'Ejercicios', Icon: IconList, end: false },
  { to: '/perfil', label: 'Perfil', Icon: IconUser, end: false },
]

export function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40">
      <div className="mx-auto max-w-md border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="grid grid-cols-4">
          {tabs.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2 text-[11px] font-medium ${
                  isActive ? 'text-primary' : 'text-muted'
                }`
              }
            >
              <Icon size={22} />
              {label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
