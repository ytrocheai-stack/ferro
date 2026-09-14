# Informe T8 — Entrega durable del streaming al navegador

## Estado

Implementado localmente y sin despliegue. La bandera `ENABLE_COACH_STREAMING` no fue activada ni se añadió ningún proveedor, secreto o llamada real. El flujo existente de polling continúa siendo el camino activo; el cliente SSE es opt-in.

## Cambios realizados

- `worker/migrations/0016_coach_run_snapshots.sql`: tabla D1 aditiva `coach_run_snapshots`, clave `(run_id, sequence)` e índice por ejecución/fecha. No elimina ni modifica snapshots en rollback.
- `packages/adaptation-core/src/contract.ts`: contrato estricto para snapshots y eventos SSE numerados.
- `worker/src/index.ts`:
  - persiste snapshots por ejecución con secuencia monotónica;
  - limita snapshots parciales a uno por segundo y fuerza el terminal;
  - conserva texto, estado, error y decisión terminal;
  - expone `GET /v1/coach/runs/:id/events` autenticado por bearer, aislado por `account_hash` y con cursor `Last-Event-ID`/`after`;
  - responde `404` para una ejecución de otra cuenta y nunca crea una ejecución durante reconexión.
- `src/lib/coachClient.ts` y `src/db/types.ts`: reconexión SSE opt-in mediante `streamCoachRun`, cursor local, deduplicación por secuencia y reemplazo del parcial; se conservan borrador, run y conversación locales.
- Pruebas focalizadas Worker/cliente para aislamiento, cursor, terminal, reconexión y ausencia de POST.

## Decisiones de seguridad y rollback

- El endpoint consulta primero la ejecución con `id + account_hash`; los snapshots nunca se leen por `run_id` sin esa validación.
- Un snapshot parcial no cambia `decision` ni lo hace aplicable; la aplicación sigue requiriendo una respuesta completada y validada.
- Una reconexión solo hace GET SSE; no llama al endpoint de creación ni reintenta el Workflow.
- La tabla y sus filas se conservan aunque se vuelva al polling.

## Pendientes / preocupaciones

- No se habilitó el streaming remoto porque T8 exige mantener la bandera apagada hasta acreditar capacidad y ausencia de gasto adicional.
- El endpoint entrega los snapshots disponibles en la respuesta SSE; el polling existente sigue siendo el rollback operativo. La activación futura deberá añadir la política de duración/reintento del stream en el entorno Cloudflare antes de sustituir el polling.
- La frecuencia está protegida por consulta de la última fila en D1; si en el futuro hubiera más de un escritor concurrente para la misma ejecución, conviene añadir una estrategia de serialización/insert idempotente específica.

## Verificación

- `npx vitest run worker/src/coach.test.ts worker/src/coach.durable.test.ts src/lib/coachClient.test.ts` — 71 pruebas aprobadas.
- `npm run typecheck` — aprobado.
- `npm run typecheck:worker` — aprobado.
- `npm run lint` — aprobado.
- `git diff --check` — aprobado; solo mostró advertencias de conversión LF/CRLF en archivos existentes.
