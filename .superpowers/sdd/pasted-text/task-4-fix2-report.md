# Task 4 — Informe de corrección 2

## Estado

`DONE`

Se corrigieron los hallazgos restantes S2, S3, S4 y Q1 sin modificar la PWA ni
el endpoint analítico determinista.

## Cambios

- El transporte streaming de NVIDIA comparte el parser de error HTTP con el
  camino no-streaming: conserva `Retry-After`, lo expone en `ProviderError` y
  ejecuta el defer durable del gate ante 429.
- La estimación Gemini recibe el request JSON serializado completo y combina
  bytes UTF-8, escalares Unicode y un margen fijo documentado de 64 tokens.
  No usa `countTokens` ni convierte tokens en saldo NVIDIA.
- El éxito durable sin lease sólo limpia un circuito cerrado; con el circuito
  abierto exige el `half_open_lease_id` coincidente. Se cubre el resultado
  tardío sin lease.
- La reconciliación Gemini usa `D1.batch` para insertar/recuperar el marcador,
  aplicar contadores y marcar `state_applied` en una operación atómica. La
  migración aditiva 0018 deja pendientes los marcadores históricos inciertos;
  un batch incompatible deja estado recuperable y no marca completado.

## Verificación

- `npm --prefix worker run typecheck` — OK.
- `npm --prefix worker test` — OK: 9 archivos, 111 pruebas.
- `npx eslint worker/src/index.ts worker/src/providers worker/src/generation.kimi.test.ts` — OK.
- `git diff --check` — OK; sólo avisos de normalización LF/CRLF de Git.

## Commit

Mensaje exacto: `fix(worker): make provider accounting crash safe`

## Preocupaciones

- No se probaron D1 remoto, Cloudflare Workflows ni proveedores reales; los
  tests usan SQLite en memoria y fetch simulado.
- Gemini sigue sin router/adaptador conectado al flujo de Coach; esta entrega
  corrige únicamente los contratos de contabilidad y transporte solicitados.
