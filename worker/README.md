# NextRep Adaptation Worker

> Estado 2026-08-28: implementación local en desarrollo. No hay recursos Cloudflare reales
> documentados, corpus indexado ni providers activados; `wrangler.toml` conserva un ID D1 de ejemplo.

Worker independiente para análisis de adaptación. No guarda payloads, sets, feedback, nombres ni resúmenes: D1 conserva únicamente seudónimo HMAC, identificadores, configuración, latencia/error y eventos de aceptación durante la retención operativa.

`/health` no autentica ni ejecuta proveedores. Las variables de modelos, flags, allowlist, `CLERK_JWT_KEY`, `PSEUDONYMIZATION_KEY` y `NVIDIA_API_KEY` se configuran como bindings/secrets de Wrangler; nunca se incluyen en Vite ni en el bundle de la PWA. En `ENVIRONMENT=production`, D1, allowlist, authorized parties y la clave de seudonimización son obligatorios.

La cuota es de diez análisis por semana y la idempotencia almacena solo el HMAC del request, estado y `analysisId`. Un replay devuelve candidatos deterministas sin consumir cuota ni invocar NVIDIA; una clave con payload distinto devuelve `409`. El Cron diario elimina telemetría después de 30 días.

`src/rag.ts` contiene la función base para importar un corpus aprobado: cada pasaje se vectoriza con
`input_type: "passage"`, se guardan texto/metadatos/licencia en D1 y se derivan prefijos normalizados
de 768 y 1024 dimensiones. Las consultas usan `input_type: "query"`; Vectorize recupera 20 y la
selección limita a ocho y dos por fuente.

Esto todavía no es un pipeline de ingestión operable: falta CLI/job, lotes de máximo 1.000 vectores,
validación de metadata ≤10 KiB, reanudación y corpus real. `src/evaluation.ts` y sus pruebas usan
fixtures sintéticos y no validan calidad de recuperación del dominio. No activar embeddings/RAG
hasta generar un reporte con el corpus aprobado.

Antes de desplegar se requieren cuenta Cloudflare, IDs de D1/Vectorize, configuración Clerk,
allowlist y autorización explícita. El orden y los gates están en
[`../docs/DESPLIEGUE.md`](../docs/DESPLIEGUE.md) y
[`../docs/ADAPTACION-ENTRENAMIENTO.md`](../docs/ADAPTACION-ENTRENAMIENTO.md).
