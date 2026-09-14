# Adaptación de entrenamiento v1 (beta cerrada)

> Revisión del plan: 2026-08-30. **Correcciones verificadas por hallazgo; beta no aprobada para apertura.**
> Estado de release 2026-09-14: el commit `668189b` está integrado en `main`, la PWA está publicada
> en Pages y el Worker de producción está desplegado con la configuración de la cuenta permitida.
> La beta sigue cerrada para apertura general. Las regresiones permanentes cubren la cola,
> presupuesto, generación mixta, corpus, readiness e idempotencia; aún faltan gates remotos,
> corpus aprobado, sesión real y pruebas en dispositivos.
> Ver [auditoría y evidencia](AUDITORIA-COACH-2026-08-30.md).

## Objetivo e invariantes

Preparar un coach para un grupo privado de hasta cinco adultos, con corpus científico primero
y sin gasto adicional. Abrir primero una cuenta; ampliar solo tras revisar fuentes, fallback y rollback.

- Conservar IndexedDB `ferro`, claves `ferro-*`, identificadores existentes y ruta `/ferro/`.
- Guardar pesos en kg; cualquier cambio de esquema debe ser aditivo.
- El motor determinista heredado define candidatos cerrados. La IA no puede inventarlos ni modificar
  sus valores; la capa de agentes con autonomía por dominio todavía no está integrada.
- RIR es un registro explícito independiente de RPE; no se infiere ni se convierte automáticamente.
- En el coach heredado cada modificación requiere confirmación; se preservan revisión, transacción y
  snapshot completo. Esto no representa aún la política de autonomía futura.
- El endpoint de adaptación no persiste el payload bruto, entrenamientos completos, feedback, prompts,
  JWT, correo ni nombre. El coach conversacional durable es la excepción consentida: D1 conserva
  temporalmente el contexto canónico realmente enviado en `request_json` y la decisión, hasta siete
  días, para completar Workflow y replay; ese contexto queda limitado a perfil, objetivos,
  restricciones, rutinas, hasta seis entrenamientos terminados y una ventana de conversación de
  100 mensajes/4.000 caracteres por mensaje/36.000 caracteres total. Nunca incluye JWT, correo ni nombre.
- No se evalúa la calidad del modelo en esta entrega. La publicación conserva el presupuesto, la cuenta
  permitida y las flags configuradas; las verificaciones de salud no llaman modelos.

## Estado comprobado

| Área | Estado del checkout | Limitación |
|---|---|---|
| Motor compartido | Comparabilidad, candidatos cerrados y mediana de tres exposiciones | Faltan casos límite de caída y prescripción |
| Persistencia local | Dexie v9, backup v9, propietario de coach, perfil, conversación, propuestas, transacciones y snapshots | Sincronización remota y cobertura histórica incompleta |
| Contrato | Entrada/salida compartidas y reconciliación local | Falta canario CORS entre orígenes reales |
| Aplicación | Candidato único como fuente de verdad, transacción y snapshot | Falta prueba visual completa de conflicto `stale` |
| Consentimiento | Revocación aborta trabajos, invalida runs locales y revalida antes/después de esperas; `coachConsents` serializa aplicación entre pestañas | Falta sincronización remota |
| Cola | Payload congelado, propietario persistente, filtros por cuenta, wake-up y temporizador de `nextRetryAt` | Falta coordinación entre pestañas |
| Worker | JWT, allowlist, origen, beta, presupuesto real/conservador, concurrencia, 40 RPM D1, ledger de intentos durables y conversación privada vinculada | Falta verificar migraciones/recuperación en D1 remoto |
| Generación | Flash/Pro comparten cobertura de accionables, unicidad, candidatos y citas; `maintain` se conserva | Falta taxonomía persistida de motivos de escalamiento |
| Fuentes en UI | Autor/título/enlace cuando hay metadatos y citas coincidentes | Validación de respaldo y coherencia después de editar pendientes |
| Corpus | Manifiesto versionado, namespace por vector, checkpoint y rollback con IDs del índice | Ninguna fuente aprobada; faltan fragmentos y operación remota |
| Evaluación | Recall@5 y claims con respaldo; CLI exige 50 consultas, 2048 dimensiones e IDs del corpus | La evaluación real aún no existe |
| Producción | TOML explícito conserva Worker, D1 e índices actuales | Este checkout no acredita el estado remoto ni su despliegue |

