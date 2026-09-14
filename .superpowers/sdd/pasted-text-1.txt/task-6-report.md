# Informe T6 — Transcript y gestión de conversaciones

## Alcance implementado

- `CoachPage` dejó de seleccionar ejecuciones individuales y ahora trabaja con `conversationId` y owner local.
- Historial reactivo de conversaciones, selección persistente por cuenta/dispositivo, título inicial derivado del primer mensaje y renombrado manual.
- “Nuevo chat” reutiliza una conversación vacía existente para evitar duplicados.
- Historial móvil mediante `Sheet`; escritorio desde `1024px` con columna de 280px y conversación limitada a 760px, aislado a la ruta Coach mediante `AppShell`.
- Transcript ascendente por `sequence`, `createdAt` e ID estable; mensajes anteriores se cargan en páginas de 50 con ancla preservada.
- Seguimiento de scroll sólo dentro de 80px del final y acción “Ir al último mensaje” fuera de ese umbral.
- Borrador aislado por owner/conversación mediante `coachDrafts`, con preservación durante envíos y cambio de conversación.
- Estados visibles para guardado local, respuesta, completado, error y cancelación pendiente; el compositor conserva el foco y el historial tiene nombres accesibles.
- Propuestas siguen requiriendo decisión final y confirmación explícita antes de aplicar; borrar historial no revierte rutinas aplicadas.

## Archivos T6

- `src/pages/CoachPage.tsx`
- `src/pages/CoachPage.test.tsx`
- `src/components/CoachConversationHistory.tsx`
- `src/components/CoachTranscript.tsx`
- `src/lib/coachConsent.ts`
- `src/App.tsx`
- `src/index.css`

## Verificación

- `npm run lint` — OK.
- `npx tsc --noEmit` — OK.
- `npx vitest run src/pages/CoachPage.test.tsx src/components/CoachComposer.test.tsx src/components/Sheet.test.tsx` — 13 tests OK.
- `git diff --check` — OK.

No se ejecutó `npm run check` completo ni E2E completo porque el brief pidió verificación focalizada y el repositorio contiene cambios ajenos preexistentes fuera del alcance de T6.

## Preocupaciones

- La cobertura E2E específica de viewport 320–1440px y scroll real queda pendiente; la UI está preparada con media query y los tests unitarios cubren selección, borrador, nuevo chat y envío.
- La lista inicial se limita a 50 conversaciones y el transcript a 50 mensajes por página; todavía no hay control de “más conversaciones” para cuentas con más de 50 historiales.
- La consulta de estado sigue usando el polling local existente de 2 segundos para reflejar respuestas reconciliadas.
