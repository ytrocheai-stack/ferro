# Laboratorio del agente original

Este paquete implementa la primera entrega de laboratorio del coach de NextRep. Es deliberadamente
offline y no conoce IndexedDB, la PWA, D1, Vectorize ni secretos de proveedores.

## Artefactos versionados

- `agent-lab-v1`: contratos y orquestación.
- `instructions-v1`: respuestas en español, observaciones separadas de estimaciones y evidencia.
- `tools-v1`: lectura de historial/objetivos/restricciones/catálogo y métricas puras.
- `model-config-v1`: Flash como proveedor previsto, Pro y reranking apagados, límites locales.
- `worker/corpus/manifest.json`: corpus editorial propuesto, sin fuentes aprobadas ni chunks.
- `worker/corpus/evaluation-queries.json`: universo congelado de 50 consultas.
- `scenarios.ts`: 14 escenarios de desarrollo, 28 de aceptación y 10 de seguridad/no-respuesta.

## Ejecución

```bash
npm run agent:lab
npm run agent:evaluate
npm run agent:rag
```

El informe conserva estimaciones de tokens, llamadas y un checkpoint lógico. Una ejecución
simulada siempre lleva `qualityEvidence: false`; no debe usarse para declarar calidad real ni para
activar una beta. Los escenarios de aceptación no se pasan al agente como expectativas.

La ejecución con `--provider --authorization` exige una autorización fresca, coste adicional cero,
presupuesto total y un revisor identificado. Las respuestas confirmadas se guardan en un ledger
durable dentro de `--checkpoint/provider-cache`; una entrada pendiente se detiene para conciliación
y nunca se reintenta automáticamente. La revisión independiente debe aportar una entrada por cada
respuesta y continuación, con `repetition`, `decisionFingerprint`, `generatorId` igual al proveedor,
`reviewer` distinto del generador, notas y todos los indicadores de respaldo/aplicabilidad.
