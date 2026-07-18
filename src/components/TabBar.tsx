import { NavLink, useLocation } from 'react-router-dom'
import { IconDumbbell, IconFood, IconHistory, IconList, IconUser } from './icons'

const tabs = [
  { to: '/', label: 'Entrenar', Icon: IconDumbbell, end: true },
  { to: '/historial', label: 'Historial', Icon: IconHistory, end: false },
  { to: '/nutricion', label: 'Nutrición', Icon: IconFood, end: false },
  { to: '/ejercicios', label: 'Ejercicios', Icon: IconList, end: false },
  { to: '/perfil', label: 'Perfil', Icon: IconUser, end: false },
]

export function TabBar() {
  const { pathname } = useLocation()
  const activeIndex = tabs.findIndex((t) =>
    t.end ? pathname === t.to : pathname.startsWith(t.to),
  )

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40">
      <div className="relative mx-auto max-w-md border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {activeIndex >= 0 && (
          <span
            className="absolute top-0 h-0.5 w-1/5 rounded-full bg-primary transition-transform duration-200"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
            aria-hidden="true"
          />
        )}
        <div className="grid grid-cols-5">
          {tabs.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-12 flex-col items-center gap-1 py-2 text-[10px] font-medium ${
                  isActive ? 'text-primary' : 'text-muted'
                }`
              }
            >
              <Icon size={21} />
              {label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
