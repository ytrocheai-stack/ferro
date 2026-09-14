# Ejecución SDD del coach de NextRep

Fecha de ejecución: 2026-08-30. Especificación de origen: plan SDD adjunto en la tarea.

Este documento registra la trazabilidad de la implementación. La beta sigue cerrada hasta
completar los gates operativos y de consentimiento descritos en
[`DESPLIEGUE.md`](./DESPLIEGUE.md).

## Bitácora de esta ejecución · 2026-09-07

- Se leyó el plan de cierre y se preservó el checkout existente, incluidos cambios sin seguimiento.
- Se añadió el protocolo compartido del agente con el esquema JSON real, contexto tipado,
  conversation version, perfil/consentimiento versionados y Dexie v9/backup v9.
- Se añadió emisión de `session-finished`, conversación local completa con ventana enviada de hasta
  seis sesiones terminadas, aplicación transaccional de `futurePlan` y operaciones de creación/retirada.
- El Worker conserva un ledger durable por intento, deadline global de diez minutos, timeout de 120 s
  por llamada, Retry-After confirmado y desenlace incierto sin reenvío automático. Workflow usa retry 0.
- Verificado localmente: typecheck PWA/Worker, lint, tests frontend/paquetes y Worker. Pendientes externos:
  D1/Vectorize reales, presupuesto autorizado, benchmark/revisión independiente, canario, aprobación humana
  y 24 horas de observación.

## Bitácora adicional · 2026-09-08

- Se añadió `conversationId` al evento y al registro D1 (`0013`), verificando que una continuación no
  pueda recuperar una pregunta de otra conversación de la misma cuenta.
- El hash del contexto ahora incluye revisión de perfil, versión/revisión de consentimiento y el contexto
  conversacional enviado tiene un límite de caracteres; el historial completo permanece local.
- Revocar consentimiento vuelve obsoletas las propuestas pendientes y cancela ejecuciones locales activas.
  La UI muestra diferencias de sesiones, ejercicios y programación antes de confirmar un `futurePlan`.
- Regresiones añadidas para aislamiento conversacional e invalidación por revisiones. El E2E del coach pasa
  en Chromium y WebKit; no se ejecutaron proveedor remoto, canario ni despliegue.

## Bitácora de cierre · 2026-09-14

- El transporte del coach proyecta solo los campos públicos del mensaje; la historia enviada queda en
  una ventana de hasta 100 mensajes, 4.000 caracteres por mensaje y 36.000 en total. El `ownerId`
  permanece únicamente en IndexedDB y los pendientes heredados se normalizan sin cambiar su identidad.
- La generación de producción conserva DeepSeek Flash: 240 segundos por llamada, 600 segundos globales,
  Workflow con paso de 250 segundos y el máximo de llamadas existente. Los fallos distinguen cancelación,
  timeout de llamada, deadline global, error conocido y desenlace incierto; un desenlace incierto no se
  reenvía automáticamente.
- Se unificó el evento de cierre de sesión, se protegieron los errores de cola/coach y editor, se
  conservaron metadatos y calentamientos de rutinas, se excluyeron rutinas retiradas y se fijó el modo
  histórico de Nutrición frente al modo “Hoy”. La privacidad documenta la retención temporal de
  `request_json` y decisión del coach.
- Verificaciones de esta ejecución: `npm run check`, `npm run test:worker`, `npm run test:e2e` y
  `npm run test:e2e:coach`. No se ejecutan benchmarks ni evaluación con modelo real.

La tabla es una matriz de hallazgos técnicos, no una declaración global de que A1–A11 estén
aprobadas ni una aprobación del despliegue. El agente conversacional privado, su orquestación,
chat local, contexto versionado y aplicación transaccional están integrados localmente; la
evaluación remota, el canario y la observación productiva siguen siendo gates independientes.

## Estado de las correcciones

| Diagnóstico | Requisito | Implementación | Regresión | Estado |
|---|---|---|---|---|
| A1 | CORS debe autorizar las cabeceras que envía la PWA | `worker/src/index.ts` comparte la lista canónica de cabeceras | Auditoría reproducida: 1 caso | Cerrado técnicamente |
| A2 | Entrada de historial única entre PWA y Worker | `packages/adaptation-core/src/contract.ts` exporta el esquema de exposición e input; el Worker lo consume | Auditoría reproducida: 1 caso | Cerrado técnicamente |
| A3 | Revocación cancela el lote y revalida consentimiento | `src/lib/adaptationClient.ts` usa `AbortController`, revalida antes/después de cada espera y escucha cambios de consentimiento | Auditoría reproducida: 1 caso | Cerrado técnicamente |
| A4 | Reserva de idempotencia atómica, incluida fila expirada | UPSERT condicional en D1/SQLite antes del presupuesto y proveedor; presupuesto de tokens/concurrencia | Auditoría reproducida: 1 caso | Cerrado técnicamente |
| A5 | Aplicar repeticiones actualiza objetivos por serie | `applyCandidate` conserva carga y actualiza `setTargets` | Auditoría reproducida: 1 caso | Cerrado técnicamente |
| A6 | Presentación y aplicación usan el mismo candidato | Edición sincroniza campos derivados y la tarjeta renderiza `candidate` | Auditoría reproducida: 1 caso | Cerrado técnicamente |
| A7 | Flash/Pro requieren cobertura completa, única y citada | Validación por ocurrencia antes de aceptar una explicación | Auditoría reproducida: 1 caso | Cerrado técnicamente |
| A8 | Payload congelado y reintentos despertables | La cola conserva el primer payload, persiste propietario, filtra por cuenta, cancela y programa `nextRetryAt` | Suite permanente cliente/Worker | Cerrado localmente; falta coordinación multi-pestaña/sincronización remota |
| A9 | Readiness prueba disponibilidad real | Consulta D1, coherencia de corpus activo y consulta Vectorize sin modelos | Auditoría reproducida: 1 caso | Cerrado técnicamente |
| A10 | Importación reanudable y aislada por versión | Conteo/checkpoint final, namespace dentro de cada vector, metadatos versionados y rollback por IDs | Regresiones permanentes de importer | Cerrado localmente; falta ejecutar D1/Vectorize de producción |
| A11 | Corpus y evaluación aprobables | Metadatos bibliográficos y CLI con 50 consultas, dimensiones/IDs/claims validados | Fixtures locales | Parcial: requiere permisos, fragmentos reales y evaluación aprobada |