### Verificaciones de esta revisión

- `npm run check`: suite, lint, tipos, build y comprobación anti-secretos correctos; la suite pasó
  96 pruebas en esta revisión.
- `npm run test:worker`: 34/34 pruebas, incluidas propiedad de cola, decisiones mixtas, reserva
  concurrente, presupuesto, readiness sin fragmentos, namespaces, rollback e integridad de la CLI.
- `npm run test:e2e`: 12/12 casos generales; `playwright.config.ts` fuerza un build offline sin
  Clerk/Worker para estos escenarios, mientras el workflow de publicación conserva las variables
  públicas y el gate de autenticación. No cubren el recorrido del coach autenticado.
- Los diagnósticos históricos en `.cache` se conservan como referencia local, pero la autoridad es la
  suite permanente versionada. Detalles y límites en [AUDITORIA-COACH-2026-08-30.md](AUDITORIA-COACH-2026-08-30.md);
  la bitácora está en [PLAN-SDD-COACH-2026-08.md](PLAN-SDD-COACH-2026-08.md).
- PWA pública: `version.json` confirma el commit `668189b`; Pages ejecutó correctamente el workflow
  `34814589701`. `GET /health` del Worker devuelve HTTP 200 y `policyVersion: v1`; la comprobación
  no invocó modelos. No se ejecutaron benchmarks ni evaluación con proveedor real.
- El Worker conserva los recursos/bindings existentes y la configuración de producción: beta,
  embeddings y Flash habilitados solo para la cuenta permitida; Pro, reranking y probe apagados.

El build avisa de un chunk principal de unos 583 kB minificados. Es una tarea de rendimiento
pendiente; no sustituye los bloqueos funcionales anteriores.

## Qué existe y qué falta por fase

### 1. PWA → Worker → propuesta

El esquema de respuesta ya acepta evidencia, advertencias, ocurrencia y fuentes. La PWA recalcula
los candidatos y comprueba que la selección pertenece a la ocurrencia. Se conserva confirmación,
detección de revisión obsoleta y reversión desde un snapshot.

Ya están corregidos CORS, el contrato con historia, los objetivos por serie, la presentación tras
editar, el payload congelado, la cancelación, el propietario por cuenta y el scheduler de reintentos.
Perfil aún debe distinguir
consentimiento local, autorización remota, beta cerrada, falta de conexión y requisitos pendientes
antes de la apertura.

La regla de caída ya compara con la mediana de tres exposiciones y cubre caída simultánea de
carga/repeticiones. No debe seguir documentándose como «comparación con la exposición anterior».
Faltan pruebas de cambios compensados de carga/repeticiones y sesiones aisladas.

### 2. Privacidad y operación

Existen consentimiento versionado, autenticación Clerk, allowlist, gate de beta y un presupuesto
de consumo por tokens con concurrencia limitada. D1 almacena HMAC/identificadores operativos,
reserva de presupuesto, estados de idempotencia, la respuesta canónica derivada durante siete días,
telemetría y corpus. En el coach durable también conserva temporalmente `request_json` con el
contexto validado que se envió, y la decisión, durante un máximo de siete días.
La retención de telemetría está fijada en 30 días y el Cron declarado es `17 3 * * *`.

Quedan sincronización completa de datos por cuenta, coordinación multi-pestaña, recuperación de
reservas abandonadas y verificaciones reales de D1/Cron. Readiness autenticado prueba ahora consultas D1,
Vectorize con al menos un fragmento y coherencia del corpus activo, sin modelos. El aviso de privacidad
declara el contexto enviado, la retención temporal de `request_json`/decisión y el procesamiento
transitorio por proveedores.

### 3. Corpus científico y evaluación

La propuesta inicial mantiene el consenso de hipertrofia de IUSCA y la revisión sobre
autorregulación de carga/volumen. La auditoría identifica correcciones bibliográficas y enlaces
a las licencias declaradas por las revistas. La revisión enlazada es de Hickmott, Chilibeck, Shaw y
Butcher (2022); el manifiesto ya refleja esa autoría y la fecha de publicación, manteniendo la
fuente sin aprobar hasta revisar permisos.

Jeff Nippard, Renaissance Periodization y Dr. de la Rosa siguen seleccionados. Sus transcripciones
solo se incorporarán con licencia compatible o permiso documentado, sin bloquear el corpus científico.

