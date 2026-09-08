# Auditoría de la continuación de la beta del coach

Fecha: 2026-08-30. Referencia: plan «Continuación de la beta del coach de NextRep» adjuntado por el usuario.

**Dictamen: implementación local corregida por hallazgo; no aprobar la apertura de la beta.** La
suite inicial pasaba, pero no ejercitaba varios contratos y garantías del plan. Se añadieron
regresiones permanentes para los hallazgos reproducidos; esto no equivale a aprobación de
publicación, porque todavía faltan D1/Vectorize reales, permisos del corpus, sesión real y pruebas
en dispositivos.

## Alcance y evidencia

- Checkout revisado: `HEAD 267ba5c`, más los cambios locales que ya existían al iniciar la auditoría.
  No confundir esos cambios con una versión publicada. No se modificó la implementación auditada.
- Línea base previa a las correcciones: `npm run check` correcto; lint, tipos de PWA/Worker,
  **53/53 pruebas**, build y comprobación
  anti-secretos del bundle. Esa comprobación busca patrones concretos; no certifica por sí sola
  ausencia de cualquier dato personal en todos los artefactos.
- `npm run test:e2e`: **12/12**, seis escenarios generales en Chromium Android y WebKit iPhone.
  No incluyen Clerk real, consentimiento, análisis ni aceptación/edición/reversión del coach.
- `npm run test:worker`: línea base **13/13** en la configuración independiente del Worker; son un
  subconjunto de las 53 pruebas anteriores, no 13 comprobaciones adicionales del recorrido.
- `corpus:validate`: manifiesto de propuesta estructuralmente válido para la CLI actual.
  `corpus:report`: cinco fuentes, ninguna aprobada, cero fragmentos, `readyToImport: false`.
  `corpus:import-plan`: `plan-only`; no importa ni llama a proveedores.
- Diagnóstico adicional inicial: **11 casos reproducidos fallaban frente al comportamiento exigido**.
  Se ejecutaron con IndexedDB ficticio, adaptador SQLite en memoria con las seis migraciones
  SQL y proveedores simulados. SQLite local no sustituye una prueba en D1 remoto.
- HTTP remoto de solo lectura: PWA pública y `/health` del Worker devuelven 200; health informa
  `policyVersion: v1`. No se verificaron JWT real, readiness autenticado, flags activos, migraciones
  remotas, Cron, facturación ni la correspondencia entre despliegues y este checkout.
- No se desplegó, no se activaron proveedores y no se enviaron entrenamientos reales.

El canario histórico y su JSON permanecen localmente en `.cache/beta-audit.test.ts`,
`.cache/beta-audit.config.ts` y `.cache/beta-audit-results.json`, fuera de Git y de la suite normal.
En este checkout se reproducen con:

```bash
npx vitest run --config .cache/beta-audit.config.ts --reporter=verbose
```

Requieren `node:sqlite` (ejecutados con Node 25.6.1). Su salida esperada en la implementación
auditada era código 1. En la rama actual la misma reproducción termina con código 0 y 11/11 casos
pasados. Los casos se conservan como referencia; sus garantías críticas ya están en las suites
permanentes del cliente/Worker. No se cambiaron expectativas para ocultar los fallos.
- Tras esta corrección, la suite permanente termina en **75/75 pruebas** y `test:worker` en
  **27/27**; incluye propiedad de cola, scheduler de reintentos, presupuesto excedido/usage
  desconocido, decisiones mixtas, readiness sin fragmentos, namespaces, rollback, claims y
  reserva concurrente de idempotencia.

## Hallazgos que bloquean el recorrido

### A1 · P1 · CORS rechaza las cabeceras de consentimiento — corregido localmente

[`worker/src/index.ts:70`](../worker/src/index.ts) permite únicamente `Authorization`,
`Content-Type` e `Idempotency-Key`. El cliente añade `X-NextRep-Consent-Version` y
`X-NextRep-Device-Id`. El preflight devuelve 204 pero no autoriza esas cabeceras, por lo que un
navegador bloquea el POST entre Pages y el Worker incluso con sesión y consentimiento válidos.
La prueba existente llamaba directamente al handler y no aplicaba la política CORS del navegador.

Corrección aplicada: `Access-Control-Allow-Headers` comparte ahora la lista de cabeceras de la PWA,
incluidas `x-nextrep-consent-version` y `x-nextrep-device-id`. Falta ejecutar el canario desde dos
orígenes reales.

### A2 · P1 · El historial generado por la PWA no cumple el contrato del Worker — corregido localmente

