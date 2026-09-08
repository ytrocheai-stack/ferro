# Revisión y continuación del corpus — 6 de septiembre de 2026

El corpus está cargado y comprobado de nuevo. La versión **todavía no está lista para
publicar**: las pruebas con consultas completas de NVIDIA no han validado una
generación fiable y hay problemas de calidad anteriores a la generación completa.
La última prueba de q13, con 4.000 tokens, agotó 300 segundos sin respuesta y quedó
pendiente en el diario. No hay llamadas en ejecución ni reintentos programados.

## Evidencias verificadas

| Control | Resultado |
| --- | --- |
| Fuentes / fragmentos | 88 / 2.708 |
| Embeddings originales | 2.708 × 2.048 dimensiones |
| Consultas vectorizadas | 50; textos de consulta conservados |
| D1 y Vectorize | Verificación remota nueva, 2026-09-06 19:07:50 UTC |
| Vectores 512 / 1024 | 2.708 / 2.708 |
| Discrepancias de identidad / evidencia excluida según los filtros actuales | 0 / 0 |
| Referencia | 50 consultas revisadas documentalmente por Codex AI |
| Respuestas anteriores | 12 conservadas; 5 aceptables y 7 necesitan corrección en revisión AI |
| Recall@5 con referencia revisada | 512: 0,79; 1024: 0,86; umbral por dimensión: 0,80 |
| `npm run check` | Aprobado: lint, ambos typechecks, 181 pruebas y build; `prepublication-check-2026-09-06.log` |
| Worker de producción | Empaquetado con `wrangler deploy --dry-run`; no desplegado |
| `npm run test:e2e` | 11 aprobadas, 1 omitida por configuración existente |
| Flags de producción en archivo | Beta, embeddings, Flash, Pro, reranking y probe: `false` |

Las pruebas E2E son locales, con dispositivos emulados; no certifican login/MFA de
producción, dispositivos físicos, smoke remoto ni observación canaria de 24 horas.

También se corrigió el parser de `corpus:status`: antes tomaba `closure` en
`--stage closure` como si fuera la ruta de un manifiesto y reportaba falsamente
contenido ausente. Tres pruebas de CLI cubren el orden de argumentos y la ausencia
de valor. Ahora el gate `preflight` queda aprobado y `closure` continúa bloqueado
por las etapas que efectivamente faltan.

## Revisión del paso 1

El usuario aclaró que la aprobación anterior fue administrativa y no incluyó una
lectura científica. Se conservó el original y se reemplazó la atribución de revisión
humana por una atribución explícita a **Codex AI**, conforme a su solicitud.
La aprobación de la referencia permite evaluación de investigación; no certifica
humanamente las 88 fuentes ni habilita despliegue.

La nueva referencia es `hevy-science-es-en-50-v2-agent-reviewed`. Conserva el
`corpusVersion` y los 50 textos de consulta. No requiere regenerar embeddings ni
recargar los índices por estas correcciones de etiquetas.

- Se cotejaron positivos, negativos, afirmaciones, poblaciones y hashes de las 50 consultas.
- q01: corrección tipográfica; q17–q18: matiz observacional y ausencia de diferencias detectadas.
- q03–q04 y q21–q22: se sustituyeron negativos que contenían resultados relacionados.
- q23–q24: se incorporó el fragmento 0001 de AEL; el 0002 comienza a mitad de frase.
- q31: respaldo en la conclusión del artículo para BDNF/IL-6 agudos, evitando
  equiparar biomarcadores sanguíneos con beneficios cognitivos. Se identificó que el
  fragmento inicial es un *Simple Summary* aunque la metadata dice *Abstract*.
- q36–q37: se especificaron subgrupos y carácter agudo de los resultados.
- q43: se sustituyó el negativo de desentrenamiento, que sí menciona ganancias de ROM.
- Se escribieron justificaciones temáticas concretas y anclas SHA-256 también para los negativos.

Los positivos son un conjunto juzgado **no exhaustivo**. El Recall@5 actual penaliza
otros fragmentos potencialmente pertinentes de la misma fuente. El 0,79 es el
resultado literal del gate existente, no una estimación completa de calidad semántica.
Antes de congelar una evaluación de release hace falta resolver este alcance de
etiquetado y su relación con el criterio de recuperación, sin cambiar etiquetas solo
para que pase el umbral.

## Respuestas anteriores

Se conservaron sin editar las 12 respuestas del checkpoint v1. Una respuesta JSON
parseable no equivale a una respuesta científicamente válida. La revisión por
afirmación distingue el texto de respuesta de la fidelidad de cada cita.

Aceptables: q01, q06, q08, q11 y q12. Requieren corrección:

