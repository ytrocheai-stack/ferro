# Adaptación de entrenamiento v1 (en desarrollo)

> Auditoría del repositorio: 2026-08-28. Estado real: código integrado y comprobable en local,
> pero beta cerrada **no desplegable todavía**. Todos los proveedores permanecen apagados.

## Estado verificado

| Área | Estado real | Evidencia principal |
|---|---|---|
| Motor determinista | Implementado y probado localmente | `packages/adaptation-core` |
| Datos offline-first | Dexie v5 aditivo y backup v5 | `src/db/db.ts`, `src/lib/backup.ts` |
| Flujo de usuario | Feedback, cola, propuestas, confirmación y reversión | `src/pages/WorkoutDetail.tsx`, `src/lib/adaptation.ts` |
| Autenticación | Clerk opcional en PWA y JWT/allowlist en Worker | `src/components/AuthControls.tsx`, `worker/src/index.ts` |
| Worker | Auth, CORS, cuota 10/semana, idempotencia, retención y fallback | `worker/src/index.ts`, migraciones `0001`–`0003` |
| RAG | Puertos, recuperación, importador como función y evaluación sintética | `worker/src/rag.ts`, `worker/src/evaluation.ts` |
| NVIDIA | Adaptadores y modelos configurados; llamadas apagadas | `worker/wrangler.toml` |
| Cloudflare real | Sin crear/configurar | ID D1 de ejemplo; no hay evidencia de índices ni deploy |
| Corpus real | No importado | no hay manifiesto, chunks aprobados ni reporte de evaluación |
| Beta privada | No habilitada | faltan configuración, gates y pruebas end-to-end del coach |

