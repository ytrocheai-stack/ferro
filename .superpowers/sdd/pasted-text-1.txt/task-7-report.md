# Informe T7 — Streaming del proveedor y extracción segura de texto

## Alcance

Se implementó streaming SSE opcional para el Coach sin cambiar el modelo activo (`moonshotai/kimi-k3`), el proveedor, el endpoint ni el protocolo durable de herramientas. El streaming queda protegido por `ENABLE_COACH_STREAMING`, cuyo valor efectivo es apagado salvo que sea exactamente `true`; no se añadió ninguna activación a los entornos existentes.

## Cambios

- `packages/adaptation-core/src/streaming.ts`
  - Parser SSE tolerante a líneas y eventos fragmentados.
  - Reensamblado de JSON parcial con escapes y contenido Unicode.
  - Ignora herramientas completas previas y contenido inválido; no publica fragmentos parciales.
  - Valida la respuesta final contra `agentWireResponseSchema` y sólo acepta `type=decision`.
  - Publica exclusivamente `decision.explanation`, después de la validación completa.
  - Detecta ausencia de decisión, truncamiento y `finish_reason=length`.
- `packages/corpus-pipeline/src/generation.ts`
  - Añadida la capacidad declarativa `generationCapabilities(model)`, habilitada sólo para los modelos Coach existentes.
- `worker/src/index.ts`
  - Añadida capacidad opcional `GenerationProvider.generateStream`.
  - `NvidiaGenerationProvider.generateStream` consume SSE con `ReadableStream`, conserva el resultado JSON completo y no hace una segunda llamada.
  - La ejecución durable usa streaming sólo cuando la bandera está explícita, el modelo tiene capacidad y el proveedor la expone; de lo contrario usa `generate()` sin cambios.
  - Errores de streaming siguen el camino recuperable existente y no confirman una decisión parcial.
- Pruebas reales de parser, transporte SSE fragmentado, tool-before-decision, truncamiento, Unicode, JSON y flag apagada.

## Compatibilidad y seguridad

- Se conservan el modelo, proveedor, endpoint, presupuesto, workflow durable y protocolo JSON actual.
- No se emite JSON de herramientas, argumentos ni contenido de decisiones parciales mediante el callback de explicación.
- La respuesta completa sigue siendo la unidad persistida y validada por el protocolo actual.
- No se realizaron despliegues ni se modificaron variables de entorno existentes.

## Verificación

- `npm exec vitest run packages/adaptation-core/src/streaming.test.ts packages/adaptation-core/src/agent.test.ts worker/src/generation.kimi.test.ts worker/src/index.test.ts --config worker/vitest.config.ts` — 4 archivos, 42 pruebas: OK.
- `npm run typecheck` — OK.
- `npm run typecheck:worker` — OK.
- `npm run lint` — OK.
- `git diff --check` — OK.

## Preocupaciones pendientes

- El flag permanece apagado y el streaming remoto no se ha probado contra tráfico real del proveedor; la prueba usa un cuerpo SSE fragmentado local.
- El callback seguro se ejecuta después de validar el JSON final. Esto prioriza la garantía de no publicar decisiones parciales; la integración actual sigue necesitando la respuesta completa para el protocolo durable.
- La telemetría conserva el conteo de uso existente; no se introdujo gasto adicional ni una ruta de reintento.