[`toExposure`/`inputsForWorkout`](../src/lib/adaptationClient.ts) incluyen `previousExposures: []`
tanto en el ejercicio actual como en cada exposición previa. El `exposureSchema.strict()` del
[Worker](../worker/src/index.ts) no admite ese campo dentro de una exposición previa.
Un payload obtenido realmente mediante `enqueueAdaptationJob`, con una exposición anterior,
devuelve **400 «Solicitud de análisis inválida»**. Sin historia no aparece este error.

Se comparte el esquema de respuesta, pero la solicitud sigue definida de dos formas distintas;
el esquema compartido incluso admite `z.any()` en el historial. El test que dice procesar la forma
real del Worker fabrica una respuesta del motor; no llama al Worker ni serializa la cola.
Corrección aplicada: el esquema de exposición/input vive en `packages/adaptation-core` y el Worker
valida el mismo contrato. El flujo cola → handler → parser → reconciliación con historial pasa en
la reproducción local.

### A3 · P1 · Revocar el consentimiento no detiene un lote en curso — corregido localmente

[`processPendingAdaptationJobsInternal`](../src/lib/adaptationClient.ts) captura el consentimiento
una vez, antes del bucle. Después de revocarlo durante el primer envío, el segundo también sale:
**dos llamadas en lugar de una**. El procesador de eventos captura además un único JWT para todo
el lote; quitar los listeners al cerrar sesión no cancela ese trabajo asíncrono.

Corrección aplicada: `AbortController`, revalidación antes/después de cada envío y espera, evento de
revocación y cancelación al desmontar/cambiar sesión. Cada job/evento/propuesta nuevo persiste
`ownerId`, el procesador filtra por la cuenta autenticada y la app exige sesión cuando el coach está
configurado. La sincronización remota y coordinación multi-pestaña siguen siendo trabajo de E0.

### A4 · P1 · Una reserva expirada permite dos consumos y dos generaciones — corregido localmente

[`reserveIdempotency`](../worker/src/index.ts) usa `INSERT OR IGNORE`, pero una fila expirada
sigue ocupando la clave primaria. La consulta posterior filtra la fila por caducidad y devuelve
`null`; el handler continúa sin haber adquirido una reserva. Dos peticiones mientras la primera
espera al proveedor pueden consumir cuota y generar simultáneamente.

Reproducción con SQL real en memoria: tras un análisis inicial, se caduca su fila y se lanzan dos
reintentos solapados. Resultado: **dos generaciones simuladas y contador 3**, en vez de una
generación y contador 2. El Cron posterior no protege esta ventana.

Corrección aplicada: un UPSERT condicional reclama la fila solo si está expirada; la segunda petición
ve la reserva vigente y no llama al proveedor. La garantía concurrente ya está en la suite permanente;
faltan las pruebas D1 remotas y la recuperación operativa de reservas abandonadas.

### A5 · P1 · Aceptar más repeticiones no actualiza las series de la rutina — corregido localmente

Los candidatos `increase-reps` del [motor](../packages/adaptation-core/src/index.ts) omiten
`next.loadKg`, porque mantienen la carga. [`applyCandidate`](../src/lib/adaptation.ts) omite
`setTargets` cuando falta esa carga, incluso para un aumento de repeticiones. Cambia el rango,
pero deja **[5, 5, 5] en vez de [6, 6, 6]**. `startFromRoutine` precarga las repeticiones desde
esos objetivos antiguos.

Corrección aplicada: aplicar cualquier cambio no mantenido actualiza `setTargets`; `increase-reps`
conserva la carga existente, mantiene los calentamientos sin alterar y reconstruye únicamente el
número de series de trabajo solicitado. La reproducción motor → aplicación pasa y la reversión usa
snapshot completo.

### A6 · P1 · La confirmación puede mostrar valores del candidato anterior — corregido localmente

[`createEditedProposal`](../src/lib/adaptation.ts) actualiza `candidate` y `candidateId`, pero
conserva `proposedValues`, `previousValues`, citas, confianza y regla del original.
[`ProposalCard`](../src/pages/WorkoutDetail.tsx) da preferencia a esos campos duplicados.
Reproducción: elegir 102,5 kg conserva `proposedValues.loadKg: 100`; el usuario confirma una
presentación distinta del candidato que se aplicará.

Corrección aplicada: la edición recalcula todos los campos derivados y la tarjeta renderiza el
candidato elegido como fuente de verdad. La vista solo ofrece revisiones pendientes y muestra un
toast sin telemetría de aceptación cuando el resultado es `stale`.

### A7 · P1 · Pro puede terminar sin explicación válida y figurar como completado — corregido localmente

Flash ya se valida antes del routing. Sin embargo, la validación final en
[`worker/src/index.ts`](../worker/src/index.ts) no exige cobertura completa y única de las
ocurrencias para Pro. Reproducción: Flash devuelve JSON inválido, Pro devuelve `[]`, y el Worker
responde **`provider: pro`, `pendingExplanation: false`**, sin explicación generada.

