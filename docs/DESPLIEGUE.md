# Despliegue de NextRep

> Estado revisado: 2026-08-28. GitHub Pages tiene un workflow probado desde `main`, pero el código
> local actual no está publicado: `origin/main` sigue en `55fd4b6`, el checkout está un commit por
> delante y conserva cambios sin confirmar. El Worker adaptativo tampoco está listo para producción:
> usa `ENVIRONMENT="development"`, todos los providers están apagados y el binding D1 conserva
> `REPLACE_WITH_USER_AUTHORIZED_DATABASE_ID`.

## GitHub Pages (PWA)

- **Repositorio**: `github.com/ytrocheai-stack/ferro`
- **URL**: `https://ytrocheai-stack.github.io/ferro/`
- **Ruta pública**: `/ferro/` (forma parte del contrato de la PWA y de sus enlaces internos)

El workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) se ejecuta en cada push
a `main` o manualmente desde Actions. Instala con `npm ci`, regenera los datasets fijados, compila y
despliega mediante GitHub Pages Actions. Durante el build lee dos variables públicas del repositorio:

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_ADAPTATION_WORKER_URL`

El código local no permite comprobar si esas variables ya existen en GitHub. Si faltan, la PWA
sigue compilando sin el coach autenticado; no debe activarse la beta en ese estado.

La mecánica de Pages quedó verificada en la ejecución exitosa
[`31324703110`](https://github.com/ytrocheai-stack/ferro/actions/runs/31324703110) del 2026-08-09.
Esa ejecución es anterior a Clerk, al Worker y a la inyección de variables añadida localmente, por
lo que no demuestra que la beta actual se pueda desplegar.

## Worker adaptativo

El agente está en desarrollo y los proveedores están desactivados por defecto. La beta no se considera habilitada hasta superar el gate de RAG y las pruebas de auth, cuota, privacidad e idempotencia.

El Worker vive en `worker/` y se despliega independientemente de GitHub Pages. No ejecutar
`wrangler deploy` ni crear recursos hasta contar con cuenta, IDs y autorización explícita. Las
migraciones D1 están en `worker/migrations/` y deben aplicarse en orden (`0001`, `0002`, `0003`).

### Estado de bindings y configuración

| Elemento | Estado en el repositorio | Acción requerida |
|---|---|---|
| D1 `DB` | nombre definido, ID de ejemplo | crear base, reemplazar ID y aplicar migraciones |
| Vectorize 768 | binding/nombre definidos | crear índice de 768 dimensiones con métrica acordada |
| Vectorize 1024 | binding de evaluación definido | crear solo durante evaluación 768 vs 1024 |
| Cron | `17 3 * * *` definido | verificar que quede activo en el entorno desplegado |
| Providers | todos en `false` | mantener así hasta superar los gates |
| Entorno | `development` | cambiar a `production` únicamente al cerrar configuración |
| Corpus | tablas D1, adaptador e importador base | falta corpus autorizado, herramienta operable e indexación |

Secretos del Worker: `CLERK_JWT_KEY`, `PSEUDONYMIZATION_KEY` y `NVIDIA_API_KEY`. Variables privadas
de producción: `ALLOWED_CLERK_IDS`, `CLERK_AUTHORIZED_PARTIES` y `ALLOWED_ORIGINS`. Cárgalas en el
entorno de Cloudflare, nunca en `.env.local` de Vite ni en una variable `VITE_*`. El origen permitido
debe ser exactamente `https://ytrocheai-stack.github.io`; la ruta `/ferro/` no forma parte del
origen CORS.

### Orden manual para preparar la beta

1. Configurar Clerk y comprobar un JWT real con las `authorizedParties` correctas.
2. Crear D1 e índices Vectorize; reemplazar el marcador del TOML y aplicar las tres migraciones.
3. Cargar secretos/allowlist/origen, conservar providers apagados y desplegar un entorno de prueba.
4. Probar `/health`, CORS, auth, cuota, idempotencia y retención usando datos ficticios.
5. Completar el pipeline/evaluación del corpus descrito en
   [ADAPTACION-ENTRENAMIENTO.md](ADAPTACION-ENTRENAMIENTO.md).
6. Activar primero embeddings, luego Flash y finalmente Pro, un flag por vez. Reranking permanece
   apagado hasta demostrar una mejora medible.
7. Solo entonces configurar las dos variables públicas en GitHub y reconstruir la PWA.

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