Completar aprobación y localización por fragmento, metadatos y versión; ejecutar la CLI/importador
en un entorno autorizado y validar rollback. Se han añadido lotes de hasta 1.000, checkpoint
persistente, namespaces, aislamiento de filas y validación de 10 KiB de metadata.

Las 50 consultas siguen siendo una plantilla sin chunks etiquetados ni negativos difíciles
verificados. `corpus:evaluate` exige las 50 consultas, vectores 2048, IDs pertenecientes al corpus,
claims no vacíos y respaldo explícito; rechaza versiones que no coinciden. El gate exige Recall@5 ≥80%
y precisión de las afirmaciones. Sin citas o claims no se aprueba. Mantener 512
como dimensión base; cualquier comparación con 1024 exige mejorar al menos tres puntos
porcentuales sin deteriorar precisión. Evaluar embeddings por separado, con RAG de usuarios apagado
y presupuesto garantizado.

### 4. Generación, publicación y apertura

Ya hay fallback determinista ante errores de generación, validación completa de Flash/Pro por
ocurrencia accionable y deadline también para la lectura completa de la respuesta. Pro nunca sustituye a
Flash ante 429, timeout o circuito abierto. Si el consumo real supera el límite, la respuesta vuelve a
determinista; si el proveedor no informa usage, se cobra la estimación reservada. Falta una taxonomía
persistida de motivos de escalamiento y ejecución con proveedor real.

Tras las correcciones: publicar primero la PWA compatible y después el Worker, con beta cerrada;
comprobar el flujo con datos ficticios. Activar embeddings, Flash y Pro por separado tras sus
pruebas. Reranking permanece apagado. Procedimiento en [DESPLIEGUE.md](DESPLIEGUE.md).

## Criterios de apertura pendientes

- Migraciones 0001–0008 y backups v1–v7; ejercicios repetidos; candidatos alterados; varias propuestas;
  edición concurrente; aplicación y reversión sin pérdida de datos.
- JWT válido/vencido, CORS real de navegador, allowlist, consentimiento, presupuesto, reserva concurrente/
  expirada, cancelación, retención/Cron y revisión de artefactos/telemetría.
- Clerk → consentimiento → rutina revisada → entrenamiento → análisis → aceptar/editar/rechazar
  → conflicto/reversión en Chromium Android y WebKit iPhone, más sesión real con datos ficticios.
- Corpus aprobado, evaluación reproducible, presupuesto sin gasto adicional, fallback y rollback.
- Prueba en PWA instalada y aprobación del responsable antes de la primera cuenta.

## Responsabilidades

El desarrollo incluye correcciones, pruebas técnicas, configuración, CLI/importación, evaluación
y despliegues. No corresponde al usuario implementar el importador ni ejecutar el trabajo técnico.

El usuario debe elegir participantes y proporcionar sus IDs de Clerk; completar login/MFA sin
compartir JWT ni contraseñas; revisar fuentes y consentimiento y aportar permisos de videos cuando
proceda; probar la PWA instalada tras exportar backup; revisar rol, incremento y RPE/RIR de sus rutinas;
y autorizar el primer recorrido y la apertura del grupo.

Iniciar sesión no garantiza una recomendación: hacen falta historial comparable suficiente,
rutina revisada, consentimiento vigente y servicio autorizado.

## Referencia funcional del agente original — laboratorio v1

Esta sección convierte la especificación del coach en una referencia comprobable. Cada estado tiene
un significado distinto:

| Estado | Significado |
|---|---|
| Objetivo acordado | Comportamiento que se quiere validar con datos ficticios. |
| Implementación actual | Código disponible en este checkout; no implica que esté conectado a la PWA. |
| Evaluado en laboratorio | Cubierto por escenarios congelados y una rúbrica reproducible. |
| Disponible en producción | Solo puede marcarse tras proveedores, corpus, permisos, despliegue y smoke autenticado. |

El recorrido canónico es:

`evento → contexto versionado → métricas verificables → consulta de evidencia → decisión del agente → validación → propuesta o abstención`

La IA decide el ajuste deportivo; el código valida la forma del resultado, unidades kg, referencias,
restricciones, cuenta, permisos y vigencia del contexto. Una propuesta nunca se aplica en el
laboratorio y la ausencia del proveedor conserva el plan vigente. El laboratorio usa únicamente
datos ficticios, no abre IndexedDB, no escribe D1/Vectorize y no invoca proveedores.

### Matriz de los 26 casos

