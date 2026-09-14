# Informe de T0 — restricciones y estado del proveedor

Fecha: 2026-09-14

## Alcance

T0 fija el estado documental para impedir una migración ficticia o gasto no
autorizado. No cambia el modelo activo ni implementa una migración.

## Hechos verificados

- El código del Worker usa NVIDIA como proveedor configurado.
- `worker/wrangler.toml` declara `moonshotai/kimi-k3` para desarrollo y mantiene
  las flags de proveedor apagadas.
- `worker/wrangler.production.toml` declara
  `deepseek-ai/deepseek-v4-flash-0731` para producción; Pro, reranking y provider
  probe están apagados.
- `gpt-5.6-luna` existe como modelo documentado para la API de Codex.
- La ejecución de T0 puede usar Luna como agente dentro de Codex sin convertirlo
  en el modelo de la aplicación.
- No se modificaron secretos, credenciales, modelos activos ni configuración del
  proveedor. Los cambios de este commit son únicamente documentales.

## Inferencias y límites

- Que Luna esté disponible para el agente de Codex no demuestra acceso de la PWA
  a Luna.
- No está verificado un acceso desde esta PWA usando la suscripción del usuario
  sin nuevas credenciales ni facturación de API; por eso no se afirma una
  migración ni se recomienda activar Luna.
- Las referencias históricas de despliegue no sustituyen una comprobación del
  estado remoto del checkout actual.

## Comprobaciones realizadas

- Se inspeccionó `git status` y el diff antes de editar.
- Se inventariaron referencias locales a proveedores, modelos, flags, Clerk y
  secretos con búsqueda de texto; no se llamaron APIs de pago ni endpoints
  privados.
- Se revisó el diff final para confirmar que solo incluye los documentos de T0.

## Pendiente

- Verificar, con autorización y sin coste adicional, cualquier acceso real que se
  quiera evaluar desde la PWA.
- Si se propone una migración futura, definir primero credenciales, presupuesto,
  pruebas, rollback y autorización explícita; hasta entonces conservar los modelos
  y flags actuales.
- No se probaron acceso remoto, despliegue, Clerk real ni teclado Android real.

## Round 1 — corrección del revisor

- Fix: se actualizó el enlace T0 de `docs/DESPLIEGUE.md` para apuntar al archivo
  real `MIGRACION-NEXTREP-T0-2026-09-09.md`.
- Comprobación de diff: `git diff --check` — salida vacía; código de salida 0.
- Comprobación enfocada: `rg -n 'MIGRACION-NEXTREP-T0-2026' docs/DESPLIEGUE.md worker/README.md`
  — `docs/DESPLIEGUE.md:15` y `worker/README.md:17` apuntan a
  `MIGRACION-NEXTREP-T0-2026-09-09.md`.
- Inventario documental/modelos: `rg -n -i '(gpt-5\\.6-luna|moonshotai/kimi-k3|deepseek-ai/deepseek-v4-flash-0731|NVIDIA|ENABLE_FLASH|ENABLE_PRO|ENABLE_RERANKING|ENABLE_PROVIDER_PROBE|CLERK)' docs/DESPLIEGUE.md worker/README.md docs/MIGRACION-NEXTREP-T0-2026-09-09.md worker/wrangler.toml worker/wrangler.production.toml` — referencias encontradas únicamente en los documentos/configuraciones esperados; código de salida 0.
