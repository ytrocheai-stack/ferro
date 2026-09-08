let activeCoachAccountId: string | null = null

/** Cuenta que puede leer y enviar trabajos del coach en este contexto de pestaña. */
export function setCoachAccountId(accountId: string | null | undefined): void {
  activeCoachAccountId = accountId ?? null
}

export function getCoachAccountId(): string | null {
  return activeCoachAccountId
}
