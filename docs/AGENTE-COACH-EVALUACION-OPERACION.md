# Estado operativo del agente coach

## Cambios implementados

- Se unificó la clave D1 de fuentes como `sourceId:corpusVersion` en el importador Worker, carga, verificación remota y rollback.
- La verificación remota ahora compara los valores almacenados de Vectorize con los prefijos locales normalizados, con tolerancia de redondeo float32; dimensión y metadata ya no bastan.
- Los hashes del expediente de release y de configuración usan SHA-256 hexadecimal sobre los mismos bytes. El release conserva una copia inmutable de la configuración candidata y registra por separado la configuración activada.
- El smoke autenticado usa tres exposiciones comparables para exigir una propuesta accionable y conserva un segundo caso sin historial que debe permanecer en `maintain`; las citas solo se exigen al caso accionable.
- Los checkpoints de benchmark guardan huellas separadas de consulta, contexto, modelo, instrucciones y parámetros. Una mutación invalida la reanudación; no se reutiliza una respuesta antigua por la clave nominal.
- La idempotencia del Worker incorpora la identidad de ejecución (corpus/retrieval/prompt/modelos/flags); cambiarla con la misma clave devuelve conflicto.
- El laboratorio suma llamadas y tokens reservados antes de cada intento. Embeddings, benchmark y laboratorio comparten el ledger `provider-ledger`; la autorización exige subpresupuestos explícitos cuya suma no exceda la cuota global.
- `corpus:status` acepta `--stage preflight|evaluation|canary|closure`. La ventana de observación de 24 horas solo pertenece a `closure`.

## Verificación local

Ejecutar desde la raíz del repositorio:

```powershell
npm run check
npm run test:worker
npm run corpus:status -- --stage preflight --gate
npm run corpus:status -- --stage evaluation --gate
npm run corpus:status -- --stage canary --gate
npm run corpus:status -- --stage closure --gate
```

Verificación del 2026-09-08 UTC: `preflight` aprueba; `evaluation`, `canary` y `closure` no aprueban. NVIDIA está configurado tanto en `.env.providers.local` como en los secretos del Worker; `GET /v1/models` respondió HTTP 200 y confirmó Kimi K3. No falta esa credencial. Faltan correcciones funcionales y evidencia de calidad: véase [la auditoría de cierre](REVISION-CIERRE-KIMI-2026-09-08.md). Que las pruebas locales pasen no demuestra cobertura completa del plan.

## Acciones manuales obligatorias

1. Revisar las 50 consultas y completar `reference-final.json`: relevantes, negativos, afirmaciones, población/aplicabilidad, exclusiones, revisor y fecha. Debe quedar `status=approved` y ligado al `corpusVersion` exacto.
2. Ejecutar `npm run provider:doctor -- --verify-remote` antes de declarar que faltan credenciales. El comando carga `.env.providers.local` desde la raíz del repositorio, conserva variables explícitas y solo informa presencia, HTTP y disponibilidad del modelo; no imprime secretos ni genera respuestas. Crear el archivo a partir de `.env.providers.example` únicamente si el diagnóstico confirma que falta. No guardar secretos en Git ni en el expediente.
3. Crear una autorización privada fresca con coste adicional cero y subpresupuestos para `embeddings`, `benchmark`, `lab` y `smoke`; la suma de `calls`, `inputTokens` y `outputTokens` debe quedar dentro de los totales autorizados.
4. Generar los 2,708 embeddings de pasaje y los 50 de consulta:

```powershell
npm run corpus:embed -- --execute --manifest .cache/corpus/hevy/manifest.json --reference .cache/corpus/hevy/reference-final.json --queries .cache/corpus/hevy/reference-final.json --authorization <autorizacion.json>
```

5. Respaldar D1, aplicar solo migraciones pendientes y cargar los índices 512/1024 con capacidad reservada para el índice legado. Confirmar el `upload-checkpoint` y ejecutar `corpus:verify-remote --execute` con el archivo de capacidad.
6. Ejecutar el benchmark real (50 × 2 dimensiones × 3 repeticiones), conservar las 300 respuestas y hacer que otro agente revise respuestas, citas y afirmaciones. La aprobación científica final debe ser humana.
7. Ejecutar el laboratorio real con proveedor remoto, 28 escenarios de aceptación y 10 de seguridad, tres repeticiones, sin consumo incierto. Generar review, release candidate e inventario.
8. Publicar la PWA y después el Worker con flags apagadas. Verificar readiness, origen, JWT, consentimiento, dispositivo y allowlist de una sola cuenta.
9. Activar temporalmente solo beta/embeddings/Flash para la cuenta canaria. Preparar un JWT en archivo y `deviceId`; ejecutar `coach:smoke --execute --confirm-canary`. Luego apagar la activación temporal.
10. Desde Pages y ambos navegadores, completar login, consentimiento, propuesta, aplicación explícita, persistencia, replay, cancelación, aislamiento de cuenta, abstención y offline. Obtener aprobación humana del expediente concreto.
11. Habilitar definitivamente solo `ENABLE_BETA`, `ENABLE_EMBEDDINGS` y `ENABLE_FLASH` para la cuenta canaria; mantener Pro, reranking y probe apagados. Observar 24 horas sin tráfico artificial y registrar rollback, consumo, errores, reservas y Cron.

Si falla seguridad, aislamiento, identidad de corpus o presupuesto: apagar beta/proveedores, no reintentar llamadas inciertas, conservar los artefactos y restaurar una versión compatible usando únicamente IDs de la versión candidata.
