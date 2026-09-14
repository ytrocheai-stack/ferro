# Informe T8 — Entrega durable del streaming al navegador

## Estado

Implementado localmente y sin despliegue. La bandera `ENABLE_COACH_STREAMING` no fue activada ni se añadió ningún proveedor, secreto o llamada real. El flujo existente de polling continúa siendo el camino activo; el cliente SSE es opt-in.

## Cambios realizados

- `worker/migrations/0016_coach_run_snapshots.sql`: tabla D1 aditiva `coach_run_snapshots`, clave `(run_id, sequence)` e índice por ejecución/fecha. No elimina ni modifica snapshots en rollback.
- `packages/adaptation-core/src/contract.ts`: contrato estricto para snapshots y eventos SSE numerados.
- `worker/src/index.ts`:
  - persiste snapshots por ejecución con secuencia monotónica;
  - limita snapshots parciales a uno por segundo y fuerza el terminal;
  - conserva `cancelled` frente a expiración/cancelación y evita que un Workflow reiniciado o una carrera de generación escriba `failed` sobre un run ya cancelado;
  - conserva texto, estado, error y decisión terminal;
  - expone `GET /v1/coach/runs/:id/events` autenticado por bearer, aislado por `account_hash`, con cursor `Last-Event-ID`/`after`, replay, espera acotada, heartbeats y cierre por timeout/terminal;
  - reintenta conflictos de secuencia D1 leyendo de nuevo la última secuencia, sin reenviar generación;
  - responde `404` para una ejecución de otra cuenta y nunca crea una ejecución durante reconexión.
- `src/lib/coachClient.ts`, `src/pages/CoachPage.tsx`, `src/components/CoachTranscript.tsx` y `src/db/types.ts`: reconexión SSE opt-in mediante `streamCoachRun`, cursor local, deduplicación por secuencia y reemplazo del parcial; con `VITE_ENABLE_COACH_STREAMING` apagada, `CoachPage` conserva exactamente el polling de 2 segundos; se conservan borrador, run y conversación locales.
- Pruebas focalizadas Worker/cliente/UI para cancelación, expiración, Workflow reiniciado, carrera de secuencia, conexión viva acotada, aislamiento, cursor, reconexión, reemplazo de parciales y ausencia de POST.

## Decisiones de seguridad y rollback

- El endpoint consulta primero la ejecución con `id + account_hash`; los snapshots nunca se leen por `run_id` sin esa validación.
- Un snapshot parcial no cambia `decision` ni lo hace aplicable; la aplicación sigue requiriendo una respuesta completada y validada.
- Una reconexión solo hace GET SSE; no llama al endpoint de creación ni reintenta el Workflow.
- La tabla y sus filas se conservan aunque se vuelva al polling.
- La conexión viva tiene un máximo de 30 segundos, consulta cada 500 ms y puede emitir heartbeat; no existe un loop infinito.
- Compatibilidad verificada: `npm run typecheck:worker` acepta `ReadableStream`, `TextEncoder` y `setTimeout` con el runtime/configuración del Worker, y el harness Worker consume replay, espera, heartbeat, timeout y cierre terminal sin APIs no disponibles; no se encontró bloqueo de runtime en esta ronda.

## Pendientes / preocupaciones

- No se habilitó el streaming remoto porque T8 exige mantener la bandera apagada hasta acreditar capacidad y ausencia de gasto adicional.
- El endpoint mantiene una conexión viva solo durante una ventana de 30 segundos; el cliente debe reconectar con su último cursor para seguir observando una ejecución larga.
- La asignación de secuencia usa clave primaria D1 y reintento tras conflicto; si se añadieran varios procesos con escrituras de idéntico contenido, todavía convendría incorporar una clave de idempotencia de snapshot explícita.
- El stream de UI se integra bajo una flag frontend separada (`VITE_ENABLE_COACH_STREAMING`), apagada por defecto; el Worker tampoco activa `ENABLE_COACH_STREAMING` por este cambio.

## Verificación

- `npx vitest run worker/src/coach.test.ts worker/src/coach.durable.test.ts src/lib/coachClient.test.ts src/pages/CoachPage.test.tsx src/components/CoachTranscript.test.tsx` — 85 pruebas aprobadas.
- `npm run typecheck` — aprobado.
- `npm run typecheck:worker` — aprobado.
- `npm run lint` — aprobado.
- `git diff --check` — aprobado; solo mostró advertencias de conversión LF/CRLF en archivos existentes.