La configuración fijada coincide, a la fecha de esta auditoría, con los catálogos oficiales de
NVIDIA para
[`deepseek-ai/deepseek-v4-flash-0731`](https://build.nvidia.com/deepseek-ai/deepseek-v4-flash-0731),
[`deepseek-ai/deepseek-v4-pro-0813`](https://build.nvidia.com/deepseek-ai/deepseek-v4-pro-0813) y
[`nvidia/nemotron-3-embed-1b`](https://build.nvidia.com/models?q=embed). Son endpoints gratuitos
de prototipo/evaluación, no una garantía de capacidad o continuidad para producción.

## Alcance ya implementado

- `packages/adaptation-core`: tipos serializables, comparabilidad por ocurrencia/rol/rango/tipo de
  serie/RPE, doble progresión, estancamiento, confianza, e1RM secundario y lista cerrada de
  candidatos. No importa React, Dexie ni APIs de red.
- `src`: `RoutineExercise` con rol/incremento, rutinas versionadas, workouts con snapshot y
  feedback, Dexie v5, migraciones v3/v4→v5, backup compatible con v1–v5, colas offline recuperables,
  propuestas inmutables editables y snapshots completos para aplicar/revertir.
- `worker`: `/health`, `/v1/adaptations/analyze`, `/v1/adaptations/events` y probe protegido;
  Clerk JWT con `authorizedParties`, allowlist, HMAC-SHA256, CORS exacto, cuota semanal,
  idempotencia ligada al hash del request, retención y circuit breaker por proveedor.
- Embeddings: validación del vector de 2048 dimensiones, prefijo configurable y renormalización L2;
  `passage` al indexar y `query` al recuperar; índices versionados separados para 768/1024.
- Recuperación: 20 resultados iniciales, hasta ocho fragmentos y máximo dos por fuente. Los chunks
  se tratan como contenido no confiable y no se mezclan con instrucciones del sistema.
- Aplicación local: exige decisión para todas las propuestas activas, compara la revisión base,
  marca el análisis completo como `stale` ante conflicto y revierte desde un snapshot completo.

Las rutinas anteriores se normalizan con `revision: 1`, rol `hypertrophy`, incremento `2.5` kg y
`coachReviewed: false`. El usuario debe revisar cada rutina antes de que pueda generar evidencia
para el coach. El nombre de IndexedDB sigue siendo `ferro`, las claves `ferro-*` no cambiaron y los
pesos continúan almacenándose en kilogramos.

## Diferencias pendientes respecto al diseño objetivo

Estas partes existen solo parcialmente o requieren corrección antes de llamar a la fase completa:

1. **Detección de caída.** La política actual compara la exposición con la inmediatamente anterior,
   no contra la mediana de las tres comparables previas. Además, una caída simultánea de carga y
   repeticiones puede no clasificarse. Hay que corregirlo y añadir casos de prueba límite.
2. **Selección/aplicación de candidato.** La UI crea correctamente una nueva revisión al editar,
   pero la función de dominio acepta un `candidateId` opcional y después aplica el candidato ya
   almacenado en la propuesta. Conviene eliminar esa ambigüedad o aplicar exactamente la selección
   validada.
3. **Escalación a Pro.** El router contempla baja recuperación, contradicción e invalidez de Flash,
   pero el flujo real valida el JSON después del routing; una respuesta inválida de Flash no llega
   hoy a Pro. `requiresEscalation` tampoco controla una segunda llamada. Un 429/timeout sí cae, de
   forma correcta, al resultado determinista sin usar Pro.
4. **Reranking.** Existe el puerto y el feature flag, no un adaptador operativo ni evidencia que
   justifique activarlo.
5. **Telemetría.** El esquema permite latencia, tokens y errores, pero el adaptador de generación
   solo devuelve texto: los tokens quedan sin poblar y faltan códigos de fallo consistentes por
   proveedor. No debe añadirse ningún payload de entrenamiento para resolverlo.
6. **Health/readiness.** `/health` solo confirma que el Worker responde y la versión de política;
   no verifica bindings, índice, proveedor ni corpus. El probe autenticado informa flags/modelos,
   pero tampoco constituye un smoke completo.
7. **Importación RAG.** `importCorpus` es una función probada con fixtures; todavía no hay CLI o job
   operable, reanudación/checkpoint, lotes de hasta 1.000 vectores ni validación explícita del límite
   de 10 KiB de metadata por vector. El upsert único actual no sirve para un corpus grande. Estos
   límites constan en la [documentación oficial de Vectorize](https://developers.cloudflare.com/vectorize/platform/limits/).
8. **Evaluación.** Los fixtures actuales son sintéticos y de cuatro dimensiones. Faltan consultas
   etiquetadas del dominio, negativos difíciles, comparación 768/1024 y reporte reproducible.
9. **Citas en UI.** La PWA muestra IDs de cita y algunos IDs internos de ejercicio; falta resolverlos
   a autor/título/URL y probar que cada afirmación visible tenga una fuente válida.
10. **Privacidad y pruebas de flujo.** Falta publicar la política de privacidad solicitada y crear
    pruebas E2E del recorrido Clerk → análisis → confirmación → stale/reversión. Las pruebas E2E
    actuales cubren la PWA general, no el coach.
11. **Rendimiento del cliente.** El build pasa, pero Vite avisa que el chunk principal supera
    500 KiB minificado. No bloquea la fase local; conviene medir arranque/caché y separar Clerk o
    código adaptativo antes de ampliar la beta.

## Plan por fases restante

### Fase 1 — cerrar la autoridad determinista

- Corregir la regla de caída contra la mediana de tres exposiciones y cubrir caídas combinadas.
- Unificar el contrato de selección/aplicación y añadir pruebas de concurrencia, edición, stale y
  reversión para varias propuestas del mismo análisis.
- Añadir fixtures históricos/migraciones que prueben upgrades reales v1→v5 y backups v1–v5.

**Gate:** el mismo input produce el mismo candidato en PWA y Worker; ningún camino permite aplicar
un valor que no pertenezca a la lista cerrada recalculada.

### Fase 2 — completar el Worker sin proveedores

- Terminar la escalación por salida inválida, el uso de `requiresEscalation`, timeouts y errores
  estructurados; mantener el fallback determinista para 429/timeout.
- Añadir telemetría de tokens/códigos sin registrar payloads y readiness autenticado.
- Probar CORS, JWT real de una instancia Clerk de prueba, allowlist, cuota, replay concurrente,
  retención y aislamiento de secretos.
- Publicar la política de privacidad y el texto de consentimiento de la beta.

**Gate:** suite local y smoke remoto con proveedores apagados; ningún resumen aparece en D1/logs.

### Fase 3 — corpus y RAG evaluable

- Conservar la estrategia de videos y la selección de creadores propuesta; esta tarea no las cambia.
- Definir un manifiesto autorizado por chunk con licencia/permiso, nivel de evidencia, idioma, URL,
  fecha, timestamp y `corpusVersion`.
- Convertir el importador en una herramienta reanudable, con lotes, límites y reporte de errores.
- Construir el set de evaluación real y medir Recall@5/precisión de citas en 768 y 1024.

**Gate:** Recall@5 ≥80% y precisión de citas ≥90%. Mantener 768 salvo que 1024 mejore al menos
3 puntos porcentuales absolutos. Nunca mezclar versiones/dimensiones/normalizaciones en un índice.

### Fase 4 — integración NVIDIA controlada

- Probar primero embeddings, después Flash y al final Pro, activando un flag por vez.
- Verificar salida estructurada, límites reales, latencia, costo/cuota y degradación ante fallos.
- Mantener Pro solo para ambigüedad permitida y dejar explicación avanzada pendiente ante 429 o
  timeout de Flash.

**Gate:** pruebas canarias con datos ficticios y presupuesto acotado; cero secretos en el bundle.

### Fase 5 — beta privada y observación

- Ejecutar E2E del flujo completo con menos de seis adultos sanos y escenarios de dolor/fatiga.
- Mostrar fuentes legibles, consentimiento y fallback offline; no diagnosticar lesiones.
- Activar usuarios uno por uno y revisar semanalmente rechazos, ediciones, stales y fallos.

**Gate:** aceptación manual del responsable, rollback probado y capacidad de apagar cualquier
proveedor sin cambiar dominio ni UI.

## Acciones manuales requeridas

1. Crear/confirmar la instancia de Clerk y entregar publishable key, JWT key, authorized parties y
   los IDs exactos de los usuarios beta.
2. Autorizar la cuenta/proyecto Cloudflare. Crear D1 e índices Vectorize de 768 (1024 solo para la
   evaluación), reemplazar el ID de ejemplo y aplicar las tres migraciones.
3. Crear una clave NVIDIA de prueba y aceptar sus términos. No colocarla en variables `VITE_*`.
4. Revisar legalmente el corpus y proporcionar los archivos/chunks y metadatos autorizados. No se
   ha modificado la selección de creadores ni la estrategia de videos.
5. Configurar secretos/variables de Worker y variables públicas de GitHub según
   [DESPLIEGUE.md](DESPLIEGUE.md).
6. Aprobar el texto de privacidad/consentimiento y decidir la retención operativa antes del primer
   análisis real.

## Verificación local

`npm run check` ejecuta lint, typecheck de PWA y Worker, pruebas unitarias/integración y build. El
build incluye `scripts/check-public-bundle.mjs`, que rechaza nombres de secretos o claves NVIDIA en
los artefactos públicos. `npm run test:e2e` se ejecuta aparte y, hasta añadir los casos indicados,
no valida el coach adaptativo.

Resultado de esta auditoría: `npm run check` pasó con 47/47 pruebas y `npm run test:e2e` pasó con
12/12 casos en Chromium Android y WebKit iPhone. El dry-run de Wrangler 4.30.0 también empaquetó el
Worker; ese resultado valida el bundle/TOML, no la existencia de los recursos indicados por los
bindings de ejemplo.
