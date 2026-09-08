# Verificación del plan del agente original de NextRep

Fecha: 2026-09-04, America/Mexico_City. Referencia: plan aportado por el usuario «Preparar y evaluar al agente original de NextRep». Checkout: `267ba5c` más los cambios locales existentes al iniciar esta revisión; este hash por sí solo no identifica los archivos auditados.

**Dictamen: implementación parcial; documentación parcialmente correcta; laboratorio no aceptado.** Existe una estructura ejecutable de simulación, pero falta el agente que decide mediante un modelo y evidencia científica. Las pruebas generales pasan y no acreditan el cumplimiento funcional del plan.

La revisión ejecutó comprobaciones locales y reproducciones con datos ficticios. No invocó modelos, no revisó créditos ni acceso remoto, no desplegó, no abrió la beta y no accedió a datos personales del navegador. No corrigió la implementación ni reescribió las auditorías históricas. El único archivo añadido por esta revisión es este informe. No se ejecutaron E2E ni se renovaron las comprobaciones remotas históricas.

## Resultados ejecutados

| Comprobación | Resultado observado | Interpretación |
|---|---|---|
| `npm run check` | Correcto: lint, tipos de PWA/Worker, 102 pruebas en 23 archivos, build y comprobación del bundle | Incluye las seis pruebas de `agent-lab`; no es aceptación del agente |
| `npm run test:worker` | 34/34, cuatro archivos | Estas pruebas ya están incluidas en las 102 |
| `npm run agent:lab` | `propose`, cero evidencias, `executionMode: simulated`, `qualityEvidence: false` | Ejecuta reglas locales |
| `npm run agent:evaluate` | 52/52 aceptados, 156 ejecuciones, tres repeticiones, cero cambios de decisión, `passesGate: true` | Resultado de simulación con los defectos de evaluación descritos abajo |
| `npm run agent:rag` | 50 consultas, Recall@5 = 0, `noAnswerPassRate: 0`, `passesGate: false` | No hay evaluación RAG aprobada; el comando termina con código 0 y `failures: []` incluso al fallar el umbral |
| `npm run corpus:report` | Cinco fuentes, cero aprobadas, cero fragmentos, `readyToImport: false` | No existe el corpus inicial entregable |
| `npm run corpus:evaluate` | Rechaza la ejecución: requiere `--results <json>` | No se aportó un artefacto de resultados reales; esta invocación no evalúa calidad |

Node utilizado: v25.6.1. El build avisó de un chunk principal de 597,07 kB minificados; no bloqueó el build. Se preserva ese aviso como resultado técnico, separado de los requisitos del laboratorio.

## Cumplimiento por entregable

| Entregable del plan | Estado | Evidencia y faltantes |
|---|---|---|
| Especificación y matriz de 26 casos | Parcial | La matriz conserva numeración, disparadores, datos, límites y ejemplos breves; mantiene técnica educativa sin videos personales. Las referencias A/D/R/S no equivalen a cobertura real por caso y no se asignan los cuatro estados a cada caso |
| Corpus inicial revisado y trazable | Pendiente | Solo propuesta editorial. Faltan aprobación, fragmentos con localización/población/limitaciones, vectores locales y evaluación |
| Agente ejecutable en laboratorio | Parcial | Módulo TypeScript, CLI, contexto ficticio y salidas discriminadas disponibles. Training sigue siendo determinista; Flash no tiene adaptador de ejecución en el laboratorio |
| Escenarios, rúbricas y comandos reproducibles | Parcial con defectos de validez | Comandos operativos; desarrollo y aceptación se solapan, los casos no tienen estímulos específicos, seguridad no se ejecuta como suite y la rúbrica no revisa propuestas libres |
| Informe de resultados y requisitos de integración | Pendiente al inicio de la revisión | No se encontró un informe de calidad real del agente ni sus tres ejecuciones finales. Este documento registra la auditoría de implementación, no sustituye esa evaluación |

Sí están presentes los contratos `futurePlan`, sesiones, orden y objetivos por serie en [contract.ts](../packages/adaptation-core/src/contract.ts), el aislamiento respecto de IndexedDB/D1/Vectorize y el etiquetado explícito `qualityEvidence: false`. El laboratorio no aplica propuestas. Las utilidades heredadas se reutilizan, pero no se invoca su generador de candidatos cerrados. Eso no basta para que las decisiones pasen a estar a cargo de la IA.

## Hallazgos

### H1 — P1: falta el núcleo de decisión del agente original

[agents.ts](../packages/agent-lab/src/agents.ts), líneas 24–36 y 84–118; [orchestrator.ts](../packages/agent-lab/src/orchestrator.ts), líneas 22–36.

