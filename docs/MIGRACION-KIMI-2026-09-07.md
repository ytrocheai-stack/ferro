# Migración a Kimi K3 — trabajo en curso

El usuario pidió preparar el agente para evaluación y uso, cambiar a Kimi K3 y
corregir el tratamiento de NVIDIA como si tuviera un saldo de tokens. Esta nota
complementa `REVISION-CORPUS-2026-09-06.md`; no declara aprobado el release.

## Modelo y solicitudes

- NVIDIA confirmó mediante `GET /v1/models` autenticado (HTTP 200, 2026-09-07
  04:31:40 UTC) que la clave tiene acceso a `moonshotai/kimi-k3`.
- La configuración principal del Worker y benchmark usa Kimi. El identificador
  interno `flash` se conserva por compatibilidad de contratos; ya no significa
  que el modelo principal sea DeepSeek. Pro permanece deshabilitado.
- Kimi utiliza `temperature: 1`, `reasoning_effort: low` al nivel superior y un
  `max_tokens` explícito. No recibe la plantilla de razonamiento de DeepSeek.
- Autorización local nueva: `.cache/corpus/hevy/provider-authorization-kimi.json`.
  Modo `requests`, límite conservador de 40 RPM comunicado por el usuario,
  3.500 intentos totales incluidos los anteriores, máximo coste adicional cero.
  Los tokens son telemetría y límites de tamaño, no saldo NVIDIA.
- El diario local conserva todos los intentos y aplica una ventana móvil por
  minuto. No repite automáticamente un intento incierto. En modo solicitudes,
  un intento incierto no bloquea indefinidamente consultas distintas.
- Worker: migración aditiva `0010_provider_requests.sql`, reservas atómicas en D1
  para espaciar solicitudes globales cada 1.500 ms a 40 RPM. Incluye embeddings y
  generación. Debe aplicarse antes de habilitar el proveedor remoto del Worker.
- En modo solicitudes, los límites semanales de tokens dejan de ser predeterminados;
  se pueden configurar expresamente como límites de la aplicación. La concurrencia
  y los límites por salida permanecen. El laboratorio limita turnos y tamaño de
  cada respuesta, sin restar un supuesto saldo acumulado NVIDIA.

