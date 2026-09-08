/* eslint-disable react-refresh/only-export-components -- test-only Clerk surface intentionally exports hooks and components. */
import { createContext, useContext, type ReactNode } from 'react'

const accountId = 'user_e2e_coach'
const token = 'e2e-coach-token'

type AuthState = {
  isLoaded: true
  isSignedIn: true
  userId: string
  getToken: () => Promise<string>
}

const AuthContext = createContext<AuthState>({ isLoaded: true, isSignedIn: true, userId: accountId, getToken: async () => token })

export function ClerkProvider({ children }: { children: ReactNode; [key: string]: unknown }) {
  return <AuthContext.Provider value={{ isLoaded: true, isSignedIn: true, userId: accountId, getToken: async () => token }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

export function Show({ when, children }: { when: 'signed-in' | 'signed-out'; children: ReactNode }) {
  return when === 'signed-in' ? <>{children}</> : null
}

type ButtonProps = { children: ReactNode; mode?: string }
export function SignInButton({ children }: ButtonProps) { return <>{children}</> }
export function SignUpButton({ children }: ButtonProps) { return <>{children}</> }
export function UserButton() { return <span aria-label="Cuenta E2E">Cuenta E2E</span> }
