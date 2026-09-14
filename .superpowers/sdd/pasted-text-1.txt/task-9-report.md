# Informe T9 — Conflictos de rutinas

## Estado

Implementado y verificado localmente. El editor conserva la revisión capturada al abrirse y, dentro de su transacción Dexie, compara esa revisión con la actual antes de guardar. Una edición concurrente de otra pestaña o del Coach ya no se sobrescribe silenciosamente.

Los conflictos de revisión, las rutinas retiradas/eliminadas y los errores de almacenamiento dejan el borrador en pantalla. La UI ofrece recargar o descartar el borrador; el error de almacenamiento también permite reintentar.

Se añadieron pruebas focalizadas para dos ediciones concurrentes, modificación durante edición por el Coach, retirada y eliminación de rutina.

## Alcance y conservación

Solo se modificaron `src/pages/RoutineEditor.tsx`, `src/lib/routineEditing.ts`, `src/lib/routineEditing.test.ts` y este informe. Se conservaron los cambios preexistentes y T0–T8; no se usaron `reset`, `clean`, borrados globales, despliegues ni proveedores reales.

## Verificación

- `npx vitest run src/lib/routineEditing.test.ts`: 6 pruebas pasaron.
- `npm run typecheck`: pasó.
- `git diff --check`: pasó.

## Preocupaciones

- La prueba de UI completa de `RoutineEditor` no se añadió porque el brief acotó las pruebas junto al módulo y el comportamiento de concurrencia está aislado en el helper transaccional.
- El recargado usa la navegación de la ruta actual; el borrador se conserva hasta que el usuario elige explícitamente recargar o descartar.
