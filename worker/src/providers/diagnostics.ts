/** Solo se registran categorías cerradas; nunca texto remoto, prompts ni cabeceras. */
export async function logProviderHttpFailure(provider: 'gemini' | 'nvidia', response: Response): Promise<void> {
  let reason = 'unclassified'
  try {
    const payload: unknown = await response.json()
    const message = (payload as { error?: { message?: unknown } } | null)?.error?.message
    if (typeof message === 'string') {
      if (/too many states|schema.*(?:too complex|too large|too deep)/i.test(message)) reason = 'schema-complexity'
      else if (/schema/i.test(message)) reason = 'schema-invalid'
      else if (/model.*(?:not found|not supported|does not exist)/i.test(message)) reason = 'model-unavailable'
    }
  } catch { /* Un cuerpo no JSON no aporta un diagnóstico seguro. */ }
  console.warn('provider-http-failure', { provider, status: response.status, reason })
}
