# T11 — informe de verificación

## Cambios

- `afterSignOutUrl` ahora usa `import.meta.env.BASE_URL`, por lo que conserva `/ferro/` en producción.
- El Coach usa landmarks identificables, un formulario de envío accesible, foco/teclado existente, estados breves `aria-live` atómicos y errores del run como `role="alert"`.
- El polling se detiene cuando el documento está oculto y se reanuda al volver visible. Las actualizaciones periódicas consultan mensajes y runs de la conversación seleccionada; ya no recargan runs del propietario ni el historial completo en cada ciclo.
- El transcript mantiene carga progresiva y añade `content-visibility: auto` limitado a sus mensajes.

## Verificación

- `npm run test -- src/pages/CoachPage.test.tsx src/components/CoachComposer.test.tsx src/components/CoachTranscript.test.tsx src/components/CoachConversationHistory.test.tsx` — OK, 4 archivos / 17 pruebas.
- `npx eslint src/main.tsx src/pages/CoachPage.tsx src/components/CoachComposer.tsx src/pages/CoachPage.test.tsx` — OK sin errores; quedan 3 warnings preexistentes de cleanup de refs en `CoachPage.tsx`.
- `npm run typecheck` — OK.
- `git diff --check` — OK; Git solo informó conversiones LF/CRLF al tocar archivos existentes.
- `npm run test:e2e:coach` — ejecutado en Chromium Android y WebKit iPhone; ambos fallan en la aserción existente que busca el texto “El coach está procesando tu contexto”. El DOM sí muestra el estado accesible del Coach y el flujo no llegó a completar esa prueba. No se afirma cobertura E2E de Axe, zoom ni todos los viewports.

## Límites

No se tocaron proveedores, modelos, secretos, deploy ni contratos/índices de datos. No se ejecutó `npm run check` completo porque el lint global sigue fallando por un error fuera de T11 en `src/lib/coachClient.ts:476` (`no-useless-assignment`). Las pruebas unitarias usan jsdom; no prueban teclado Android físico ni backend/proveedor real.
