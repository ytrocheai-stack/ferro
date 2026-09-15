# Despliegue de NextRep

## Beta privada — Gemini preferido y NVIDIA fallback

La configuración declarativa fija `gemini-3.6-flash` como proveedor preferido y
`deepseek-ai/deepseek-v4-flash-0731` como fallback NVIDIA. El orden es `gemini,nvidia`,
NVIDIA se coordina a 40 RPM, `ENABLE_COACH_STREAMING=false` y el consentimiento requerido
es `coach-context-v3-gemini-nvidia`. Desarrollo conserva los proveedores apagados.

No se usa Luna desde la PWA. Esta guía no autoriza despliegues ni llamadas reales por sí sola;
las claves y cuotas efectivas de Gemini siguen siendo requisitos remotos que deben verificarse
fuera del repositorio antes de activar el Worker.

La ejecución de este paso puede usar Luna como agente dentro de Codex; eso no es
evidencia de que la PWA tenga acceso a Luna. Las comprobaciones de T0 son locales y
documentales: no implican acceso remoto, despliegue, Clerk real ni teclado Android
real. Ver el informe [T0](MIGRACION-NEXTREP-T0-2026-09-09.md).

> Actualización Task 7: se prepara el coach privado sin ejecutar benchmarks ni evaluar la calidad
> del modelo. Producción declara Gemini/NVIDIA y la allowlist exacta de dos cuentas; Pro, reranking
> y probes siguen apagados. Las instrucciones
> anteriores sobre esperar benchmarks para esa activación quedan supersedidas por esta petición.
> El system prompt compartido vive en `packages/adaptation-core/src/agent.ts`
> (`coach-agent-instructions-v3`) y el Worker lo envía con rol `system`.
> Verificaciones locales: tipos, build, lint, pruebas de contrato/cliente/Worker y dos
> recorridos móviles simulados. No se hicieron llamadas al modelo en esta entrega.
> D1 remoto: las migraciones 0014–0018 y las cuotas de proveedores requieren verificación remota;
> su existencia local no demuestra que estén aplicadas.
> La evaluación de recomendaciones queda pendiente; no se afirma calidad clínica o deportiva.

Las pruebas E2E del Coach usan un Worker simulado y una sesión local: demuestran contratos,
persistencia y accesibilidad de la PWA, pero no prueban Clerk real, llamadas a Gemini/NVIDIA,
CORS/JWT remotos ni el comportamiento de un teclado físico Android.