Training decide mediante condicionales y solo llega a incrementar carga o repeticiones. El incremento de carga está fijado en 2,5 kg. Research se ejecuta después de construir la propuesta y añade fragmentos como evidencia; no informa la decisión deportiva. No hay llamada a Flash, bucle de herramientas ni instrucciones de modelo ejecutables: existen etiquetas de versión y configuración preparatoria.

Reproducción: ejecutar el escenario D01 con `{ mode: 'provider', providerAvailable: true }` sigue produciendo la misma propuesta simulada de 102,5 kg. No se realiza una llamada real. Por tanto, el modo proveedor está sin implementar, no simplemente deshabilitado por falta de presupuesto.

Pendiente: implementar decisión por modelo con herramientas y evidencia previa, preservando el plan ante indisponibilidad. Las llamadas reales deben esperar a verificar acceso y presupuesto sin gasto adicional; esa condición no impide construir y probar el adaptador con respuestas simuladas.

### H2 — P1: la validación permite propuestas contrarias a restricciones expresas

[agents.ts](../packages/agent-lab/src/agents.ts), líneas 91–118; [orchestrator.ts](../packages/agent-lab/src/orchestrator.ts), líneas 39–44.

Se leen restricciones, pero solo se usa dolor/lesión. No se comprueban ejercicios excluidos, equipo no disponible ni pertenencia al catálogo antes de devolver una propuesta. La validación de entrada no valida los valores numéricos del historial completo.

Reproducciones independientes sobre D01:

| Modificación ficticia | Resultado |
|---|---|
| `excludedExercises = ['squat']` | Propone aumentar esa sentadilla a 102,5 kg |
| `unavailableEquipment = ['barra', 'rack']` | Propone la misma sentadilla con barra |
| `catalog = []` | Sigue proponiendo el ejercicio |
| Objetivos opuestos y `feedback.contradictory = true` | Propone sin solicitar aclaración |
| Pesos negativos en todas las series del historial | Acepta la entrada y propone 102,5 kg |

Esto incumple el requisito de cero violaciones de restricciones e integridad, aunque no se aplique el cambio. Falta validar contexto y referencias semánticas además del esquema del ChangeSet.

### H3 — P1: los escenarios y la rúbrica no demuestran aceptación funcional

[scenarios.ts](../packages/agent-lab/src/scenarios.ts), líneas 33–62; [evaluation.ts](../packages/agent-lab/src/evaluation.ts), líneas 41–76.

El plan exige 28 escenarios independientes para los 14 casos iniciales. La implementación fabrica 52 para los 26 casos. Ampliar la cantidad no sería un problema por sí mismo; el problema es que cambia principalmente nombres/IDs y el tipo de evento. Los 14 casos iniciales satisfactorios comparten el mismo historial de sentadilla ascendente; todos sus adversos utilizan dolor. Los doce casos posteriores se resuelven como evento no soportado.

Los **14 inputs de desarrollo son idénticos a sus equivalentes de aceptación**, incluidos IDs. No se encontró evidencia de congelación independiente previa al ajuste. Ningún escenario incluye `continuation`; el evaluador tampoco ejecuta la función de continuación. Las diez consultas maliciosas solo están en `description`, fuera del `LabInput` recibido por el agente: hay un único input de seguridad repetido diez veces y la CLI no ejecuta esa suite.

`scoreDecision` comprueba principalmente la etiqueta de decisión, evidencia mínima —configurada en cero—, una palabra en la explicación y versión del contexto. Ignora `requiredAgents` y no revisa fidelidad, coherencia deportiva, respaldo de afirmaciones, aplicabilidad o restricciones. `accepted`, `failures` y `passesGate` utilizan solo la primera repetición, aunque se guarden las tres. Actualmente son deterministas; el defecto impediría usar este agregado para evaluar variabilidad real.

El resultado 52/52 debe describirse como comprobación del simulador. No es el ≥90 % de aceptación exigido por el plan. Se necesitan fixtures distintos por comportamiento y conjunto, aclaraciones ejecutadas, seguridad introducida en el input y revisión de todas las repeticiones y afirmaciones nuevas.

### H4 — P1: corpus pendiente y evaluador RAG distinto del recuperador real

[manifest.json](../worker/corpus/manifest.json); [evaluation-queries.json](../worker/corpus/evaluation-queries.json); [evaluation.ts](../packages/agent-lab/src/evaluation.ts), líneas 79–97; [cli.ts](../packages/agent-lab/src/cli.ts), líneas 20–23.

El corpus conserva cinco fuentes propuestas y ningún fragmento. Las 50 consultas tienen `status: label-template`, fuentes esperadas en vez de fragmentos revisados y no incluyen afirmaciones respaldadas. La CLI deduce relevantes a partir de todos los fragmentos de la fuente esperada. No existen aquí la comparación Nemotron 512/1024 ni los artefactos locales de embeddings requeridos.

