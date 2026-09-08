# Corrección de los cinco hallazgos

Fecha: 2026-08-31. Alcance: cambios locales comprobables según el plan adjunto.

La beta, embeddings, Flash, Pro y reranking permanecen apagados. No se aprobaron fuentes, no se
fabricaron etiquetas, no se importó el corpus en servicios remotos y no se desplegó ningún cambio.
Los resultados siguientes son garantías de código y pruebas locales; no acreditan D1, Vectorize,
Clerk, facturación ni un despliegue remoto.

## 1. Contexto vigente e identidad de solicitudes

Archivos principales: `src/lib/adaptationContext.ts`, `src/lib/adaptationClient.ts`,
`src/lib/adaptation.ts`, `src/db/types.ts`, `src/db/db.ts`, `src/lib/backup.ts` y
`src/lib/validation.ts`.

- Cada `AdaptationJob` conserva `ownerId`, `requestId`, `contextKey`, `runId` y `leaseExpiresAt`.
  El contexto canónico incluye el entrenamiento, feedback, exposiciones previas seleccionadas y la
  rutina completa junto con su revisión; payload y firma se capturan juntos y se reutilizan solo
  mientras dispositivo, consentimiento y contexto coincidan.
- La cola envía `requestId` como `Idempotency-Key`. Las propuestas guardan entrenamiento, solicitud
  y contexto de origen.
- Reclamo, éxito, error y cancelación vuelven a comprobar propietario, solicitud, ejecución,
  contexto, rutina, conexión y consentimiento dentro de transacciones. Una respuesta tardía no
  puede crear propuestas ni sobrescribir una invalidación; tampoco puede mutar una solicitud nueva.
- Editar sets, dolor, historial o rutina invalida el job con `context-invalidated` y vuelve obsoletas
  las propuestas pendientes. Aplicar propuestas revalida el contexto actual y conserva snapshots y
  propuestas aceptadas.
- El backup exporta v7, sigue aceptando formatos anteriores y no restaura con contexto inventado:
  jobs heredados sin identidad acreditable requieren análisis manual; propuestas pendientes
  incompletas quedan `stale`; registros sin propietario se ignoran.

## 2. Cola recuperable y leases

- Jobs y eventos conservan una señal de nueva pasada, reconsultan después de cada lote y procesan
  avisos que llegan durante el último envío.
- Hay una ejecución activa por cuenta y tipo de procesador. Cambiar de cuenta, revocar consentimiento
  o perder conexión aborta el run; el job reclamado vuelve a `pending` únicamente si aún coincide su
  `runId`. La cancelación no incrementa el contador de fallos técnicos.
- Los jobs processing se recuperan a los 15 minutos. El scheduler considera `nextRetryAt` y el
  vencimiento del lease y limita ambos a la cuenta propietaria; conexión, visibilidad, sesión y
  eventos existentes vuelven a despertar el procesador.

## 3. Contabilización por intento en el Worker

Archivos principales: `worker/src/index.ts` y `worker/migrations/0008_usage_accounting.sql`.

- `routeGeneration` devuelve un registro de cada intento Flash/Pro, incluido contenido cuando lo
  hubo, `sent`, uso normalizado y error; se conservan fallos y respuestas inválidas.
- Entrada y salida se validan por separado: solo enteros finitos no negativos son medidos; `0` es
  válido y ausencia/valor inválido es desconocido. La liquidación suma uso conocido y estima cada
  dimensión desconocida de cada intento que sí fue enviado.
- Se reserva el prompt completo usando el estimador local y 4.000 tokens de salida antes de cada
  intento. Pro amplía la reserva atómicamente sin incrementar `active_runs`; si no hay espacio no
  se envía y se liquida solo Flash. Un circuito abierto antes del envío no se factura como consumo
  desconocido.
- La ejecución liquida una sola vez, libera reservas y conserva fallback determinista si el consumo
  real supera el límite. La migración aditiva distingue tokens medidos, estimados y
  `usage_incomplete`; nunca guarda prompts ni payloads.

## 4. Identidad física del corpus

Archivos principales: `packages/corpus-identity/src/index.mjs`, sus declaraciones TypeScript,
`worker/src/rag.ts`, `scripts/corpus-cli.mjs` y `worker/migrations/0007_vector_identity.sql`.

- Worker e importador comparten SHA-256 completo en base64url y validación UTF-8 de 64 bytes:
  `nr2:<hash(corpusVersion)>:<dimensión>` para namespace y
  `v2:<hash(canonical([corpusVersion, chunkId]))>` para vector.
- Metadata conserva la versión y el ID lógico completos. Se valida metadata exacta, límites y
  fuentes antes de hacer embeddings o escrituras.
- D1 conserva `vector_id`; rollback usa ese valor y mantiene el ID físico anterior para filas
  heredadas. CLI, readiness, recuperación e importación usan la misma función. Los checkpoints
  llevan el esquema físico y rechazan versiones incompatibles.

## 5. Evaluación independiente y verificable

Archivos principales: `packages/corpus-evaluation/src/index.mjs`, `worker/src/evaluation.ts`,
`scripts/corpus-cli.mjs` y `worker/src/corpus-cli.test.ts`.

- Se exige benchmark aprobado, versionado y ligado a `corpusVersion`, con exactamente 50
  `queryId` únicos, texto, relevantes, negativos difíciles y claims con chunks de respaldo. El
  archivo actual `label-template` sigue siendo deliberadamente no aprobable.
- Retrieval y citas deben cubrir exactamente los mismos `queryId`; claims y sus textos deben
  corresponder a la referencia. Resultados no pueden introducir `relevantIds`, `validIds` ni
  `supportedIds`.
- Ambos rankings usan una matriz compartida que cubre exactamente todos los chunks del corpus,
  incluidos negativos. Los vectores tienen 2048 dimensiones y norma no nula en 512 y 1024; las
  citas 512/1024 se evalúan por separado.
- El reporte incluye versiones, huellas, cobertura y errores. `baseGate` requiere corpus listo,
  referencia aprobada, cobertura completa, Recall@5 de 512 ≥ 0,80 y precisión ≥ 0,90. El gate de
  1024 requiere además mejora ≥ 0,03 y precisión sin deterioro. Una validación fallida nunca
  devuelve un gate positivo.

## Verificación local

Se añadieron regresiones para cambios durante el envío, historial/rutina eliminados o editados,
reanálisis frente a reintento, nueva pasada de cola, cancelación/retoma, leases, backups v7,
presupuesto 8.000/4.010, contadores cero e inválidos, IDs Unicode/largos, rollback nuevo/heredado,
checkpoints incompatibles y fixture completo de evaluación.

Comandos de cierre:

```text
npm run lint
npm run typecheck
npm run typecheck:worker
npm test
npm run test:worker
npm run build
```

Resultado local actual: `npm test` 22 archivos / 96 pruebas; `npm run test:worker` 4 archivos /
34 pruebas; lint, ambos typechecks, build y verificación anti-secretos del bundle pasan.

La apertura continúa bloqueada hasta revisar permisos y fragmentos reales, aprobar el corpus y el
benchmark, probar bindings/migraciones y sesión real, verificar límites operativos y desplegar de
forma controlada. Esas actividades quedan fuera de esta corrección local.
