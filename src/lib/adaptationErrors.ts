import type { AdaptationJobErrorCode } from '../db/types'

export const CONTEXT_INVALIDATED_MESSAGE = 'El contexto cambió; requiere un nuevo análisis.'

export function localizeAdaptationJobError(code: AdaptationJobErrorCode): string {
  return code === 'session-expired'
    ? 'Tu sesión expiró; inicia sesión de nuevo.'
    : code === 'unauthorized'
      ? 'Tu cuenta aún no está habilitada para la beta.'
      : code === 'quota-exhausted'
        ? 'Alcanzaste el límite semanal del coach.'
        : code === 'conflict'
          ? 'La solicitud ya tiene otra identidad; no se reintentó.'
          : code === 'invalid-response'
            ? 'El Worker devolvió una respuesta no válida.'
            : code === 'context-invalidated'
              ? CONTEXT_INVALIDATED_MESSAGE
              : 'Fallo temporal; se reintentará cuando haya conexión.'
}