Además, `evaluateRagQueries` usa una búsqueda léxica propia que no filtra aprobación ni requiere coincidencia positiva, distinta de `searchEvidence`. Su gate solo exige 50 consultas y Recall@5 ≥80 %; no comprueba precisión de citas ≥90 %, seguridad ni afirmaciones.

Reproducción: con un corpus `status: proposal`, fuente `approved: false`, un fragmento «carga» y 50 consultas que lo etiquetan relevante, devuelve Recall@5 = 1 y `passesGate: true`. El recuperador real `searchEvidence` devuelve `[]` para ese mismo corpus. El gate puede acreditar evidencia que el agente no tiene permitido recuperar.

Ya existe un evaluador más estricto en [packages/corpus-evaluation](../packages/corpus-evaluation/src/index.mjs), pero `agent:rag` no lo utiliza. Hace falta reutilizarlo o garantizar reglas equivalentes, con las etiquetas de fragmentos, claims y resultados reales exigidos; un fallo del gate también debe ser detectable por automatización.

### H5 — P1: los objetivos futuros pierden las cargas individuales por serie

[agents.ts](../packages/agent-lab/src/agents.ts), líneas 24–38 y 69–77.

`targetForExercise` toma el primer peso definido y lo aplica a todas las series, incluidos calentamientos. Reproducción: cambiar el primer objetivo de D01 a un calentamiento de 20 kg × 10, manteniendo las dos series de trabajo a 100 kg. La salida prescribe las tres series a **22,5 kg × 5**. No conserva la prescripción por serie ni distingue calentamiento de trabajo.

También ignora el incremento del ejercicio —cambiarlo a 5 kg conserva la subida de 2,5 kg—. El recorrido selecciona el primer ejercicio, empareja por `exerciseId` con una alternativa que puede confundir ocurrencias y solo devuelve la primera sesión. El contrato permite planificación amplia, pero la generación/evaluación de varias sesiones y ejercicios repetidos no está demostrada. No hay cálculo explícito de diferencia antes/después en la CLI: imprime el resultado JSON.

### H6 — P1: las métricas no siempre representan hechos verificados

[tools.ts](../packages/agent-lab/src/tools.ts), líneas 34–35, 60–67 y 88–102.

`calculateRecords` incluye series no completadas. Añadir una serie ficticia de 1000 kg × 10 con `completed: false` la convierte en récord de carga y e1RM. El conteo de series y las tendencias también incluyen series incompletas.

Las tendencias ordenan exposiciones por la posición del ejercicio dentro de la sesión, no por fecha. Reproducción: sesión antigua con 50 kg en posición 1, seguida de sesión nueva con 100 kg en posición 0; informa `declining`, con 100 como peso previo y 50 como reciente. Además, suma kg y repeticiones para determinar dirección, sin un criterio documentado para cambios compensados. Estos resultados alimentan la decisión de mantener o progresar.

Pendiente: separar series realizadas, preservar cronología y ocurrencias y definir métricas verificables que no impongan una recomendación deportiva.

### H7 — P2: límites, reanudación y trazabilidad son preparatorios

[orchestrator.ts](../packages/agent-lab/src/orchestrator.ts), líneas 6 y 47–69; [evaluation.ts](../packages/agent-lab/src/evaluation.ts), línea 75; [cli.ts](../packages/agent-lab/src/cli.ts).

Con `maxCalls: 1`, una propuesta reporta `calls: 2`. La estimación de tokens excluye historial, catálogo, corpus y otros elementos del contexto completo; se comprueba después de decidir. `timeoutMs` no se consume y no hay cancelación ni manejo de 429 en el laboratorio.

El checkpoint se crea al final como parte del JSON; no se persiste ni se carga para reanudar. Sus IDs tampoco coinciden: `scenarioIds[0]` es `case-01-satisfactory`, mientras `completedScenarioIds[0]` es `event-case-1-satisfactory`. `uncertainCalls` cuenta decisiones `unavailable`, no intentos de proveedor con consumo incierto. Los runs no fijan la huella del corpus ni la de los escenarios/configuración completa. Repetir un evento vuelve a ejecutar las funciones; no existe el registro de deduplicación que promete el caso 24.

No se observó gasto real: todos estos contadores son simulados. Deben completarse antes de habilitar un proveedor y no documentarse como protección operativa ya disponible.

### H8 — P2: la documentación atribuye garantías que el código no cumple

[ADAPTACION-ENTRENAMIENTO.md](ADAPTACION-ENTRENAMIENTO.md), líneas 163–214; [ARQUITECTURA.md](ARQUITECTURA.md), líneas 263–281; [packages/agent-lab/README.md](../packages/agent-lab/README.md).

