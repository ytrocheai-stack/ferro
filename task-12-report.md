# T12 — informe final del plan de auditoría

## Resultado

El plan T0–T12 quedó implementado en el checkout local y verificado sin desplegar ni cambiar proveedor/modelo. La bandera de streaming del Coach continúa opt-in/apagada; no se afirma streaming remoto real ni compatibilidad Android física.

## Gates ejecutados

- `npm run check` — OK: lint sin errores (3 warnings preexistentes de cleanup de refs en `CoachPage.tsx`), typecheck PWA, typecheck Worker, 59 archivos y 385 pruebas unitarias, build de producción, generación PWA y `check-public-bundle` sin secretos ni claves NVIDIA.
- `npm run test:worker` — OK: 7 archivos, 74 pruebas.
- `npm run test:e2e:coach` — OK: 2/2 en Chromium Android y WebKit iPhone.
- `npm run test:e2e` — OK: 30 pasadas y 2 omitidas por las condiciones explícitas de esas pruebas.
- `npm run build` — OK de forma independiente: 1.729 módulos transformados, `dist/404.html`, service worker y verificador público correctos.
- `npx vitest run packages/agent-lab/src/cli.test.ts` — OK: 2/2 tras retirar una propiedad de parámetro TypeScript que Node 25 no soporta en modo strip-only.

## Corrección final de verificación

El CLI de `agent-lab` fallaba al ejecutar directamente `packages/adaptation-core/src/streaming.ts` bajo Node 25. `SafeDecisionExplanationParser` ahora declara la propiedad y la asigna en el constructor explícitamente; el comportamiento no cambia y las pruebas H3/H4/H7 pasan.

## Límites y omisiones honestas

- No se ejecutó Axe específico del Coach en todos los estados, zoom 200%, todos los viewports solicitados ni teclado Android físico.
- Las E2E usan worker simulado; no prueban backend/proveedor remoto real.
- No se migró la app a GPT-5.6 Luna ni se habilitó streaming remoto.
- Persisten mejoras menores de cobertura de rollback derivado (T10), cancelación específica como flujo UI no expuesto (T11) y pruebas exhaustivas de accesibilidad/carga masiva.
- No hubo deploy, publicación, cambios de secretos ni PR.

## Integridad del checkout

Los commits del plan se aplicaron sobre el checkout existente. Se preservaron sin stagear los cambios preexistentes del usuario en `e2e/coach-agent.spec.ts`, `e2e/premium-ui.spec.ts`, `playwright.coach.config.ts`, `playwright.config.ts`, `scripts/check-public-bundle.mjs`, `scripts/postbuild.mjs`, `src/pages/Profile.tsx` y `vite.config.ts`, además de sus artefactos no rastreados.
