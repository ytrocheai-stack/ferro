# T5 — Informe de backup v10 validado

## Alcance

- Se añadieron esquemas Zod completos para runs, mensajes, conversaciones, drafts, perfiles y consentimientos del Coach; se eliminaron los `z.unknown()` de esas colecciones.
- La validación ahora comprueba duplicados, owners, referencias entre entidades, IDs canónicos, snapshots, secuencias sin huecos, relaciones de dispositivo y invariantes temporales/terminales antes de tocar IndexedDB.
- Los backups v1–v10 se normalizan explícitamente a un contrato interno v10: las versiones v1–v9 reparan campos ausentes/secuencias legacy; v10 conserva la forma y solo marca runs importados como legacy.
- La exportación de datos se realiza dentro de una transacción de lectura coherente.
- La importación exige owner activo cuando hay datos Coach, conserva todos los consentimientos locales existentes y reconstruye el consentimiento operativo desde localStorage si falta en IndexedDB; nunca importa el consentimiento del archivo.
- Los runs importados quedan `legacy` sin lease/token y el despertar de sincronización los omite; `legacy-imported` solo puede reactivarse mediante retry explícito.
- Se cubren round-trip real de exportación/importación, datos malformados, duplicados, referencias inválidas, owner ausente/inconsistente, snapshots, IDs/secuencias/tiempos, rechazo sin escritura y rollback ante fallo real de almacenamiento.

## Verificación

- `npm test -- --run src/lib/backup.test.ts src/lib/coachConversations.test.ts src/lib/coachClient.test.ts` — 3 archivos, 86 pruebas, verde.
- `npm run typecheck` — código 0.
- `npm run lint -- --quiet` — código 0.
- `git diff --check` — código 0; solo mostró advertencias de normalización LF/CRLF de Git en archivos existentes.

## Notas

- No se modificaron proveedor, modelo, secretos, endpoints ni despliegue.
- No se ejecutó la suite completa, build, E2E ni ningún proveedor real; la cobertura reportada es focalizada en backup/validación/Coach/DB.
- Se conservaron fuera del commit todos los cambios preexistentes y ajenos de T0–T4.