> Release verificado 2026-09-14: `main` está en `668189b37f42792a115fc074f270fd0a4c9c5bac`.
> Pages terminó correctamente el workflow [34814589701](https://github.com/ytrocheai-stack/ferro/actions/runs/34814589701)
> y `https://ytrocheai-stack.github.io/ferro/version.json` confirma ese commit. Después se desplegó
> el Worker con la versión `fa2d6eed-654b-48a6-8d07-4fae20332f6f`; `/health` respondió HTTP 200.
> La verificación no llamó modelos ni cambió recursos, corpus, presupuestos o migraciones.

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

No documentar un hash de Git o un workflow anterior como prueba de que el checkout actual está
publicado. La revisión local se hizo sobre `267ba5c` más cambios sin confirmar. Antes de cada
release, comprobar el commit/artefacto exacto y registrar el resultado.

## Worker adaptativo

URL: [nextrep-adaptation.yehoshuatroche.workers.dev](https://nextrep-adaptation.yehoshuatroche.workers.dev/health).
El Worker vive en `worker/` y se publica por separado. No recrear sus recursos.

| Recurso/configuración | Declaración local | Verificación antes del despliegue |
|---|---|---|
| Worker | `nextrep-adaptation` en ambos TOML | Conservar nombre y bindings existentes |
| D1 | Binding `DB`, base `nextrep-adaptation` | El estado remoto de `0012`/`0013` requiere verificación; no se da por aplicada ninguna migración nueva solo por existir localmente |
| Vectorize principal | `VECTORIZE` → `nextrep-adaptation-512` | Crear/verificar dimensión 512, corpus activo y namespace correcto |
| Vectorize legado | `VECTORIZE_LEGACY_768` → `nextrep-adaptation-768` | Conservarlo intacto para rollback/compatibilidad; no reutilizarlo para 512 |
| Vectorize evaluación | `VECTORIZE_EVAL_1024` → `nextrep-adaptation-eval-1024` | Solo evaluación comparativa autorizada |
| Cron | `17 3 * * *` | Comprobar retención real antes de abrir |
| Producción | `wrangler.production.toml`: `ENVIRONMENT=production` | Revisar configuración privada y gates |
| Desarrollo | `wrangler.toml`: `ENVIRONMENT=development` | No usar su deploy genérico para producción |
| Beta/proveedores | Desarrollo apagado; producción habilita beta/embeddings/Flash solo para la cuenta permitida; Pro, reranking y probe apagados | Conservar la configuración y verificar la versión desplegada |
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
El contrato local requiere consentimiento `coach-context-v3-gemini-nvidia` en payload/cabecera, dispositivo
coincidente e `Idempotency-Key`. El preflight ya permite `X-NextRep-Consent-Version` y
`X-NextRep-Device-Id`, además de las cabeceras anteriores; el Worker responde 401 desde el origen
permitido sin JWT y 403 desde un origen no autorizado. Falta verificarlo desde Pages con sesión y
un segundo origen autorizado antes del release.

Las migraciones locales son `0001`–`0018`; `0004` añade metadata de fuentes, `0005`
añade presupuesto/reservas de tokens y concurrencia, y `0006` persiste la respuesta de una
solicitud idempotente para replay exacto, `0009` añade procedencia/filtros del corpus, `0011` añade ejecuciones durables del coach, `0012` añade el ledger de intentos y `0013` vincula cada ejecución a una conversación privada. Dexie v7 añade el propietario `ownerId` para jobs,
eventos y propuestas locales; Dexie v8 añade runs y mensajes del agente y Dexie v9 añade perfil/consentimiento y programación. `0014`–`0016` añaden cuotas/presupuesto, leases y snapshots; `0017` añade failover/circuitos de Gemini/NVIDIA y `0018` reconcilia el uso de cuota Gemini. Su existencia en disco no
sustituye el historial remoto; en la versión actual `0010` y `0011` ya están aplicadas. No omitir
ese paso ni volver a aplicar ALTERs manualmente sin comprobar el historial.

## Orden de publicación y pruebas

1. Verificar las correcciones por hallazgo del [informe](AUDITORIA-COACH-2026-08-30.md); mantener las
   regresiones de contrato, cancelación, aislamiento, idempotencia, presupuesto, aplicación e
   importación. Proveedores simulados.
2. Ejecutar `npm run check`, `npm run test:worker`, `npm run test:e2e` y `npm run test:e2e:coach`.
   Registrar cobertura pendiente: las pruebas locales (40 suites/198 pruebas, 48 del Worker y 13 E2E generales más 2 del agente; un skip de axe en WebKit) no son aprobación de beta.
3. Publicar **primero la PWA compatible**. Revisar los archivos que se incluirán en el commit;
   no añadir indiscriminadamente secretos, diagnósticos temporales ni otros cambios locales.
   El push a `main` desencadena Pages.
4. Comprobar las migraciones D1 `0014`–`0018` pendientes sin aplicar cambios no solicitados y publicar
   **después el Worker** con la configuración explícita de producción, conservando las dos cuentas de la
   allowlist, el orden Gemini→NVIDIA y el streaming apagado.
5. Verificar PWA, manifest, SW, datos públicos, `/health`, CORS y JWT/allowlist con datos
   ficticios. Completar un smoke autenticado y E2E del coach en un entorno de prueba controlado;
   abrir solo la cuenta canaria cuando se hayan aprobado los gates.
6. Con corpus autorizado e importador terminado, ejecutar primero `corpus:embed` en modo de prueba y
   después la operación real sólo con autorización fresca de NVIDIA y coste adicional cero. Cargar
   por lotes con `corpus:upload`, backup D1, comprobación de capacidad y rollback por versión.
7. Ejecutar `corpus:benchmark -- --run` con recuperación local y luego comparar 512/1024; registrar
   Recall@5, precisión de citas, revisión independiente y diferencias local/remoto.
8. Tras los gates, activar temporalmente beta, embeddings y los proveedores únicamente para las dos
   cuentas autorizadas; completar y aprobar el smoke, apagar la activación temporal y solo entonces
   consolidar las flags. Pro, reranking, provider probe y streaming permanecen apagados en esta entrega.
   Si no se puede garantizar ausencia de gasto adicional, detener llamadas y mantener todas las flags apagadas.
9. Probar backup/actualización de la PWA instalada en teléfonos y todo el recorrido. Abrir primero
   una cuenta y ampliar hasta cinco adultos únicamente tras autorización del responsable.

Los pasos técnicos son responsabilidad del desarrollo. El usuario aporta participantes/IDs,
completa login y MFA, revisa fuentes/consentimiento, prueba sus teléfonos y autoriza la apertura.
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
