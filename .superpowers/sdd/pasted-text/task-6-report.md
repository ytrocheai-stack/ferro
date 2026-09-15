# Task 6 — informe de cierre

## Estado

Completado y verificado en el worktree `coach-gemini-nvidia`.

Se implementó `CoachGenerationRouter` y se conectó únicamente al Workflow de `/v1/coach/runs`. La ruta `/v1/adaptations/analyze` conserva el camino determinista y no realiza llamadas a proveedores generativos.

## Implementación

- Orden predeterminado `gemini,nvidia`, con failover acotado a un intento enviado por proveedor y como máximo dos solicitudes por llamada lógica.
- Failover para red, timeout, HTTP 408/429/5xx, respuesta vacía, safety/refusal, truncado, JSON/contrato inválido y configuración/autenticación del proveedor.
- Cancelación sin fallback ni despacho posterior.
- Circuito D1 independiente por proveedor, incluyendo prueba half-open para la recuperación de Gemini después de NVIDIA.
- Ledger durable de intentos con `provider`, `model`, `logical_call_no`, `dispatch_status`, estado y fingerprint estable.
- Los intentos `sent`/`uncertain` no se reenvían; una respuesta durable `succeeded` se reutiliza al reanudar.
- Corregida la reanudación posterior al deadline: una respuesta cacheada confirmada se rehidrata sin aplicar el deadline original ni abrir una nueva llamada de red.
- Fallos de ambos proveedores terminan en `failed`, sin `decision_json`, sin snapshot textual sintético y sin `coachUnavailable`.
- Streaming deshabilitado en producción y sin publicación de parciales.
- Cuotas Gemini con reserva serializada en D1 y reconciliación mediante `usageMetadata`; no se usa `countTokens`.
- Migración y pruebas para el estado de reconciliación de cuota Gemini.

## Verificación

- `npm run test:worker`: 10 archivos, 125/125 tests.
- `npm test`: 63 archivos, 486/486 tests.
- Focal router + durable: 22/22 tests.
- `npm run typecheck`: correcto.
- `npm run typecheck:worker`: correcto.
- `npm run lint`: correcto, 0 errores. Permanecen 3 warnings preexistentes de hooks en `src/pages/CoachPage.tsx`.
- `git diff --check`: correcto; Git sólo informó conversiones LF/CRLF previstas al tocar los archivos.

## Commit

Mensaje exacto solicitado:

`feat(worker): route coach generation across Gemini and NVIDIA`

## Preocupaciones

- No quedan fallos de tests ni errores de typecheck/lint.
- Los tres warnings de `CoachPage.tsx` no pertenecen a Task 6 y no fueron modificados.
- No se ejecutó despliegue ni se activaron proveedores reales; la verificación usa proveedores simulados y las pruebas locales existentes.