Referencias: [modelo y parámetros](https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer),
[endpoint gratuito](https://build.nvidia.com/moonshotai/kimi-k3),
[cambio de créditos a límites de frecuencia](https://forums.developer.nvidia.com/t/request-more-4-000-credits-option-on-build-nvidia-com/344567).

## Evidencia real y recuperación

La conectividad mínima respondió en 14.318 ms. Las pruebas iniciales q01 en 512 y
1024 devolvieron JSON válido. Sin embargo, q02 con recuperación anterior repitió
el error de presentar la introducción como conclusión. Se detuvo tempranamente
`results.kimi-v1.json` (dos respuestas confirmadas); el intento en curso conserva
su estado incierto. No se borró ni se convirtió su consumo en cero. Se respaldó
el diario en `ledger-before-summary-policy-2026-09-07.json` y se retiró únicamente
el lock del proceso local después de comprobar su terminación.

La política nueva `source-abstract-context-v1` acompaña los pasajes recuperados con
el abstract de su misma fuente. Mantiene el orden de fuentes recuperadas, respeta
filtros de elegibilidad y no consulta etiquetas del benchmark. Conserva abstracts
partidos en varios fragmentos. Se aplica en el retriever compartido, benchmark y
Worker; este último obtiene los abstracts desde D1.

Sin modificar consultas ni etiquetas:

| Métrica local | 512 | 1024 |
| --- | --- | --- |
| Recall@5 vectorial anterior | 79 % | 86 % |
| Recall@5 del contexto con abstracts | 96 % | 98 % |

Estas métricas son distintas. El gate de la política nueva evalúa el contexto
entregado con el mismo umbral del 80 %, conserva la métrica vectorial separada y
comprueba texto y orden contra el corpus. No se afirma que mejoraron los embeddings.
La ganancia contextual de 1024 es de dos puntos; por sí sola no justifica el gate
de migración dimensional de tres puntos.

q02 con abstracts respondió en 95.824 ms, citando correctamente los resultados
del metaanálisis y distinguiendo fuerza/hipertrofia de salto/sprint. Artefacto:
`kimi-q02-summary-diagnostic.json`. La revisión descrita es de Codex, no humana.

## Continuación pendiente

## Integración privada del agente en la app

La primera vertical del flujo real ya está implementada localmente y permanece
apagada en producción:

- `POST /v1/coach/runs` crea una ejecución `202` idempotente por cuenta, evento,
  contexto y configuración; `GET /v1/coach/runs/:id` consulta solo ejecuciones
  propias y `POST /v1/coach/runs/:id/cancel` cancela.
- `worker/migrations/0011_coach_runs.sql` conserva el hash de cuenta, el
  evento/contexto explícitamente consentidos mientras la ejecución es durable,
  estado, uso y decisión derivada. El payload no se guarda en el cliente sin
  consentimiento; su retención/limpieza del lado servidor sigue siendo un gate
  operativo previo a producción. Un índice único limita a una ejecución activa
  por cuenta.
- `CoachRunWorkflow` usa un Workflow de Cloudflare con una llamada Kimi de hasta
  120 s por paso, cuatro llamadas como máximo y diez minutos de ejecución. El
  recuperador semántico y la validación de citas son los mismos del Worker.
- Dexie v8 conserva runs y mensajes por `ownerId`; `/coach` muestra progreso,
  preguntas, abstenciones, evidencia y un botón de confirmación. La aplicación de
  un `ChangeSet` comprueba cuenta, versión, revisión y escribe snapshot/rutina en
  una transacción; nunca edita un entrenamiento terminado.

La suite local cubre las rutas y cancelación con un Workflow simulado; `npm run test:e2e:coach` cubre
creación, polling, continuación y cancelación en Chromium Android y WebKit iPhone; `npm run coach:agent-smoke`
queda disponible para el canario autenticado y exige `--execute` explícito. `0010` y `0011` ya fueron
respaldadas y aplicadas en el D1 remoto; los dry-runs y el despliegue de producción también están
verificados. Falta aún publicar la PWA actual, ejecutar el smoke autenticado, la revisión humana
y los gates remotos; por eso no se habilitaron flags ni se declara listo el release.

1. Completar validación del Worker con D1 y nuevos contextos, sincronizar la
   verificación remota de contexto y documentación operativa.
2. La corrida vigente es `results.kimi-k3-generated.json`, con checkpoint separado;
   su objetivo es 50 consultas × dos dimensiones × tres repeticiones. Lleva 24/300
   respuestas confirmadas. No mezclar este checkpoint con los artefactos Kimi de
   sondeo ni con los checkpoints DeepSeek anteriores.
3. Revisar cada respuesta y sus afirmaciones; el éxito HTTP/JSON no aprueba calidad.
4. Completar laboratorio remoto y aplicabilidad poblacional del corpus. Sus
   metadatos anteriores siguen sin certificación individual; no se han cambiado
   artificialmente a revisados.
5. Resolver gates antes de desplegar o habilitar uso. Producción sigue apagada.

Los comandos `corpus:review` y `corpus:release` apuntan por defecto al resultado Kimi
vigente y rechazan resultados de otro modelo, corpus, benchmark o conteo de llamadas;
los artefactos históricos quedan preservados, pero no pueden entrar al expediente por accidente.

La verificación final aprobó 41 suites/201 pruebas, Worker 48 pruebas, 13 E2E generales y 2 E2E del agente (1 skip esperado),
lint, typechecks, build y dry-run de ambos TOML. El Worker está desplegado como
`fd22c863-7744-425e-86ad-d9ea74cbdabf` con flags apagados;
la PWA pública aún no contiene estos cambios.

## Corrida Kimi posterior

El 2026-09-08Z se inició una corrida autorizada de benchmark Kimi con el expediente de coste adicional cero,
`40 RPM` y objetivo `50 × 2 × 3`. Se conservaron intactos los checkpoints DeepSeek anteriores y se creó
`.cache/corpus/hevy/results.kimi-k3-generated.json.checkpoint.json`. Quedaron **24/300** respuestas Kimi
confirmadas; el ledger conserva los 2,722 intentos (2,706 completados, 13 rechazados y 3 pendientes),
incluidos 10 rechazos HTTP 429. Los rechazos se conservaron y no se presentaron como respuestas válidas.
El proveedor no devolvió `Retry-After` y la corrida se detuvo tras una espera conservadora para no consumir
llamadas a ciegas. La evaluación, sus revisiones y el gate de release siguen pendientes.