## Registro de cambios

### 2026-08-30 · contratos, colas e idempotencia

- Se eliminó la definición duplicada del input de análisis. Una exposición previa ya no puede
  contener accidentalmente otro `previousExposures`.
- Se añadieron las cabeceras de consentimiento/dispositivo al preflight CORS.
- La cola conserva el primer payload por identidad, persiste el `ownerId` de Clerk, filtra por
  cuenta y despierta el procesador al encolar, reintentar o vencer `nextRetryAt`. Los jobs heredados
  sin propietario se ignoran; no se asigna una cuenta por inferencia.
- El cambio de cuenta, la revocación y la desconexión abortan el procesamiento; cada job vuelve a
  comprobar el consentimiento después de esperas asíncronas.
- La reserva de idempotencia reclama filas expiradas con un UPSERT condicional atómico.
- La migración `0006` persiste la respuesta canónica durante la ventana de idempotencia (siete días)
  para que una repetición equivalente devuelva el resultado guardado, sin regenerar ni consumir otra
  llamada; el aviso de privacidad ya declara esos datos derivados.
- Las propuestas de `increase-reps` escriben sus objetivos por serie y las ediciones sincronizan
  los campos derivados.
- Las respuestas generadas deben cubrir cada ocurrencia exactamente una vez, seleccionar solo un
  candidato de esa ocurrencia y aportar citas.
- Se añadieron los contratos compartidos de `CoachEvent`, `AgentRun`, `ChangeSet`,
  `EvidenceReference`, `AutonomyPolicy` y `MemoryFact`; las operaciones no incluyen editar
  silenciosamente un entrenamiento ya realizado.
- RIR se registra por separado de RPE, se valida de 0 a 10 y se conserva en sesión, historial,
  backups, CSV e input del coach; no se convierte automáticamente entre ambas señales.
- La cuota de llamadas dejó de ser la protección operativa: la migración `0005` reserva tokens
  estimados y concurrencia por cuenta/semana, liquida el consumo real, rechaza una respuesta que
  exceda el límite y cobra la estimación cuando el proveedor no informa usage.
- Readiness deja de confundir un binding presente con D1/Vectorize disponibles.
- El importador devuelve el total, confirma el lote parcial final, escribe el namespace y un ID
  físico versionado dentro de cada vector y separa fuentes/chunks por versión. Rollback exige un adaptador `delete(ids)` o
  `deleteByNamespace` explícito; no se presenta un método nativo inexistente.
- La CLI de evaluación exige el universo de 50 consultas, vectores 2048, IDs del corpus, claims no
  vacíos y respaldo explícito antes de calcular el gate.
- `corpus:evaluate` valida resultados etiquetados con `corpusVersion`, calcula Recall@5 en 512/1024
  y precisión de citas por claim, y falla si el corpus no está listo o no supera los gates.

## Gates aún no habilitados

- No se activan NVIDIA, embeddings, Flash, Pro ni reranking.
- El presupuesto operativo y su regresión de exceso/usage desconocido están implementados localmente,
  pero sus límites y la migración `0005` aún deben verificarse en D1 remoto antes de abrir.
- No se considera aprobada ninguna fuente del manifiesto sin revisión de licencia, fragmentos,
  atribución y evaluación real.
- La UI exige Clerk cuando el coach está configurado y los artefactos de cola/propuesta/evento llevan
  propietario; la cuenta, los datos personales, fotos, backups y diario no tienen sincronización remota
  por cuenta, como exige el límite de privacidad del plan.

## Diseño de agentes integrado localmente; gates remotos pendientes

Los contratos `CoachEvent`, `AgentRun`, `EvidenceReference`, `ChangeSet`, `AutonomyPolicy` y
`MemoryFact` se usan junto con el motor compartido del agente, las rutas de conversación y el
ejecutor transaccional del `futurePlan`. No se declara cerrada la trazabilidad remota de los 26
casos del plan porque aún faltan benchmark, revisión independiente, laboratorio, canario,
aprobación humana y observación productiva.
