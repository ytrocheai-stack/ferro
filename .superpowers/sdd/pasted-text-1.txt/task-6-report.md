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
- Propuestas sólo se ofrecen para runs `completed`, con decisión parseada, contexto vigente y `reconciliationState: 'reconciled'`; la UI exige una segunda confirmación explícita antes de aplicar. Borrar historial no revierte rutinas aplicadas.
- El request de envío recibe el `conversationId` capturado al pulsar enviar; no vuelve a resolver la selección global durante la operación.
- La paginación usa el índice compuesto existente, offset acumulado y deduplicación por ID para mensajes y conversaciones; el historial expone “Cargar más conversaciones” después de la primera página de 50.
- Las cargas verifican owner activo y conversación antes/después de IndexedDB, e ignoran resultados que llegan después de cambiar de conversación. El transcript reinicia el ancla al cambiar `conversationId` y conserva el ancla al anteponer mensajes antiguos.
- `aria-live` quedó limitado al estado breve del Coach; el `role="log"` no anuncia todo el transcript.
- La generación de carga ahora pertenece a la conversación: la hidratación inicial acepta su propio resultado, y sólo se descartan lecturas cuya conversación ya no está seleccionada.
- `send` captura `conversationId`, texto y revisión; sólo borra el draft si la selección, revisión y texto siguen coincidiendo al resolver la petición.
- El transcript y la aplicación comparten `isRenderableCoachProposal`; sólo aceptan `status: 'completed'`, decisión válida y `reconciliationState: 'reconciled'` explícito.

## Archivos T6

- `src/pages/CoachPage.tsx`
- `src/pages/CoachPage.test.tsx`
- `src/components/CoachConversationHistory.tsx`
- `src/components/CoachTranscript.tsx`
- `src/lib/coachConsent.ts`
- `src/lib/coachClient.ts`
- `src/lib/coachClient.test.ts`
- `src/lib/coachConversations.test.ts`
- `src/lib/coachPresentation.ts`
- `src/components/CoachTranscript.test.tsx`
- `src/App.tsx`
- `src/index.css`

## Verificación

- `npm run lint` — OK.
- `npx tsc --noEmit` — OK.
- `npx vitest run src/pages/CoachPage.test.tsx src/components/CoachTranscript.test.tsx src/lib/coachClient.test.ts src/lib/coachConversations.test.ts src/components/CoachConversationHistory.test.tsx src/components/CoachComposer.test.tsx src/components/Sheet.test.tsx` — 83 tests OK.
- `git diff --check` — OK.

### Ronda 3

- `isRenderableCoachProposal` exige comparaciones exactas: `run.status === 'completed'` y `run.reconciliationState === 'reconciled'`; `undefined`, `pending` y `uncertain` quedan fuera.
- `CoachTranscript`, `CoachPage` y `applyCoachChangeSet` usan la misma guardia, por lo que una propuesta no reconciliada no se muestra ni puede aplicarse.
- Las pruebas cubren un run completado con `reconciliationState` ausente: no aparece la tarjeta y la aplicación se rechaza sin modificar la rutina ni marcar el run como aplicado.

No se ejecutó `npm run check` completo ni E2E completo porque el brief pidió verificación focalizada y el repositorio contiene cambios ajenos preexistentes fuera del alcance de T6.

## Preocupaciones

- La cobertura E2E específica de viewport 320–1440px y scroll real queda pendiente; la UI está preparada con media query y los tests unitarios cubren selección, borrador, nuevo chat y envío.
- No se ejecutó E2E real en viewport 320–1440px ni scroll de navegador; las pruebas focalizadas cubren el Sheet móvil, paginación del historial, selección capturada, estados de aplicación y aislamiento de `aria-live`.
- No se ejecutó `npm run check` completo; la validación de esta ronda fue focalizada y no incluyó despliegue.
- La consulta de estado sigue usando el polling local existente de 2 segundos para reflejar respuestas reconciliadas.