La documentación acierta al declarar datos ficticios, cero aplicación, corpus vacío, ausencia de evaluación real y técnica sin videos personales. Sin embargo, presenta como capacidades del laboratorio la validación de restricciones/citas, conservación de objetivos por serie, decisiones de IA, escenarios congelados, rúbrica de calidad e idempotencia que H1–H7 no confirman. Las referencias de prueba de la matriz no comprueban los ejemplos que acompañan: por ejemplo, A24 no repite un evento y A13 no prueba RIR ausente.

Quedan referencias desactualizadas: [ARQUITECTURA.md](ARQUITECTURA.md), línea 7, anuncia esquema Dexie v6, y sus filas de colas omiten v7; [DESPLIEGUE.md](DESPLIEGUE.md), línea 79, llama «actuales» a 75 unitarias/27 del Worker. El checkout ejecutado tiene esquema Dexie v7, backup v7, migraciones locales 0001–0008 y 102/34 pruebas. Dexie 4 en `package.json`/CLAUDE es la versión de la biblioteca, no un error de esquema.

Las 96 pruebas de la revisión fechada en agosto son una cifra histórica válida si se conservan como tal. No deben reemplazarse retroactivamente; hace falta enlazar un estado actual fechado. Despliegue sigue describiendo la activación posterior de Flash/Pro del coach heredado, sin un procedimiento explícito de cierre del laboratorio original con Pro apagado. Ambos recorridos deben distinguirse.

## Reproducciones mínimas

Desde la raíz del repositorio, ejecutar este bloque JavaScript mediante `node --experimental-strip-types --input-type=module` (en PowerShell, se puede pasar como here-string por stdin). No lee datos personales ni llama a servicios:

```js
import { runLab } from './packages/agent-lab/src/orchestrator.ts';
import { developmentScenarios, acceptanceScenarios, safetyScenarios, emptyLabCorpus }
  from './packages/agent-lab/src/scenarios.ts';
import { evaluateRagQueries } from './packages/agent-lab/src/evaluation.ts';
import { searchEvidence } from './packages/agent-lab/src/tools.ts';

const input = structuredClone(developmentScenarios[0].input);
input.restrictions.excludedExercises = ['squat'];
console.log('Exclusión ignorada:', runLab(input, emptyLabCorpus).decision);
console.log('Solapamiento:', developmentScenarios.filter(d =>
  acceptanceScenarios.some(a => JSON.stringify(a.input) === JSON.stringify(d.input))).length);
console.log('Inputs de seguridad distintos:', new Set(safetyScenarios.map(s => JSON.stringify(s.input))).size);
const corpus = {
  version: 'audit', status: 'proposal',
  sources: [{ id: 's', author: 'ficticio', title: 'ficticio',
    url: 'https://example.com', license: 'pending', approved: false }],
  chunks: [{ id: 'c', sourceId: 's', text: 'carga', location: 'ficticia' }],
};
const queries = Array.from({ length: 50 }, (_, i) => ({
  id: `q${i}`, text: 'carga', relevantChunkIds: ['c'], hardNegativeChunkIds: [],
}));
console.log('Gate con fuente no aprobada:', evaluateRagQueries(queries, corpus));
console.log('Recuperación real:', searchEvidence(corpus, 'carga'));
```

Resultado reproducido: propuesta del ejercicio excluido; solapamiento 14; un solo input de seguridad; gate RAG aprobado con fuente no aprobada; recuperación real vacía.

## Condiciones pendientes para cerrar esta fase

1. Corregir integridad, restricciones, objetivos por serie, métricas y validez de ambos evaluadores.
2. Crear y congelar 28 escenarios de aceptación independientes de los 14 de desarrollo, con cobertura funcional real; conservar los casos posteriores como especificación futura. Ejecutar aclaraciones y diez consultas de seguridad/no respuesta.
3. Entregar el corpus aprobado y sus fragmentos trazables, etiquetas de 50 consultas, claims y vectores Nemotron locales; evaluar 512/1024 conforme al umbral acordado.
4. Completar Training/Research con decisiones del modelo, herramientas, validación, instrucciones/versiones reproducibles, límites, cancelación, reanudación y contabilidad conservadora.
5. Tras comprobar acceso y presupuesto sin gasto adicional, ejecutar tres repeticiones reales, revisar todas las afirmaciones nuevas, registrar variabilidad y fallos y aplicar los umbrales del plan. Si no se puede garantizar el presupuesto, conservar ese bloqueo explícito y no afirmar cierre.
6. Publicar un informe de aceptación ligado a las versiones exactas y actualizar las referencias funcionales. La posterior integración de cuentas, consentimiento global, sincronización, permisos, aplicación atómica, reversión y dispositivos sigue fuera de esta entrega; no constituye autorización para abrir la beta.
