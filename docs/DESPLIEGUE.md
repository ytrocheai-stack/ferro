# Despliegue de NextRep

> Estado verificado el 2026-09-23: beta **cerrada** (`ENABLE_BETA=false`). Pages sirve
> `fdb936abdc91167e9194f61c9a7361ee7c29e6a8` (merge de PR #6) y el Worker desplegado es
> `e7291b36-1511-4adc-8cf4-e28a81bf3ce1`. La [bitácora del release](RELEASE-2026-09-23.md)
> registra las fuentes de verificación y conserva como historia la prueba previa de GLM.

## Coach privado — estado publicado

La generación está configurada únicamente con Gemini `gemini-3.5-flash-lite`. NVIDIA se usa
solo para embeddings de consultas RAG; no es respaldo de generación. La allowlist de Clerk
contiene únicamente la cuenta de Yehoshua (`user_3ITDXf8hPt81kAjzS3Dw8U77qfE`). El consentimiento
requerido es `coach-context-v4-gemini-nvidia-embeddings`. En producción, `ENABLE_GEMINI=true`
y `ENABLE_EMBEDDINGS=true`, mientras `ENABLE_NVIDIA=false`, `ENABLE_FLASH=false` y
`ENABLE_BETA=false`; por ello no se ofrece generación del coach a usuarios.

Siguen pendientes los gates formales de benchmark/laboratorio y el canario real de una cuenta
con esta configuración y consentimiento. Las pruebas locales o los canarios de versiones
anteriores no los sustituyen. No abrir la beta ni cambiar sus flags hasta documentar esos gates.

No se usa Luna desde la PWA. Esta guía no autoriza despliegues ni llamadas reales por sí sola;
las cuotas y claves efectivas se comprueban en el entorno remoto antes de cada activación.

La ejecución de este paso puede usar Luna como agente dentro de Codex; eso no es
evidencia de que la PWA tenga acceso a Luna. Las comprobaciones de T0 son locales y
documentales: no implican acceso remoto, despliegue, Clerk real ni teclado Android
real. Ver el informe [T0](MIGRACION-NEXTREP-T0-2026-09-09.md).

Las pruebas E2E del Coach usan un Worker simulado y una sesión local: demuestran contratos,
persistencia y accesibilidad de la PWA, pero no prueban Clerk real, llamadas a Gemini/NVIDIA,
CORS/JWT remotos ni el comportamiento de un teclado físico Android.

> Hito anterior: el release verificado 2026-09-14 publicó `668189b37f42792a115fc074f270fd0a4c9c5bac`
> y el Worker `fa2d6eed-654b-48a6-8d07-4fae20332f6f`. El estado publicado vigente es el del
> encabezado y la [bitácora del 2026-09-23](RELEASE-2026-09-23.md).

> Revisión histórica: 2026-09-08Z. El estado local se verificó con build y `wrangler deploy --dry-run`.
> El estado publicado vigente está documentado en el release verificado anterior.
> Hay bloqueos reproducidos en la [auditoría del plan](AUDITORIA-COACH-2026-08-30.md).

## GitHub Pages

- Repositorio: [ytrocheai-stack/ferro](https://github.com/ytrocheai-stack/ferro).
- PWA: [https://ytrocheai-stack.github.io/ferro/](https://ytrocheai-stack.github.io/ferro/).
- Ruta pública: `/ferro/`; forma parte del contrato de compatibilidad.
- Workflow: [deploy.yml](../.github/workflows/deploy.yml), en push a `main` o ejecución manual.

El workflow instala con `npm ci`, regenera datasets fijados, ejecuta lint, tipos, las regresiones
PWA/Worker y el build, y publica el artefacto de Pages. Inyecta únicamente las variables públicas
`VITE_CLERK_PUBLISHABLE_KEY` y `VITE_ADAPTATION_WORKER_URL`. Los E2E completos siguen siendo una
verificación previa separada.

Los E2E generales son offline y no tienen sesión Clerk: [`playwright.config.ts`](../playwright.config.ts)
limpia esas dos variables únicamente en su `webServer`. Esto no relaja el build de publicación ni
el gate de autenticación cuando el coach está configurado.

El hash actual de Pages se confirma en `version.json`; el workflow 35828190992 terminó correctamente
para el merge fdb936a de PR #6. Antes de cada release, volver a comprobar el commit/artefacto exacto.

## Worker adaptativo

URL: [nextrep-adaptation.yehoshuatroche.workers.dev](https://nextrep-adaptation.yehoshuatroche.workers.dev/health).
El Worker vive en `worker/` y se publica por separado. No recrear sus recursos.

| Recurso/configuración | Declaración local | Verificación antes del despliegue |
|---|---|---|
| Worker | `nextrep-adaptation` en ambos TOML | Conservar nombre y bindings existentes |
| D1 | Binding `DB`, base `nextrep-adaptation` | La última verificación del 2026-09-23 reportó `0014`–`0018` aplicadas; comprobar el historial antes de cada cambio |
| Vectorize principal | `VECTORIZE` → `nextrep-adaptation-512` | Crear/verificar dimensión 512, corpus activo y namespace correcto |
| Vectorize legado | `VECTORIZE_LEGACY_768` → `nextrep-adaptation-768` | Conservarlo intacto para rollback/compatibilidad; no reutilizarlo para 512 |
| Vectorize evaluación | `VECTORIZE_EVAL_1024` → `nextrep-adaptation-eval-1024` | Solo evaluación comparativa autorizada |
| Cron | `17 3 * * *` | Comprobar retención real antes de abrir |
| Producción | `wrangler.production.toml`: `ENVIRONMENT=production` | Revisar configuración privada y gates |
| Desarrollo | `wrangler.toml`: `ENVIRONMENT=development` | No usar su deploy genérico para producción |
| Beta/proveedores | Producción mantiene `ENABLE_BETA=false`; Gemini es el único generador y NVIDIA solo presta embeddings de consultas. Allowlist: una cuenta. | Mantener cerrado hasta aprobar los gates y el canario real de esta versión |
| Corpus | `.cache/corpus/hevy`: 88 fuentes, 2.708 chunks, 47 autores recuperados | Ejecutar `corpus:embed`, `corpus:upload` y verificar ambos índices/D1 antes de seleccionar la versión |

Los dos TOML apuntan al mismo nombre de Worker y a los mismos recursos; el archivo de desarrollo
no crea un entorno aislado. `npm run deploy:worker` y `npm --prefix worker run deploy` usan el
TOML de desarrollo. Para producción, usar exclusivamente:

```bash
npm --prefix worker run deploy:production
```

Los dry-runs locales se ejecutaron el 2026-09-08Z con todos los flags apagados. No equivalen a
respaldo, migración ni publicación remotos; la PWA requiere integración/publicación exacta antes
del smoke desde Pages.

### Secretos y configuración privada

Mantener fuera del repositorio y del bundle los valores de `CLERK_JWT_KEY`,
`PSEUDONYMIZATION_KEY`, `GEMINI_API_KEY` y `NVIDIA_API_KEY`. Verificar además `ALLOWED_CLERK_IDS`,
`CLERK_AUTHORIZED_PARTIES` y `ALLOWED_ORIGINS` en la configuración de producción sin imprimir
sus valores en logs o artefactos. No usar variables `VITE_*` para datos privados.

Origen de Pages: `https://ytrocheai-stack.github.io`; `/ferro/` no forma parte del origen.
El contrato local requiere consentimiento `coach-context-v4-gemini-nvidia-embeddings` en payload/cabecera, dispositivo
coincidente e `Idempotency-Key`. El preflight ya permite `X-NextRep-Consent-Version` y
`X-NextRep-Device-Id`, además de las cabeceras anteriores; el Worker responde 401 desde el origen
permitido sin JWT y 403 desde un origen no autorizado. Falta verificarlo desde Pages con sesión y
confirmar el rechazo desde un origen no autorizado para este release.

Las migraciones locales son `0001`–`0018`; `0004` añade metadata de fuentes, `0005`
añade presupuesto/reservas de tokens y concurrencia, y `0006` persiste la respuesta de una
solicitud idempotente para replay exacto, `0009` añade procedencia/filtros del corpus, `0011` añade ejecuciones durables del coach, `0012` añade el ledger de intentos y `0013` vincula cada ejecución a una conversación privada. Dexie v7 añade el propietario `ownerId` para jobs,
eventos y propuestas locales; Dexie v8 añade runs y mensajes del agente y Dexie v9 añade perfil/consentimiento y programación. `0014`–`0016` añaden cuotas/presupuesto, leases y snapshots; `0017` añade failover/circuitos de Gemini/NVIDIA y `0018` reconcilia el uso de cuota Gemini. Su existencia en disco no
sustituye el historial remoto. La verificación remota del 2026-09-23 reportó `0014`–`0018` aplicadas;
comprobar el historial antes de cualquier cambio y no volver a aplicar ALTERs manualmente.

## Orden de publicación y pruebas

1. Verificar las correcciones por hallazgo del [informe](AUDITORIA-COACH-2026-08-30.md); mantener las
   regresiones de contrato, cancelación, aislamiento, idempotencia, presupuesto, aplicación e
   importación. Proveedores simulados.
2. Ejecutar `npm run check`, `npm run test:worker`, `npm run test:e2e` y `npm run test:e2e:coach`.
   Registrar los resultados actuales; las pruebas locales no son aprobación de beta.
3. Publicar **primero la PWA compatible**. Revisar los archivos que se incluirán en el commit;
   no añadir indiscriminadamente secretos, diagnósticos temporales ni otros cambios locales.
   El push a `main` desencadena Pages.
4. Comprobar el historial remoto de migraciones D1 antes de tocarlo y publicar **después el Worker**
   con la configuración explícita de producción. Mantener Gemini como único generador, NVIDIA solo
   para embeddings de consultas y la allowlist de una cuenta.
5. Verificar PWA, manifest, SW, datos públicos, `/health`, CORS y JWT/allowlist con datos
   ficticios. Completar un smoke autenticado y E2E del coach en un entorno de prueba controlado;
   abrir solo la cuenta canaria cuando se hayan aprobado los gates.
6. Con corpus autorizado e importador terminado, ejecutar primero `corpus:embed` en modo de prueba y
   después la operación real sólo con autorización fresca de NVIDIA y coste adicional cero. Cargar
   por lotes con `corpus:upload`, backup D1, comprobación de capacidad y rollback por versión.
7. Ejecutar `corpus:benchmark -- --run` con recuperación local y luego comparar 512/1024; registrar
   Recall@5, precisión de citas, revisión independiente y diferencias local/remoto.
8. Tras los gates, activar temporalmente beta y generación únicamente para la cuenta autorizada;
   completar y aprobar el smoke, apagar la activación temporal y solo entonces consolidar las flags.
   Pro, NVIDIA como generador, reranking, provider probe y streaming permanecen apagados.
   Si no se puede garantizar ausencia de gasto adicional, detener llamadas y mantener todas las flags apagadas.
9. Probar backup/actualización de la PWA instalada en teléfonos y todo el recorrido. Abrir la cuenta
   autorizada únicamente tras aprobación del responsable.

Los pasos técnicos son responsabilidad del desarrollo. El usuario completa login y MFA,
revisa fuentes/consentimiento, prueba su teléfono y autoriza la apertura.
No pedir contraseñas ni JWT.

## Salud, observabilidad y rollback

`GET /health` no autentica ni llama a modelos. Confirma disponibilidad básica y versión de
política. `GET /readiness` (también `/v1/readiness`) exige origen, JWT y allowlist; se mantiene sin
llamadas a modelos y prueba consultas D1, disponibilidad de Vectorize y coherencia del corpus
activo. También devuelve orden, nombres de modelos, flags, versión de consentimiento, estado
booleano de credenciales y cuotas configuradas, nunca claves ni valores secretos. Un resultado
positivo local no sustituye el canario sobre recursos remotos.

`POST /v1/providers/probe` exige autenticación, beta y su propio flag; solo informa flags/modelos.
No constituye un smoke de proveedores. El Cron depura telemetría tras 30 días, reservas caducadas
y presupuestos antiguos; su ejecución real sigue pendiente de verificación.

Para un rollback de código, revertir el commit de la PWA y publicar de nuevo; restaurar una versión
compatible del Worker y apagar `ENABLE_GEMINI`, `ENABLE_NVIDIA` y `ENABLE_BETA` (o cambiar el orden
de proveedores) sin borrar migraciones. Conservar los artefactos e identificadores de ambos despliegues.
No borrar IndexedDB ni revertir destructivamente migraciones.

El rollback del corpus exige conservar versiones/namespaces y poder seleccionar la anterior.
El importador coloca el namespace y un ID físico versionado en cada vector, guarda claves D1 versionadas y expone
`rollbackCorpusVersion`, que requiere un adaptador Vectorize con `delete(ids)` o un adaptador explícito
de namespace. No ejecutar ese borrado sin backup y verificación del índice remoto.

Para ver la PWA local: `npm run build` y `npm run preview`; la URL incluye `/ferro/`.
Después de publicar, comprobar la versión instalada y exportar backup antes de pruebas con datos
del dispositivo.
