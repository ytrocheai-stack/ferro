# NextRep Adaptation Worker

## T0 — proveedor y modelos fijados

La configuración por entorno es explícita: `worker/wrangler.toml` declara Gemini/NVIDIA
con las flags apagadas para desarrollo, mientras `worker/wrangler.production.toml` fija
`gemini-3.5-flash-lite` como preferido y `z-ai/glm-5.3-flash` como fallback,
con 40 RPM NVIDIA, `coach-context-v3-gemini-nvidia` y streaming apagado. Pro,
reranking y provider probe permanecen apagados. `gpt-5.6-luna` está documentado
para la API de Codex, pero no está verificado que esta PWA pueda acceder a él con la
suscripción del usuario sin nuevas credenciales ni facturación de API. No se debe
interpretar el uso de Luna como agente dentro de Codex como modelo del Worker.

No se modifican secretos ni se incluyen en TOML, bundle, readiness o logs. Las comprobaciones
de este bloqueo son locales y documentales; no acreditan acceso remoto, despliegue,
Clerk real ni teclado Android real. El detalle y las comprobaciones pendientes están
en [el informe T0](../docs/MIGRACION-NEXTREP-T0-2026-09-09.md).

> Auditoría 2026-08-30: correcciones verificadas por hallazgo, **no abrir la beta**. El endpoint remoto
> [health](https://nextrep-adaptation.yehoshuatroche.workers.dev/health) responde 200, pero esta
> revisión no acredita que los cambios locales, las migraciones nuevas o los flags estén desplegados.
> [Hallazgos y reproducciones](../docs/AUDITORIA-COACH-2026-08-30.md).

> Release 2026-09-14: el Worker `nextrep-adaptation` está desplegado desde `main` en la versión
> `fa2d6eed-654b-48a6-8d07-4fae20332f6f`. `/health` respondió 200 sin invocar proveedores;
> la configuración de producción mantiene Flash solo para la cuenta permitida y Pro/reranking/probe apagados.

Worker independiente para adaptación de entrenamiento. Usa el motor determinista compartido,
JWT de Clerk, origen autorizado y allowlist. El código de producción exige D1, clave HMAC y
configuración de autenticación. La beta requiere habilitación explícita; las peticiones de análisis
incluyen consentimiento versionado y dispositivo.

## Rutas

| Ruta | Comportamiento actual |
|---|---|
| `GET /health` | Pública, económica, sin proveedores; informa disponibilidad y política |
| `GET /readiness`, `GET /v1/readiness` | Autenticadas; prueban consultas D1, disponibilidad de Vectorize y corpus activo, y muestran configuración de proveedores sin claves |
| `POST /v1/adaptations/analyze` | Auth, beta, consentimiento, presupuesto/reserva, candidatos y explicación opcional |
| `POST /v1/adaptations/events` | Auth/beta y eventos operativos de aceptación; no persiste el payload del entrenamiento |
| `POST /v1/coach/runs` | Auth, beta, consentimiento e idempotencia; crea una ejecución durable de DeepSeek Flash mediante Workflow |
| `GET /v1/coach/runs/:id` | Consulta autenticada de una ejecución propia |
| `POST /v1/coach/runs/:id/cancel` | Cancela una ejecución propia y termina su Workflow |
| `POST /v1/coach/runs/:id` | Alias legado de cancelación; los clientes nuevos usan `/cancel` |
| `POST /v1/providers/probe` | Auth/beta/flag propio; informa flags/modelos, sin ejecutar modelos |

La respuesta y la entrada viven en `packages/adaptation-core/src/contract.ts`. El cliente verifica
candidatos contra el motor local y el Worker valida la misma forma, incluida la regla de que solo la
exposición actual contiene `previousExposures`. El preflight autoriza las cabeceras de consentimiento
y dispositivo; el canario real entre Pages y Worker aún es un gate de publicación.

## Datos operativos

D1 guarda HMAC del usuario/request, identificadores, estados, presupuesto, latencia, tokens/códigos
de error y eventos. Conserva hasta siete días la respuesta canónica derivada de un análisis para
replay idempotente —puede contener ejercicio, cargas, repeticiones, decisiones, citas e
identificadores de exposiciones comparables—, pero no
persiste el payload bruto de adaptación, sets, feedback completo, prompts, JWT, correo, nombre ni
respuestas crudas de proveedores. Las ejecuciones del coach son la excepción consentida: conservan
temporalmente en `request_json` el contexto canónico validado que se envió (perfil, objetivos,
restricciones, rutinas, hasta seis entrenamientos terminados y conversación limitada a
100/4.000/36.000 caracteres) y su decisión; el cron elimina runs terminales después de siete días.
Tampoco se guarda JWT, correo ni nombre. También contiene fuentes y fragmentos del corpus autorizado.

Presupuesto por semana ISO: por defecto 250.000 tokens de entrada, 50.000 de salida y 2 ejecuciones
concurrentes (la configuración de producción del canario fija 1 ejecución concurrente; ambos límites
son sobrescribibles por configuración privada). Cada intento reserva el prompt completo y
4.000 tokens de salida; Pro amplía la reserva sin incrementar `active_runs`. La liquidación conserva
por separado tokens medidos, estimados y `usage_incomplete`: un cero informado es válido y un
contador ausente o inválido se estima. Una respuesta que excede el límite vuelve a fallback
determinista. La retención de telemetría es de 30 días mediante Cron diario. Hay replay determinista,
rechazo de payload diferente y UPSERT condicional para reclamar filas expiradas sin duplicar
generación. La recuperación operativa de una reserva abandonada y la prueba sobre D1 remoto siguen
siendo gates.

Las migraciones `0001`–`0018` están en disco. `0014`–`0016` añaden presupuesto global,
leases y snapshots; `0017` añade failover/circuitos por proveedor y `0018` reconcilia el
estado de cuota Gemini. Son aditivas: no revertirlas destructivamente ni darlas por aplicadas
en D1 remoto sin verificación.

## RAG y generación

- `src/rag.ts`: embeddings `passage` de 2048 dimensiones, prefijos L2 a 512/1024 (768 solo se
  conserva como compatibilidad de evaluación),
  validación de metadata ≤10 KiB y lotes ≤1.000.
- La reanudación admite `skipIds/onBatch`, confirma el lote final parcial y devuelve el total. La
  CLI mantiene un checkpoint JSON explícito mediante `--checkpoint`, versiona su esquema físico y
  rechaza reanudaciones incompatibles; acepta `--complete` después de confirmar un upsert autorizado.
- Cada vector incluye el namespace `nr2:<sha256-base64url(corpusVersion)>:<dimensión>` y un ID físico
  `v2:<sha256-base64url([corpusVersion, chunkId])>`; ambos respetan 64 bytes UTF-8. Las filas D1
  incluyen la versión y conservan `vector_id`. `rollbackCorpusVersion`
  obtiene y borra esos IDs mediante `delete(ids)` antes de eliminar las filas D1; el binding nativo
  no se trata como si tuviera un `deleteByNamespace` inexistente.
- `src/index.ts`: embeddings `query`, recuperación de hasta 20 resultados y selección de hasta
  ocho/dos por fuente por contexto; contenido recuperado tratado como no confiable.
- `packages/adaptation-core/src/contract.ts` también define los contratos base de eventos, runs,
  cambios, evidencia, autonomía y memoria para la siguiente entrega del orquestador.
- Flash y Pro comparten validación por ocurrencia accionable, cobertura exacta, candidatos cerrados y
  citas; las decisiones `maintain` no enviadas al modelo se conservan. Una salida vacía o inválida
  vuelve a candidatos deterministas con explicación pendiente.
  Los fallos de generación deben conservar candidatos deterministas y explicación pendiente.
- Pro no debe reemplazar a Flash ante 429, timeout o circuito abierto. `withDeadline` combina la
  cancelación externa y cubre `response.json()`; las pruebas locales cubren timeout y cancelación.
  Reranking no tiene adaptador operativo.

El manifiesto versionado bajo `worker/corpus/` conserva la especificación editorial y no contiene
el corpus privado. `npm run corpus:prepare -- --input <Hevy_Corpus>` importa exclusivamente
`rag/science_chunks.jsonl` desde Downloads, verifica SHA256/XML, recupera los 47 autores ausentes
y escribe el manifiesto normalizado fuera de Git: 88 fuentes y 2.708 fragmentos. La autorización
para recuperar no certifica calidad científica; `populationReviewed=false` mantiene cerrada la
recuperación de recomendaciones hasta revisión aplicable.

`corpus:embed` conserva embeddings originales de 2.048 dimensiones y prefijos L2 512/1024 en una
matriz cacheada por modelo/texto. `corpus:upload` exige autorización explícita, capacidad/coste
verificados, backup D1, lotes confirmados y checkpoint; crea `nextrep-adaptation-512`, conserva
`nextrep-adaptation-768` y usa un namespace nuevo para el índice de evaluación 1024. Ambos comandos
son plan-only por defecto.

Las 50 consultas se vinculan al hash exacto del manifiesto mediante `corpus:benchmark`; el ejecutor
produce recuperación local y, sólo con Flash autorizado, respuestas reales sin enviar etiquetas de
relevancia. `corpus:evaluate` exige exactamente 50 consultas, vectores de 2.048 dimensiones, IDs
pertenecientes al corpus, claims y revisión independiente. Sin proveedor, índice remoto o revisión,
el diagnóstico queda bloqueado y no acredita calidad.

Desde la raíz:

```bash
npm run corpus:validate
npm run corpus:report
npm run corpus:import-plan -- --checkpoint .cache/corpus-import.json
npm run corpus:evaluate -- --results .cache/corpus-evaluation.json
npm run corpus:status
npm run check
npm run test:worker
```

La CLI de plan no llama a proveedores: prepara y persiste el checkpoint, reporta lotes pendientes y
sus namespaces; los scripts `corpus:embed` y `corpus:upload` son los únicos que ejecutan llamadas
reales y exigen autorización explícita. Los resultados reales deben conservarse fuera de Git y
seguir bloqueados hasta revisión independiente.
Gates: Recall@5 ≥80%, precisión de citas ≥90%, ninguna evaluación sin citas aprobada; la configuración
vigente usa 512 y cualquier comparación con 1024 exige mejora de ≥3 puntos sin perder precisión.

## Laboratorio fuera del Worker

El agente original se ejecuta de forma aislada en `../packages/agent-lab`. El comando
`npm run agent:lab` no toca este Worker, IndexedDB, D1 ni Vectorize. La primera entrega implementa
la coordinación local de `session-finished`, Training Agent y Research Agent con datos ficticios.
El corpus del Worker continúa siendo una propuesta: el laboratorio no lo trata como aprobado y no
lo convierte en evidencia. Cualquier ejecución provider/Flash requiere comprobar acceso y presupuesto
antes de habilitar llamadas; un error no selecciona automáticamente Pro.

## Configuración y publicación

Los TOML conservan nombre del Worker, D1 y los dos índices existentes. `wrangler.toml` usa
desarrollo con proveedores apagados; `wrangler.production.toml` declara el orden y modelos de la
beta privada, pero falla cerrado si faltan claves o cuotas efectivas. **Ambos apuntan al
mismo Worker**: no publicar producción con el comando genérico `deploy`.

Tras corregir los bloqueos y verificar migraciones/configuración privada:

```bash
npm run deploy:production
```

Publicar primero la PWA compatible y después el Worker con beta cerrada. No incluir secretos en
Vite ni en el repositorio. No activar embeddings, Flash o Pro sin pruebas separadas y garantía
de presupuesto/créditos sin gasto adicional. La [guía de despliegue](../docs/DESPLIEGUE.md) detalla
el orden de canarios, sesión real y autorización de apertura. No activar proveedores sin garantía
de presupuesto y ausencia de gasto adicional.
