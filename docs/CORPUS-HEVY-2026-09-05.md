# Preparación del corpus Hevy — 2026-09-05

> Estado actualizado: ver [revisión del 6 de septiembre](REVISION-CORPUS-2026-09-06.md).
> D1 y ambos índices ya fueron comprobados con 2.708 fragmentos/vectores. La
> referencia fue revisada por Codex AI a petición del usuario; el benchmark y el
> cierre siguen bloqueados por calidad y por fallos NVIDIA en las pruebas de
> generación. El informe enlazado conserva el diagnóstico y las reservas de consumo.
> Los estados de preparación que siguen son históricos.

La preparación local se ejecutó contra `C:\Users\yehos\Downloads\Hevy_Corpus` sin modificar
Downloads. El importador acepta una carpeta o directamente `rag/science_chunks.jsonl`, pero rechaza
`core_science_chunks.jsonl` y notas de creadores para evitar duplicar la colección inicial.

```bash
npm run corpus:prepare -- --input C:\Users\yehos\Downloads\Hevy_Corpus
npm run corpus:validate -- .cache/corpus/hevy/manifest.json
npm run corpus:report
npm run corpus:embed -- --manifest .cache/corpus/hevy/manifest.json --reference .cache/corpus/hevy/reference-final.json --queries .cache/corpus/hevy/reference-final.json
npm run corpus:status
npm run corpus:release -- --manifest .cache/corpus/hevy/manifest.json --benchmark .cache/corpus/hevy/reference-final.json
npm run corpus:verify-remote -- --execute --manifest .cache/corpus/hevy/manifest.json --reference .cache/corpus/hevy/reference-final.json --capacity worker/corpus/capacity.json
npm run corpus:review -- --results .cache/corpus/hevy/results.generated.json --reviews .cache/corpus/hevy/response-reviews.json
npm run corpus:inventory
npm run coach:smoke
npm run corpus:status -- --gate
```

Resultado local reproducible:

| Control | Resultado |
|---|---:|
| Fuentes | 88 |
| Fragmentos conservados | 2.708 |
| Archivos cubiertos por SHA256 | 218 |
| Autores recuperados desde XML | 47 |
| Poblaciones certificadas | 0 |
| Evidencia recuperable por clase | 2.209 |
| Tablas ambiguas | 286 |
| Administrativo | 213 |
| Embeddings/proveedor | Bloqueados por defecto |
| Índices remotos | No cargados |
| Evaluación de calidad | No aprobada |

El laboratorio se ejecutó en una corrida fresca con 28 casos de aceptación y 10 entradas de
seguridad, tres repeticiones: seguridad `10/10`, `0` fallos y gate independiente aprobado; la
calidad automática quedó bloqueada por ejecución simulada, corpus no evaluado por el proveedor y
falta de revisión humana de afirmaciones.

El manifiesto y los artefactos permanecen bajo `.cache/corpus/hevy` (excluido de Git). El estado
`approved` del manifiesto significa autorización de recuperación del paquete; no equivale a una
evaluación científica individual. Todos los documentos mantienen `populationReviewed=false` y
evidencia desconocida hasta revisión humana específica.

## Embeddings y carga

`corpus:embed -- --execute --reference .cache/corpus/hevy/reference-final.json --queries .cache/corpus/hevy/reference-final.json --authorization <json>` exige primero
la referencia científica aprobada de las 50 consultas ligada al mismo corpus y usa exclusivamente
`nvidia/nemotron-3-embed-1b`, guarda los vectores originales de 2.048 dimensiones, cachea por
modelo/texto, conserva `input_type=passage`/`input_type=query` y confirma cada fragmento en un checkpoint. `corpus:upload -- --execute
--apply-migrations --capacity <json>` exige credenciales Cloudflare, backup D1, migraciones
remotas pendientes aplicadas antes de mutar índices, y capacidad suficiente para
`2708 × (512 + 1024) = 4.159.488` dimensiones, y registra mutation IDs separados para los índices
512/1024. La metadata total se valida por debajo de 10 KiB y sus siete propiedades indexadas por
debajo de 64 bytes; `corpusKey` es la representación compacta de `corpusVersion` para respetar el
límite de [Vectorize](https://developers.cloudflare.com/vectorize/platform/limits/). Ningún comando
activa beta, Flash, Pro ni reranking.

La autorización debe demostrar acceso y coste adicional cero; la ausencia de la clave deja el flujo
en estado `blocked`, no en estado aprobado. Tras una carga real se debe comprobar conteo, hash,
consulta por vector y correspondencia D1/Vectorize antes de seleccionar `RAG_INDEX_VERSION`.

## Estado remoto comprobado el 2026-09-06

La sesión Cloudflare autenticada permitió únicamente comprobaciones de lectura. El D1 remoto
`nextrep-adaptation` existe con seis tablas iniciales; las migraciones `0004`–`0009` siguen
pendientes y no registra escrituras recientes. `nextrep-adaptation-768` (legado) y `nextrep-adaptation-eval-1024` existen con cero
vectores; todavía no existe `nextrep-adaptation-512`. No se aplicaron migraciones, no se crearon
índices y no se escribieron vectores. La cuenta canaria, la cuota/coste de NVIDIA y la aprobación
científica siguen sin estar disponibles.

`corpus:status` expone tres estados separados: `execution` (artefactos locales completos),
`verification` (D1/Vectorize, evaluación remota y laboratorio comprobados) y `approval` (expediente
de versión candidata y aprobación humana explícita). `--gate` devuelve código distinto de cero si
falta cualquiera de ellos; nunca activa flags. `corpus:release` solo puede fijar un expediente después
de la aprobación científica del benchmark y registra commit, cambios, configuración, corpus,
benchmark y huellas; no constituye aprobación humana.

Cada carga remota crea un backup D1 con fecha y versión, conserva un checkpoint v2 con los mutation
IDs de ambos índices y escribe `remote-verification.json` únicamente después de comprobar 88 fuentes,
2.708 fragmentos y 2.708 vectores en cada índice candidato. El checkpoint no autoriza saltar la
verificación remota ni reemplaza la revisión científica.

`corpus:verify-remote` conserva la comparación local/remota por consulta, incluidos filtros,
identidades, diferencias de top-5 y metadata recuperada. `corpus:review` exige 300 revisiones
individuales (512/1024 × 50 × 3), cada una ligada a query, dimensión, repetición, huella,
revisor, generador, afirmaciones y justificación, además de un revisor distinto del generador;
no puede convertir un `frozen-draft` ni una respuesta sin cita en aprobada.

`coach:smoke` es plan-only por defecto. El modo real exige `--execute --confirm-canary`, una
autorización fresca de coste cero con presupuesto explícito de tokens, token JWT en archivo,
allowlist de una sola cuenta y límite exacto de cuatro requests; su autorización debe declarar
temporalmente beta/embeddings/Flash en `true` y Pro/reranking/provider probe en `false`. Comprueba
readiness autenticado, generación Flash con citas, replay idempotente y un evento de aceptación;
nunca consulta provider probe. El expediente de despliegue debe completar además las comprobaciones
visuales de Pages, offline, cancelación, cambio de cuenta, actualización PWA y ambos navegadores.
El expediente humano final debe enlazar `candidateFingerprint` y `smokeFingerprint`; el estado no
acepta una aprobación genérica o de otra versión.