| Consulta | Hallazgo |
| --- | --- |
| q02 | Presenta antecedentes de la introducción como estado de conclusiones del metaanálisis. |
| q03 | Apertura categórica; omite el alcance agregado y el matiz rest-pause. |
| q04 | Generaliza ausencia de significación y algunas citas no sostienen la condición exacta de volumen/esfuerzo igualados. |
| q05 | Convierte resultados grupales y un ensayo pequeño en consejo categórico individual; omite efectos modestos no descartados. |
| q07 | Cita la introducción para una interacción tiempo×grupo que corresponde a resultados. |
| q09 | Cambia *drop jump* por salto con contramovimiento y omite limitaciones de medición. |
| q10 | Extiende una recomendación tentativa del 20 % a prevención de sobreentrenamiento en rugby juvenil. |

El informe es parcial (12/300), ligado a huellas de respuestas v1 y generado por un
revisor distinto de NVIDIA Flash. No se traslada a respuestas futuras ni aprueba el release.

## Corrección de NVIDIA

La respuesta que detuvo la ejecución previa tiene `finish_reason: length`, consume
1.200 tokens de salida y no incluye `content`. Su consumo está medido y conservado.

El runtime ahora rechaza contenido vacío, solo espacios, salida truncada y consumo
no conciliado antes de devolver una generación. No usa `reasoning_content` como
respuesta final. Permite configurar explícitamente `thinking`, incluye esa opción
en la identidad de caché y registra el estado HTTP de rechazos futuros conservando
la incertidumbre de consumo.

Las dos pruebas mínimas con `thinking: false` devolvieron HTTP 529. Una prueba
mínima sin opciones de plantilla y otra con `thinking: true, reasoning_effort: low`
devolvieron JSON final y uso medido (202 y 203 tokens de salida respectivamente).
Sin embargo, q13 con su contexto completo y esfuerzo bajo volvió a recibir HTTP 529.
Esto no prueba que el fallo se deba exclusivamente a `thinking`: el servicio ha
respondido de manera diferente a peticiones distintas.

