/** Solo se registran categorías cerradas; nunca texto remoto, prompts ni cabeceras. */
export async function logProviderHttpFailure(provider: 'gemini' | 'nvidia', response: Response): Promise<void> {
  let reason = 'unclassified'
  try {
    // Algunos gateways devuelven texto o sobres distintos al JSON del proveedor.
    // El contenido solo se compara con patrones fijos y nunca se registra.
    const message = await response.text()
    if (typeof message === 'string') {
      if (/API key.*(?:not valid|invalid|expired)|API_KEY_INVALID/i.test(message)) reason = 'api-key-invalid'
      else if (/too many states|schema.*(?:too complex|too large|too deep)/i.test(message)) reason = 'schema-complexity'
      else if (/schema/i.test(message)) reason = 'schema-invalid'
      else if (/model.*(?:not found|not supported|does not exist)/i.test(message)) reason = 'model-unavailable'
      else if (/deprecat|retired|decommission/i.test(message)) reason = 'model-retired'
      else if (/billing|paid tier|free tier/i.test(message)) reason = 'billing-restriction'
      else if (/location|region|country/i.test(message)) reason = 'location-restriction'
      else if (/unsupported|not supported|unknown name|invalid argument/i.test(message)) reason = 'unsupported-request'
      else if (/token|payload.*limit|request.*large/i.test(message)) reason = 'request-limit'
    }
  } catch { /* Un cuerpo ilegible no aporta un diagnóstico seguro. */ }
  console.warn('provider-http-failure', { provider, status: response.status, reason })
}