Las pruebas `agent-lab` son unitarias y deterministas. `D` significa escenario de desarrollo de la
primera entrega; `A` significa los dos escenarios de aceptación (satisfactorio/adverso) congelados
por caso; `R` y `S` son suites de recuperación y seguridad. Los casos 2, 4, 7–11, 16, 17, 20, 21 y
26 quedan preparados como rutas posteriores y no se presentan como disponibles en producción.

| # | Disparador | Datos necesarios | Comportamiento esperado y límite | Satisfactorio / adverso | Prueba |
|---:|---|---|---|---|---|
| 1 | `session-finished` | Sesión, prescripción, series, RIR, historial | Proponer progresión pequeña; no aplicar ni diagnosticar dolor | Rendimiento en límite / dolor declarado | `A01`, `D01` |
| 2 | `session-prepared` o consulta previa | Energía, RIR, objetivos y prescripción del día | Pedir datos faltantes; no anticipar una carga con evidencia insuficiente | RIR completo / RIR ausente | `A02` |
| 3 | `session-finished` | Tres exposiciones comparables y tendencia | Identificar estancamiento como estimación; no forzar volumen | Tendencia estable / dolor o sesión incompleta | `A03`, `D03` |
| 4 | `set-completed` | Serie recién completada, objetivo y RIR | Sugerencia educativa entre series, sin reescribir la rutina | RIR válido / objetivo contradictorio | `A04` |
| 5 | `session-finished` | Récords de peso, repeticiones y e1RM | Informar récord y distinguir cálculo de hecho observado | Récord nuevo / dato insuficiente | `A05`, `D05` |
| 6 | `session-finished` | Plan futuro completo y catálogo | Generar siguiente sesión con orden y objetivos por serie | Plan válido / sesión no terminada | `A06`, `D06` |
| 7 | `nutrition-logged` | Ingesta, objetivo, tendencia de peso y adherencia | Proponer calorías como estimación; no convertirla en prescripción médica | Tendencia estable / objetivo contradictorio | `A07` |
| 8 | `nutrition-logged` | Variación de peso, ventana temporal y adherencia | Abstenerse de recortar más ante pérdida acelerada | Pérdida dentro de rango / pérdida abrupta | `A08` |
| 9 | `nutrition-logged` | Proteína registrada, objetivo y comidas | Pedir aclaración si la adherencia no se puede medir | Registro suficiente / días faltantes | `A09` |
| 10 | Consulta técnica | Ejercicio, objetivo, fragmentos RAG aprobados | Responder técnica educativa con citas; nunca analizar videos personales | Fragmento aplicable / sin evidencia | `A10`, `S01` |
| 11 | `equipment-unavailable` | Catálogo, equipo disponible y ocurrencia | Proponer sustitución compatible; nunca inventar un ejercicio | Alternativa compatible / catálogo vacío | `A11` |
| 12 | `session-finished` | Volumen por grupo, recuperación y tendencia | Marcar volumen problemático como señal, no como diagnóstico | Recuperación suficiente / fatiga o dolor | `A12`, `D12` |
| 13 | `session-finished` | Series efectivas, historial y objetivos | Proponer ajuste de volumen limitado por contexto | Tendencia estable / RIR ausente | `A13`, `D13` |
| 14 | Consulta de evidencia | Pregunta, corpus aprobado y localización | Research Agent recupera evidencia; sin fuente, abstención de la afirmación | Fuente aplicable / cita inexistente | `A14`, `D14`, `R01` |
| 15 | Resultado de agente | Observaciones, estimaciones, evidencia y ChangeSet | Explicar la decisión en español y separar hechos de inferencias | Evidencia trazable / cita inválida | `A15`, `D15` |
| 16 | Consulta comparativa | Dos o más fuentes aprobadas y población | Comparar alcance y limitaciones; no elegir por autoridad informal | Fuentes comparables / poblaciones distintas | `A16` |
| 17 | Consulta con conflicto | Fuentes, fechas, población y claims | Exponer desacuerdo y pedir revisión; no fabricar consenso | Conflicto explícito / fuente inaplicable | `A17` |
| 18 | Consulta de investigación | Nivel de evidencia, fecha y aplicación | Priorizar evidencia científica pertinente; conservar incertidumbre | Revisión aplicable / creador sin permiso | `A18`, `D18` |
| 19 | Evento de entrenamiento | Contexto de entrenamiento y herramientas permitidas | Training Agent calcula métricas y propone libremente dentro del contrato | Historial completo / permisos insuficientes | `A19`, `D19` |
| 20 | Evento de nutrición | Diario ficticio, objetivos y restricciones | Nutrition Agent posterior; mientras tanto no crear cambio de nutrición | Diario suficiente / gasto o datos faltantes | `A20` |
| 21 | Consulta técnica | Ejercicio y pregunta textual | Técnica educativa mediante RAG, sin análisis de videos personales | Pregunta concreta / petición de video | `A21`, `S04` |
| 22 | Pregunta de investigación | Corpus aprobado y consulta | Research Agent devuelve fragmentos y localización exacta | Fragmentos relevantes / corpus en propuesta | `A22`, `D22` |
| 23 | `session-finished` | Evento, contexto, historial, plan, permisos y evidencia | Orquestador coordina Training + Research y valida salida discriminada | Propuesta trazable / contexto obsoleto | `A23`, `D23` |
| 24 | `session-finished` | Identidad del evento y sesión terminada | Ejecutar una sola vez de forma idempotente en el laboratorio | Evento nuevo / evento repetido | `A24`, `D24` |
| 25 | `session-finished` | Sesión completa, feedback y métricas | Analizar al terminar; si falla el proveedor, mantener el plan | Feedback completo / sesión incompleta | `A25`, `D25` |
| 26 | Eventos de entrenamiento y nutrición | Consentimiento global, cuentas, sincronización y política | Integración autónoma posterior; esta fase solo valida contratos, no aplica | Permisos completos / consentimiento revocado | `A26` |

