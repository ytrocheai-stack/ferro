# T5 — Informe de backup v10 validado

## Alcance

- Se añadieron esquemas Zod completos para runs, mensajes, conversaciones, drafts, perfiles y consentimientos del Coach; se eliminaron los `z.unknown()` de esas colecciones.
- La validación ahora comprueba duplicados, owners, referencias entre entidades y secuencias de conversación antes de tocar IndexedDB.
- Los backups v1–v10 se normalizan de forma aditiva, conservando registros legacy y sin enviar ejecuciones heredadas.
- La exportación de datos se realiza dentro de una transacción de lectura coherente.
- La importación mantiene la transacción de escritura Dexie y valida el owner activo/consentimiento del dispositivo antes de escribir.
- Se cubren round-trip v10, datos malformados, duplicados, referencias inválidas, owners/secuencias imposibles, rechazo sin escritura y rollback ante fallo real de almacenamiento.

## Verificación

- `npm test -- --run src/lib/backup.test.ts src/lib/coachConversations.test.ts src/lib/coachClient.test.ts` — 3 archivos, 70 pruebas, verde.
- `npm run typecheck` — verde.
- `npm run lint -- --quiet` — verde.
- `git diff --check` — verde.

## Notas

- No se modificaron proveedor, modelo, secretos, endpoints ni despliegue.
- Se conservaron fuera del commit todos los cambios preexistentes y ajenos de T0–T4.
