import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/react'

/** Authentication actions kept visible in the app chrome so account access is discoverable. */
export function AuthControls() {
  return (
    <div className="flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="btn btn-surface flex-1 px-3 text-sm" type="button">
            Iniciar sesión
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="btn btn-primary flex-1 px-3 text-sm" type="button">
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