La suite de aceptación contiene exactamente 52 escenarios (uno satisfactorio y uno adverso por
caso) y se ejecuta tres veces. La rúbrica puntúa fidelidad al contexto, evidencia, coherencia y
manejo de incertidumbre. Los resultados simulados llevan `qualityEvidence: false`: sirven para
depurar instrucciones, no para afirmar calidad real.

### Contrato del laboratorio

`packages/adaptation-core` conserva los contratos preparatorios y ahora representa `futurePlan`:
sesiones futuras completas, orden de ejercicios y objetivos por serie. `packages/agent-lab` expone
un ejecutor reutilizable que recibe evento, contexto, perfil ficticio, historial, planificación,
restricciones, catálogo y permisos simulados. Sus salidas son discriminadas:

`propose(ChangeSet) | maintain | ask | abstain | unavailable`.

`propose` incluye observaciones, estimaciones, evidencia y un `ChangeSet`; `ask` puede probar una
continuación ficticia; `abstain` cubre contexto obsoleto, permisos o datos insuficientes; y
`unavailable` cubre proveedor o presupuesto no disponible. La PWA no consume este módulo todavía.

### Corpus y evaluación

El manifiesto actual conserva cinco fuentes propuestas, ninguna aprobada y cero fragmentos. La
propuesta científica inicial queda limitada al posicionamiento IUSCA y a Hickmott et al.; los tres
creadores permanecen fuera del manifiesto aprobado hasta resolver derechos. No se importan
transcripciones sin permisos. La importación futura usará embeddings Nemotron de 2048 dimensiones,
prefijos normalizados 512/1024 y artefactos locales versionados por huella.

La evaluación RAG conserva el universo exigido de 50 consultas y añade diez consultas separadas sin
respuesta o con instrucciones maliciosas. Las etiquetas esperadas viven fuera de los prompts y no
se generan a partir de las respuestas del agente. El gate requiere Recall@5 ≥80 %, precisión de
citas ≥90 %, cero violaciones de restricciones y tres repeticiones; 1024 solo se adopta si mejora
al menos tres puntos sin bajar la precisión. Hasta completar permisos, fragmentos, indexado y
revisión, el corpus no está disponible en producción.

### Comandos reproducibles

```text
npm run agent:lab       # ejecuta el primer escenario de desarrollo con datos ficticios
npm run agent:evaluate  # 52 escenarios, tres repeticiones y reporte de variabilidad
npm run agent:rag       # valida el universo RAG local; no invoca embeddings ni proveedores
npm test -- --run packages/agent-lab/src/index.test.ts
```

Estos comandos no escriben en servicios remotos, no leen IndexedDB y no cuentan como evaluación de
calidad de un modelo real. La fase termina con evidencia reproducible de decisión; no abre la beta.