El benchmark queda configurado con `chat_template_kwargs: { thinking: true,
reasoning_effort: 'low' }`, un control documentado por
[NVIDIA](https://docs.api.nvidia.com/nim/re/reference/deepseek-ai-deepseek-v4-flash-0731).
La prueba de q13 con la plantilla predeterminada volvió a terminar con
`finish_reason: length`, 1.200 tokens medidos y contenido final nulo. El benchmark
pasa a `max_tokens: 4000` y liga todos los parámetros a su huella. Se creó una
autorización de ejecución separada: el límite de 4.000 está por debajo de los 8.000
por llamada de la autorización original del usuario, y conserva sin aumentarlos
los totales y la fecha de `provider-authorization-benchmark.json`.
Esta política aún requiere validación con consultas completas; no se presentan los diagnósticos
mínimos como respuestas del benchmark. El parser también rechaza afirmaciones
mal formadas y IDs duplicados, y conserva citas inventadas para que sean revisables.

El informe distingue el uso medido de las respuestas del benchmark del diario
global (`providerLedger`), que incluye embeddings, diagnósticos, intentos fallidos
y reservas. Antes exigía 300 llamadas pero registraba el acumulado de todos los
embeddings, de modo que el gate nunca habría pasado con una ejecución real.

La petición fallida comenzó el **2026-09-06 a las 19:02:01 UTC** (13:02:01 en Ciudad
de México). Su ID local es
`1bc88b1b1fa65d7e184377e2211ccfc0433ed25799b21c8add104e974f3f0921`.
El diario reserva 395 tokens de entrada estimados conservadoramente y 1.200 de
salida; esos valores **no son consumo confirmado**. No se marcaron como cero ni
como medidos. No hubo reintentos automáticos. El rechazo HTTP confirmado quedó
clasificado como `rejected`, respaldando primero el diario. Conserva íntegra la
reserva y `measured: false`; permite otra petición distinta dentro del presupuesto,
pero no repetir el mismo intento. Los fallos de red sin respuesta siguen bloqueando
nuevas llamadas. Las pruebas cubren ambas situaciones y el agotamiento del presupuesto.

El usuario comprobó que su panel indica **hasta 40 rpm**. Eso es frecuencia, no un
contador de tokens. NVIDIA explicó que sustituyó créditos por límites de frecuencia;
no corresponde pedir al usuario un saldo de créditos que esa interfaz ya no usa.
[Explicación de personal de NVIDIA](https://forums.developer.nvidia.com/t/request-more-4-000-credits-option-on-build-nvidia-com/344567).

Estado final del diario: **2.681 intentos**, **1 pendiente sin respuesta** y
**3 rechazos HTTP confirmados sin uso exacto medido**; `uncertainCalls: 4` conserva
ambas clases. Los totales con reservas son 1.199.019 tokens de entrada y 19.865 de
salida; no se presentan como consumo íntegramente medido. El último intento,
`eeb6183c7a1e24b64e1c0c0279a598e81b19baa1d32404b53ef588bdde42a84d`, conserva
21.182 tokens estimados de entrada y 4.000 de salida. La cancelación local no
demuestra cancelación remota. Se detuvieron nuevas llamadas.

## Continuación concreta

1. Conservar el diario con rechazos confirmados y reservas sin borrar ni poner
   consumo cero. Comprobar el resultado del diagnóstico de 4.000 tokens y cualquier
   petición sin respuesta antes de nuevas llamadas. Renovar evidencia de acceso y
   autorización únicamente si caduca; no hace falta buscar un saldo de créditos.
2. Resolver el alcance de etiquetas/recuperación y verificar el contenido final
   real con la política nueva antes de lanzar las 300 respuestas.
3. Generar una corrida uniforme v2 en un archivo separado. Las 12 respuestas v1 se
   conservan para trazabilidad; su configuración anterior no debe mezclarse con v2.

```powershell
npm run corpus:benchmark -- `
  --run --execute `
  --manifest .cache/corpus/hevy/manifest.json `
  --reference .cache/corpus/hevy/reference-final.json `
  --matrix .cache/corpus/hevy/embeddings/matrix-2048.json `
  --query-vectors .cache/corpus/hevy/embeddings/queries-2048.jsonl `
  --remote-results .cache/corpus/hevy/remote-verification.json `
  --authorization .cache/corpus/hevy/provider-authorization-prepublication.json `
  --output .cache/corpus/hevy/results.generated.v2.json `
  --repetitions 3
```

4. Revisar las 300 respuestas individualmente y ejecutar los gates de calidad.
5. Completar el laboratorio remoto y sus revisiones. La autorización de benchmark
   actual reserva solo **una llamada** para laboratorio y **una** para smoke; no
   alcanza para los pasos 7 y 10. El archivo genérico de autorización tiene
   subpresupuestos cuya suma excede sus totales y no es ejecutable como está.
6. Solo con evidencia aprobada: candidato exacto, despliegue, smoke de cuatro
   solicitudes, pruebas autenticadas y canario de 24 horas. Ninguna de esas
   evidencias se ha inventado ni certificado con los tests locales.

El laboratorio local adicional usa el corpus real en una carpeta separada
(`agent-lab-local-prepublication`): seguridad automática 10/10, aceptación 2/28
(7,14 %). Se ejecutaron tres repeticiones. No es una medición del proveedor remoto:
es una simulación que falla por evidencia insuficiente y decisiones no disponibles
en varios casos, además de carecer de las revisiones remotas requeridas. Todos los
fragmentos siguen con población no revisada para el modo de recomendaciones; no se
ha cambiado esa metadata a `true` sin revisarla.

## Artefactos locales

Todos los archivos siguientes están bajo `.cache/corpus/hevy`, excluido de Git:

- `reference-final.before-agent-review-2026-09-06.json`: original preservado.
- `reference-review-2026-09-06.json`: revisión por consulta, antes/después y anclas.
- `response-reviews.legacy-v1.json`: 12 revisiones por respuesta y por afirmación.
- `remote-verification-2026-09-06-afternoon.json`: nueva comprobación remota; también
  promovida a `remote-verification.json`, con respaldo del archivo anterior.
- `retrieval-preflight-reviewed-v2.json`: resultado de recuperación por dimensión.
- `provider-incident-2026-09-06.json`: incidente HTTP y reserva incierta.
- `check-2026-09-06.log`, `e2e-2026-09-06.log`: validaciones locales.
- `prepublication-check-2026-09-06.log`, `worker-prepublication-dry-run.log`:
  validación de código y empaquetado de producción.
- `provider-rejection-accounting-2026-09-06.json`: reclasificación sustentada del
  primer HTTP 529, sin inventar consumo medido.
- `q13-default-diagnostic-2026-09-06.log`: truncamiento real a 1.200 tokens.
- `q13-low-effort-4000-diagnostic-2026-09-06.log`: diagnóstico de límite ampliado.
- `provider-timeout-4000-2026-09-06.json`: timeout, identidad del intento y reserva.
- `results.preflight.v2.json`: recuperación local con resultados remotos verificados;
  no contiene respuestas generadas por Flash y no sustituye el benchmark remoto.
- `status-2026-09-06.json`: gate de cierre, que continúa bloqueado.

El checkpoint v1 y el provider-ledger permanecen conservados. No se publicaron
cambios, no se activaron flags y no se modificaron secretos.
