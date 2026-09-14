# Informe T4 — Conversaciones, borradores y migración

## Estado

Implementado T4 sobre la migración v10 existente de T2. Se conservaron los cambios ajenos del árbol y no se tocaron proveedores, modelo, secretos ni despliegues.

## Cambios

- Añadidas las entidades `CoachConversation` y `CoachDraft` y los campos de conversación, secuencia, entrega, mensaje lógico y reconciliación/cancelación en runs y mensajes.
- Extendida la migración v10 de Dexie de forma aditiva, preservando los stores, índices, IDs locales estables y reparación de referencias de T2.
- La migración asigna `request.event.conversationId`, resuelve referencias históricas `coach-local-${eventId}`, ordena secuencias por fecha/ID y agrupa huérfanos por propietario en `Historial anterior`; no elimina contenido.
- Creado `src/lib/coachConversations.ts` con crear/seleccionar/renombrar/eliminar, eliminación pendiente con cancelación durable y drafts por cuenta/conversación con debounce de 300 ms y flush de visibilidad/pagehide/cambio explícito.
- `coachClient` ahora construye el request solo con la conversación seleccionada, conserva el historial local completo, asigna secuencias dentro de transacciones y mantiene la identidad local del run.
- Backup/import y validación incluyen conversaciones y borradores de forma aditiva.

## Pruebas

- `npx tsc --noEmit` ✅
- ESLint focalizado sobre archivos T4 ✅
- `npx vitest run src/lib/coachConversations.test.ts src/lib/coachClient.test.ts src/lib/backup.test.ts` ✅ — 3 archivos, 62 pruebas.
- `git diff --check` ✅

Las pruebas nuevas cubren migración v9, huérfanos, cuentas distintas, fechas iguales, selección de historial, recarga/persistencia de drafts, reutilización de conversación vacía y eliminación con cancelación pendiente.

## Preocupaciones

- La selección de conversación queda expuesta por el repositorio (`selectCoachConversation`); la UI de conversaciones no forma parte del brief T4 y no se añadió una pantalla nueva.
- La ampliación se integra directamente en v10, que es el contrato de migración compartido por T2/T4; no se creó un downgrade ni una migración alternativa.
