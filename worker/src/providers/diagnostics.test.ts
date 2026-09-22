import { describe, expect, it, vi } from 'vitest'
import { logProviderHttpFailure } from './diagnostics'

describe('diagnóstico privado de proveedores', () => {
  it('clasifica el rechazo de esquema sin registrar cuerpo, claves ni prompt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await logProviderHttpFailure('gemini', Response.json({ error: { message: 'Schema has too many states for serving. secret-key private-prompt' } }, { status: 400 }))
      expect(warn.mock.calls).toEqual([['provider-http-failure', { provider: 'gemini', status: 400, reason: 'schema-complexity' }]])
    } finally { warn.mockRestore() }
  })

  it('omite texto arbitrario incluso si el error no es JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await logProviderHttpFailure('nvidia', new Response('private-prompt secret-key', { status: 403 }))
      expect(warn.mock.calls).toEqual([['provider-http-failure', { provider: 'nvidia', status: 403, reason: 'unclassified' }]])
    } finally { warn.mockRestore() }
  })
})
