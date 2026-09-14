# Informe T7 — Streaming del proveedor y extracción segura de texto (round 1)

## Alcance

Se corrigió la primera ronda de revisión del streaming SSE opcional del Coach sin cambiar el modelo activo (`moonshotai/kimi-k3`), el proveedor, el endpoint ni el protocolo durable de herramientas. `ENABLE_COACH_STREAMING` sigue apagado salvo que sea exactamente `true`; no se añadió ninguna activación a los entornos existentes.

## Cambios

- `packages/adaptation-core/src/streaming.ts`
  - Parser SSE tolerante a líneas y eventos fragmentados.
  - Reensamblado de JSON parcial con escapes partidos y contenido Unicode.
  - Un turno `type=tool` se conserva y se transporta intacto al protocolo real; no se convierte en error por falta de decisión y permite el siguiente turno de `runAgentProtocol`.
  - Valida cada mensaje completo contra `agentWireResponseSchema`; sólo una decisión final puede producir explicación.
  - El callback no se ejecuta durante `push`: se ejecuta en `finish`, después de la validación completa.
  - Extrae usage entero y no negativo de eventos SSE finales; si no existe, el proveedor devuelve `usage: {}` explícito para que el Worker use sus estimaciones existentes.
  - Detecta ausencia de respuesta válida, JSON inválido, truncamiento y `finish_reason=length`.
- `packages/corpus-pipeline/src/generation.ts`
  - Añadida la capacidad declarativa `generationCapabilities(model)`, habilitada sólo para los modelos Coach existentes.
- `worker/src/index.ts`
  - Añadida capacidad opcional `GenerationProvider.generateStream`.
  - `NvidiaGenerationProvider.generateStream` consume SSE con `ReadableStream`, conserva el resultado JSON completo, extrae usage y no hace una segunda llamada.
  - La cancelación aborta también `reader.read()` mediante `reader.cancel()`.
  - La ejecución durable usa streaming sólo cuando la bandera está explícita, el modelo tiene capacidad y el proveedor la expone; de lo contrario usa `generate()` sin cambios.
  - El callback interno guarda únicamente la explicación validada; el hook observable opcional `onCoachExplanation` se invoca sólo después de persistir el run como `completed`. Una explicación o decisión parcial no es aplicable.
  - Errores de streaming siguen el camino recuperable existente y no confirman una decisión parcial.
- Pruebas reales de parser, transporte SSE fragmentado, tool-only seguido de segundo turno, escapes partidos, truncamiento/JSON inválido, callback diferido, usage, cancelación del reader, integración durable y flag apagada.

## Compatibilidad y seguridad

- Se conservan el modelo, proveedor, endpoint, presupuesto, workflow durable y protocolo JSON actual.
- El callback observable nunca emite JSON de herramientas, argumentos ni contenido de decisiones parciales.
- La respuesta completa sigue siendo la unidad persistida y validada por el protocolo actual.
- Las herramientas conservan el protocolo real: el Worker entrega el `type=tool` a `runAgentProtocol`, ejecuta la herramienta y sólo después genera el siguiente turno.
- No se realizaron despliegues ni se modificaron variables de entorno existentes.

## Verificación

- `npm exec vitest run packages/adaptation-core/src/streaming.test.ts packages/adaptation-core/src/agent.test.ts worker/src/generation.kimi.test.ts worker/src/coach.durable.test.ts worker/src/index.test.ts --config worker/vitest.config.ts` — 5 archivos, 55 pruebas: OK.
- `npm run typecheck` — OK.
- `npm run typecheck:worker` — OK.
- `npm run lint` — OK.
- `git diff --check` — OK.

## Preocupaciones pendientes

- El flag permanece apagado y el streaming remoto no se ha probado contra tráfico real del proveedor: las pruebas usan `ReadableStream`, SSE y SQLite locales, sin claves ni red del proveedor.
- La publicación observable está representada por el hook opcional `onCoachExplanation`; no se añadió una ruta HTTP de eventos ni UI nueva. El hook se ejecuta tras la escritura durable `completed` y sus errores no alteran ese estado.
- El usage depende de que el proveedor incluya el evento final; cuando falta, se conserva el fallback explícito a las estimaciones/presupuesto existentes. No se introdujo gasto adicional ni una ruta de reintento.