Corrección aplicada: Flash y Pro validan exactamente las ocurrencias accionables, con unicidad,
candidato perteneciente y cita no vacía; las ocurrencias `maintain` que no se enviaron al modelo se
conservan. Una salida vacía vuelve a determinista con `pendingExplanation: true`. Falta una
taxonomía persistida de motivos de escalamiento.

### Presupuesto · P1 · consumo real fuera del límite — corregido localmente

La reserva de una estimación no podía impedir que una respuesta real excediera el límite y un
timeout se liquidaba con cero tokens de salida. Ahora la liquidación atómica compara el consumo
acumulado con los límites; si se excede, libera la reserva, carga el consumo hasta el tope y el
Worker devuelve candidatos deterministas con `pendingExplanation: true`. Si el proveedor no informa
`usage`, se cobra la estimación reservada de salida. La regresión permanente cubre un consumo de
6.000 frente a un límite de 5.000; quedan la verificación D1 remota y la recuperación de reservas.

## Hallazgos de operación y preparación del corpus

### A8 · P2 · La identidad congelada no cubre todos los caminos — corregido localmente

Corrección aplicada: [`enqueueAdaptationJob`](../src/lib/adaptationClient.ts) conserva el primer
payload de la identidad y persiste propietario desde la cuenta activa. Los jobs heredados sin
propietario no se adivinan ni se envían: se ignoran hasta una migración explícita y segura.

Encolar, consentir o pulsar «Reintentar» emite ahora un wake-up que el shell escucha; además, el
cliente programa un temporizador para el `nextRetryAt` más próximo y lo limita a jobs/eventos de la
cuenta activa. Los errores de parseo/reconciliación se clasifican como `invalid-response`, y un 409
de reserva en curso queda como temporal. Coordinación entre pestañas y sincronización remota siguen
siendo gates de E0.

### A9 · P2 · Readiness comprueba presencia de bindings, no disponibilidad — corregido localmente

Corrección aplicada: [`readiness`](../worker/src/index.ts) ejecuta una consulta D1, comprueba
chunks aprobados de la versión activa y realiza una consulta mínima de Vectorize en su namespace.
Una respuesta sin matches también marca el índice como no disponible; `/health` sigue siendo
económico e independiente de modelos.

### A10 · P2 · Importación reanudable y reporte incompletos — corregido localmente

La [CLI](../scripts/corpus-cli.mjs) valida, reporta y mantiene un checkpoint JSON explícito. La
función [`importApprovedCorpus`](../worker/src/rag.ts) añade límites de lote/metadata, hooks y
namespaces, y ahora:

- devuelve el total importado y confirma también el lote parcial final;
- separa las escrituras y consultas por namespace y versión, incluyendo claves D1 de fuentes/chunks;
- coloca el namespace en cada vector, usa IDs físicos versionados además del ID lógico en metadata,
  y expone `rollbackCorpusVersion` con un adaptador explícito `delete(ids)`; sin adaptador, el
  rollback falla en lugar de fingir que borró vectores.

La importación remota sigue deliberadamente apagada: el checkpoint no marca chunks como completados
hasta que el operador confirme los upserts autorizados mediante `--complete`.

