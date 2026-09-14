# T10 — Informe

## Alcance implementado

- `finish` ahora lee el historial, recalcula campos derivados y persiste todo dentro de una única transacción Dexie, incluyendo las tablas necesarias para invalidación adaptativa.
- El borrado de un entreno recalcula volumen, series y PRs del historial restante dentro de la transacción.
- `Deshacer` restaura el snapshot y vuelve a recalcular el historial dentro de otra transacción; ambos caminos conservan el estado anterior si falla la escritura.
- Los fallos al guardar, borrar o deshacer muestran un mensaje accionable y no limpian la sesión activa ni alteran silenciosamente el historial.
- Se añadieron pruebas de guardado concurrente, cuota/almacenamiento fallido y coherencia de borrar/restaurar.

## Archivos

- `src/stores/activeWorkout.ts`
- `src/stores/activeWorkout.test.ts`
- `src/pages/WorkoutDetail.tsx`
- `src/pages/ActiveWorkoutPage.tsx`
- `src/lib/stats.test.ts`
- Este informe.

`src/lib/stats.ts` no necesitó cambios: su recálculo puro ya era determinista e inmutable; se reutilizó dentro de las transacciones.

## Verificación

- `npx vitest run src/stores/activeWorkout.test.ts src/lib/stats.test.ts` — OK, 6 pruebas.
- `npx eslint src/stores/activeWorkout.ts src/stores/activeWorkout.test.ts src/pages/WorkoutDetail.tsx src/pages/ActiveWorkoutPage.tsx src/lib/stats.ts src/lib/stats.test.ts` — OK.
- `npm run typecheck` — OK.
- `git diff --check` — OK.

## Omisiones y límites

- No se ejecutó el build completo ni la suite E2E; el brief pidió pruebas focalizadas, lint y typecheck.
- No se tocaron modelos, proveedores, autenticación, secretos, configuración de deploy ni cambios ajenos preexistentes.
- Los cambios ajenos que ya estaban en el checkout permanecen sin stagear.
