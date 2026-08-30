import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/react'

/** Authentication actions kept visible in the app chrome so account access is discoverable. */
export function AuthControls() {
  return (
    <div className="flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted" type="button">
            Iniciar sesión
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-white shadow-sm" type="button">
            Crear cuenta
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  )
}