Los límites configurados de 1.000 vectores por lote del Worker y 10 KiB de metadata coinciden
con los [límites oficiales de Vectorize](https://developers.cloudflare.com/vectorize/platform/limits/).
La CLI debe validar exactamente la misma metadata que termina almacenando el importador.

### A11 · P2 · El manifiesto y las 50 consultas no son una evaluación aprobable

El [manifiesto](../worker/corpus/manifest.json) contiene propuestas, sin fragmentos. Los creadores
Jeff Nippard, Renaissance Periodization y Dr. de la Rosa se conservan, pendientes de permiso;
no deben bloquear las dos fuentes científicas iniciales.

Correcciones bibliográficas identificadas en las páginas originales:

- El consenso IUSCA es de **Schoenfeld y colaboradores**, publicado el 16 de agosto de 2021;
  la página declara CC BY 4.0. Registrar autores y localización de cada fragmento.
  [Fuente original IUSCA](https://journal.iusca.org/index.php/Journal/article/view/81).
- La revisión enlazada es de **Hickmott, Chilibeck, Shaw y Butcher**, publicada el 15 de enero
  de 2022, no de «Helms et al.». También declara CC BY 4.0, con salvedades para material de
  terceros. El ID local con sufijo `2021` no sustituye la fecha bibliográfica; no renombrarlo
  sin actualizar referencias. [Fuente original de la revisión](https://link.springer.com/article/10.1186/s40798-021-00404-9).

Estas comprobaciones no aprueban automáticamente fragmentos ni su uso: quedan cobertura,
limitaciones, atribución y revisión del material concreto. La auditoría no cambió `approved`.

[`evaluation-queries.json`](../worker/corpus/evaluation-queries.json) sigue en `label-template`:
las etiquetas son IDs de fuentes sin chunks relevantes y los negativos son creadores sin material
indexado. La CLI exige ahora exactamente esas 50 consultas, vectores 2048, IDs de chunks del corpus
y claims con respaldo explícito; todavía falta un runner con resultados reales.

La fórmula de Recall@5 cuenta la fracción recuperada de relevantes, y una evaluación sin citas o
claims obtiene cero. `evaluateCitationPrecision` usa los fragmentos que respaldan cada afirmación.
Aún falta cargar fragmentos reales y producir el reporte aprobable. Los fixtures locales siguen
siendo sintéticos; mantener los gates del plan: Recall@5 ≥80%, precisión ≥90%, y cambiar a 1024 solo
con mejora ≥3 puntos y sin deterioro de precisión.

## Cobertura del plan y trabajo pendiente

| Bloque del plan | Implementado en el checkout | Falta para darlo por cerrado |
|---|---|---|
| Contrato y candidatos | Entrada/salida compartidas, recálculo, selección por ocurrencia, transacciones y snapshots | Pruebas reales por ocurrencia y de varios cambios |
| Caída de rendimiento | Mediana de tres exposiciones y caso de caída simultánea | Casos límite: una sesión aislada, intercambio carga/reps y prescripción frente a ejecución; el nuevo `loadDrop OR repsDrop` también clasifica cambios compensados |
| Cola y experiencia | Payload congelado, estados de error, propietario por cuenta, cancelación, wake-up, scheduler y explicación pendiente en UI | Varias pestañas y sincronización duradera |
| Privacidad/autenticación | Consentimiento local versionado, auth gate, flag beta, JWT/allowlist/origen, aviso de respuesta derivada y propietario por cuenta | Prueba de sesión real y sincronización completa |
| Operación | Presupuesto de tokens/concurrencia con rechazo de exceso, HMAC, reserva/estado atómica, retención SQL, Cron y readiness activo | Integración D1, retención/Cron y recuperación tras fallos |
| Corpus/RAG | Fuentes propuestas, límites, hooks, checkpoint, namespace por vector, rollback por IDs y claims | Aprobación, permisos por fragmento, presupuesto y evaluación real |
| Generación | Flash/Pro validados por ocurrencia, tokens, fallback en errores, cancelación y deadline del cuerpo | Taxonomía persistida de motivos y ejecución con proveedor real |
| Publicación | Configuración explícita de producción con nombres/bindings existentes y flags en `false` | Publicar PWA compatible antes del Worker, migraciones verificadas y canarios sin gasto |

El deadline actual cubre `fetch` y `response.json()`, combinando la señal externa con la interna;
las regresiones locales cubren timeout de cuerpo y cancelación. La recuperación sobre D1/servicios
remotos y el proveedor real siguen pendientes, sin usar Pro como sustituto ante timeout/429/circuito abierto.

Las pruebas normales solo cubren una migración real v3→v5 y unos pocos backups. No acreditan toda
la matriz histórica v1–v5, propuestas múltiples, ejercicios repetidos, cambios concurrentes,
reversión sin pérdida de datos, presupuesto/idempotencia con D1 ni JWT válido/vencido real.

## Orden de cierre

1. Mantener las regresiones permanentes de A1–A8, presupuesto y aislamiento, con proveedores simulados.
2. Completar A9–A11, probar reanudación y rollback contra el binding real, etiquetar el corpus y validar fuentes/consentimiento.
3. Comprobar presupuesto/créditos y establecer límites de operación. Sin garantía de cero gasto adicional,
   conservar todos los proveedores apagados. El contador semanal heredado es informativo; el límite
   operativo real son tokens reservados/consumidos y concurrencia.
4. Publicar primero la PWA compatible y después el Worker con beta cerrada; verificar migraciones,
   CORS y sesión real con datos ficticios. Ejecutar también E2E y prueba de PWA instalada.
5. Activar embeddings, Flash y Pro por separado solo después de sus pruebas; reranking apagado.
   Abrir primero una cuenta y ampliar hasta cinco adultos tras autorización y rollback comprobado.

La programación, CLI/importación, evaluación, configuración, despliegues y pruebas técnicas son
trabajo de desarrollo. Al usuario corresponden participantes/IDs, login y MFA, revisión del corpus
y consentimiento, prueba en sus teléfonos y autorización de apertura. No pedirle JWT ni contraseñas.
