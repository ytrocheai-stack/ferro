# T11 — informe de verificación

## Cambios

- `afterSignOutUrl` ahora usa `import.meta.env.BASE_URL`, por lo que conserva `/ferro/` en producción.
- El Coach usa landmarks identificables, un formulario de envío accesible, foco/teclado existente, estados breves `aria-live` atómicos y errores del run como `role="alert"`.
- El polling se detiene cuando el documento está oculto y se reanuda al volver visible. Las actualizaciones periódicas consultan mensajes y runs de la conversación seleccionada; ya no recargan runs del propietario ni el historial completo en cada ciclo.
- El transcript mantiene carga progresiva y añade `content-visibility: auto` limitado a sus mensajes.
- Corrección posterior de revisión: el landmark principal usa `aria-label="Coach"` directamente; el estado expone `aria-label={status}` para que Playwright y lectores de pantalla lo identifiquen como `status` “Procesando respuesta”.
- El polling refresca solo runs activos con `remoteRunId` de la conversación seleccionada, permitiendo materializar respuestas y continuar el flujo sin reintroducir consultas completas.
- La E2E conserva el import y la validación con `coachRunRequestSchema` preexistentes del usuario; ahora se llama “crea y continúa ejecuciones”, usa `getByRole('status', { name: 'Procesando respuesta' })` y ya no intenta cancelar desde una UI que no ofrece ese control.

## Verificación

- `npm run test -- src/pages/CoachPage.test.tsx src/components/CoachComposer.test.tsx src/components/CoachTranscript.test.tsx src/components/CoachConversationHistory.test.tsx` — OK, 4 archivos / 17 pruebas.
- `npx eslint src/main.tsx src/pages/CoachPage.tsx src/components/CoachComposer.tsx src/pages/CoachPage.test.tsx e2e/coach-agent.spec.ts` — OK sin errores; quedan 3 warnings preexistentes de cleanup de refs en `CoachPage.tsx`.
- `npm run typecheck` — OK.
- `git diff --check` — OK; Git solo informó conversiones LF/CRLF al tocar archivos existentes.
- `npm run test:e2e:coach` — OK, 2/2 en Chromium Android y WebKit iPhone. La primera ejecución falló porque buscaba el texto obsoleto “El coach está procesando tu contexto”; al actualizar la aserción al estado accesible se reveló que el polling no refrescaba runs remotos activos, lo que también quedó corregido de forma focalizada.

## Límites

No se tocaron proveedores, modelos, secretos, deploy ni contratos/índices de datos. No se ejecutó `npm run check` completo porque el lint global sigue fallando por un error fuera de T11 en `src/lib/coachClient.ts:476` (`no-useless-assignment`). Las pruebas unitarias usan jsdom; la E2E usa worker simulado y no demuestra backend/proveedor real, Axe, zoom al 200% ni todos los viewports; tampoco prueba teclado Android físico.
