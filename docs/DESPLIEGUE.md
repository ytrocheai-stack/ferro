# Despliegue de NextRep

> Estado revisado: 2026-08-30. El código actual está publicado en `main` (`86115ed`) y GitHub Pages
> completó correctamente el workflow [`33299809907`](https://github.com/ytrocheai-stack/ferro/actions/runs/33299809907).
> El Worker adaptativo también está desplegado y responde en producción. La infraestructura y la
> autenticación están preparadas para smoke tests, pero la beta IA sigue cerrada: el corpus real no
> está indexado y los providers NVIDIA permanecen apagados.

## GitHub Pages (PWA)

- **Repositorio**: `github.com/ytrocheai-stack/ferro`
- **URL**: `https://ytrocheai-stack.github.io/ferro/`
- **Ruta pública**: `/ferro/` (forma parte del contrato de la PWA y de sus enlaces internos)

El workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) se ejecuta en cada push
a `main` o manualmente desde Actions. Instala con `npm ci`, regenera los datasets fijados, compila y
despliega mediante GitHub Pages Actions. Durante el build lee dos variables públicas del repositorio:

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_ADAPTATION_WORKER_URL`

Las dos variables están configuradas en GitHub y la PWA pública responde correctamente. La aplicación
publicada carga el Worker y la clave pública de Clerk; el bundle público no contiene nombres de secretos
ni claves NVIDIA.

La URL pública vigente es `https://ytrocheai-stack.github.io/ferro/`. Se comprobaron con HTTP 200 la
PWA, el manifest, el service worker y `data/exercises.json`. Clerk muestra el flujo de inicio de sesión
en la aplicación publicada.

## Worker adaptativo

El agente está desplegado, pero los proveedores están desactivados por defecto. La beta no se considera
habilitada hasta superar el gate de RAG y las pruebas de auth, cuota, privacidad e idempotencia.

El Worker vive en `worker/` y se despliega independientemente de GitHub Pages. Las migraciones D1 están
en `worker/migrations/` y ya no hay migraciones pendientes en la base remota.

### Estado de bindings y configuración

| Elemento | Estado en el repositorio | Acción requerida |
|---|---|---|
| D1 `DB` | creado; cinco tablas operativas de adaptación; migraciones aplicadas | usarlo para smoke de cuota, idempotencia, retención y corpus |
| Vectorize 768 | creado, 768 dimensiones, métrica cosine | no indexar hasta tener corpus autorizado y reporte de calidad |
| Vectorize 1024 | creado como índice de evaluación, 1024 dimensiones | usarlo solo para comparar 768 vs 1024 |
| Cron | `17 3 * * *` definido en el Worker | verificar una ejecución real de retención antes de la beta |
| Providers | todos en `false` | mantener así hasta superar los gates |
| Entorno | `production` en el despliegue activo; `development` en el TOML local | alinear el TOML antes del siguiente redeploy para evitar drift |
| Corpus | tablas D1, adaptador e importador base | falta corpus autorizado, herramienta operable e indexación |

Los nombres de secretos del Worker están configurados en Cloudflare: `CLERK_JWT_KEY`,
`PSEUDONYMIZATION_KEY` y `NVIDIA_API_KEY`. Las variables privadas de producción incluyen
`ALLOWED_CLERK_IDS`, `CLERK_AUTHORIZED_PARTIES` y `ALLOWED_ORIGINS`. Nunca cargues sus valores en
`.env.local` de Vite ni en una variable `VITE_*`. El origen permitido debe ser exactamente
`https://ytrocheai-stack.github.io`; la ruta `/ferro/` no forma parte del origen CORS.

El smoke remoto actual confirma `GET /health` con HTTP 200 y `POST /v1/adaptations/analyze` sin token
con HTTP 401 (`Falta el token`). Esto demuestra que el Worker está vivo y que el gate de producción
llega a la validación JWT; todavía falta completar una llamada autenticada con un usuario beta real.

### Orden manual para preparar la beta

1. Completar el smoke autenticado de Clerk con un usuario beta real y los IDs exactos de la allowlist.
2. Probar `/health`, CORS, auth, cuota, idempotencia y retención usando datos ficticios; comprobar también
   una ejecución del Cron.
3. Proporcionar el corpus autorizado y completar el pipeline/evaluación descrito en
   [ADAPTACION-ENTRENAMIENTO.md](ADAPTACION-ENTRENAMIENTO.md).
4. Activar primero embeddings, luego Flash y finalmente Pro, un flag por vez. Reranking permanece
   apagado hasta demostrar una mejora medible.
5. Ejecutar el E2E del coach con Clerk, activar menos de seis usuarios adultos sanos uno por uno y
   observar aceptación, ediciones, `stale`, errores, cuota y rollback.

No se guardan payloads de entrenamiento, feedback ni resúmenes en D1, logs o telemetría. D1 sí
almacena cuota/idempotencia seudonimizada, telemetría operativa y el corpus RAG aprobado.

## Publicar una versión

```bash
npm run check
git add -A
git commit -m "feat: siguiente versión"
git push origin main
```

Para una prueba local usa `npm run build` y `npm run preview`; la URL de preview incluye `/ferro/`. Después de un deploy, abre la URL en una ventana privada y comprueba que cargan `/ferro/`, `/ferro/data/exercises.json`, el manifest y el service worker.

## Operación y rollback

GitHub Pages conserva los artefactos de Actions. Para revertir, revierte el commit de `main` y vuelve a publicar; no borres la base IndexedDB del usuario. Si cambia el formato de datos, añade una versión Dexie aditiva y una nota de migración antes del release.

El Worker expone `GET /health` sin auth y `POST /v1/providers/probe` solo cuando el flag de probe
está habilitado. `/health` comprueba disponibilidad básica, no readiness de D1/Vectorize/NVIDIA. Un
fallo de Flash, timeout, 429 o circuito abierto devuelve el fallback determinista; Pro no se debe
usar como sustituto por indisponibilidad. La escalación por JSON inválido aún está pendiente de
cerrar en el flujo real y se mantiene documentada como gate, no como capacidad terminada.
