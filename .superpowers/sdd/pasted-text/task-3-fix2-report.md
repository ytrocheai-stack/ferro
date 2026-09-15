# Task 3 — fix2

## Estado

Completado. El fallback de SSE a polling queda persistido en `CoachRunRecord` y se respeta al hidratar, cambiar de conversación, reconectar y volver a cargar la página.

## Cambio aplicado

- Añadido `transport?: 'sse' | 'polling'` al registro local.
- Los fallbacks 404/405/415, body SSE ausente y agotamiento de reconexiones persisten `polling`.
- Las ejecuciones terminales eliminan el modo de transporte.
- El reintento explícito restablece `sse`.
- La prueba integrada usa el `streamCoachRun` real: 404 SSE → polling durable → cambio de chat → `visibilitychange` → refresh JSON, con exactamente una llamada SSE.

## Pruebas

- `npm test -- --run src/lib/coachClient.test.ts` — 66/66.
- `npm test -- --run src/pages/CoachPage.test.tsx src/pages/CoachPage.transport.integration.test.tsx` — 15/15.
- `npm test -- --run src/components/CoachTranscript.test.tsx` — 3/3.
- `npm run typecheck` — exit 0.
- `npm run lint` — exit 0; 3 warnings existentes de cleanup de refs en `CoachPage.tsx`.
- `git diff --check` — exit 0.

## Preocupaciones

- El lint conserva 3 warnings `react-hooks/exhaustive-deps` ya existentes en el cleanup de refs de `CoachPage`; no son parte de este fix.
- La prueba integrada emite warnings de React sobre `act(...)` durante hidratación asíncrona, pero pasa y no introduce fallos de lint/typecheck.
