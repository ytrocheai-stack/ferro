# Informe de corrección — Task 3

## Estado

Corregido únicamente el hallazgo de Task 3: un run que cae de SSE a polling queda registrado en ref y estado, y `reconnect()` lo excluye al volver a foreground. Se añadieron regresiones para el flujo 404 → ocultar/mostrar → polling sin nueva llamada SSE, las etiquetas españolas y retry de `provider-circuit-open`/`coach-providers-unavailable`, además de scroll cerca del final y carga de mensajes antiguos.

No se modificaron `worker/`, `backup` ni `db`.

## Commit

`fix(coach): prevent SSE reconnect after polling fallback`

## Pruebas

- `npx vitest run src/lib/coachClient.test.ts src/pages/CoachPage.test.tsx src/components/CoachTranscript.test.tsx` — PASS, 3 archivos y 82/82 pruebas.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS, 0 errores; conserva 3 warnings existentes de `react-hooks/exhaustive-deps` en el cleanup de `CoachPage.tsx`.
- `git diff --check` — PASS.

## Preocupaciones

- El worktree conserva cambios no relacionados y no staged de otras tareas; no se incluyeron en este commit.
- Vitest mantiene los warnings conocidos de `window.scrollTo()` no implementado y `--localstorage-file` sin ruta válida; no causan fallos.
