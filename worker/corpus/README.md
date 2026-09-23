# Corpus editorial del coach

El manifiesto de esta fase es una propuesta trazable, no un corpus aprobado. La base científica
prevista comienza con:

- Schoenfeld y colaboradores, posicionamiento IUSCA sobre hipertrofia
  ([página de publicación](https://journal.iusca.org/index.php/Journal/article/view/81)).
- Hickmott, Chilibeck, Shaw y Butcher, revisión de autorregulación
  ([artículo](https://link.springer.com/article/10.1186/s40798-021-00404-9)).

Cada fragmento futuro debe registrar autoría, fecha, localización exacta, licencia/permiso,
población, limitaciones, idioma, `corpusVersion` y huella. No se agregan aquí transcripciones de
Jeff Nippard, Renaissance Periodization ni Dr. de la Rosa: permanecen como propuesta editorial
pendiente de permisos y fuera del manifiesto aprobado.

Antes de importar, una revisión humana debe aprobar las fuentes y fragmentos, congelar las 50
consultas y sus negativos difíciles, generar los embeddings Nemotron de 2048 dimensiones y guardar
artefactos locales versionados. El laboratorio no convierte una URL en evidencia ni llama a NVIDIA.

`smoke-authorization.example.json` es solo una plantilla sin secretos. El canario del Coach exige
autorización privada fresca, una JWT de la única cuenta Clerk de `wrangler.production.toml`, el
corpus exacto y flags temporales limitadas a Gemini más embeddings NVIDIA. Usa
`npm run coach:agent-smoke -- --execute ...`; valida readiness autenticado, creación/replay/lectura,
una decisión Gemini completada, continuación y cancelación reales en `/v1/coach/runs`. No guarda la
JWT. `coach:smoke` valida el endpoint anterior de adaptación y no acredita el canario del Coach.

`scientific-review.example.json` enumera las certificaciones obligatorias de la persona responsable:
relevantes, negativos difíciles, afirmaciones, población/aplicabilidad y exclusiones. La aprobación
estructural del benchmark no sustituye estas certificaciones.

`capacity.example.json` es la plantilla común para autorizar capacidad de almacenamiento y consultas:
debe incluir lo ya almacenado, los `4.159.488` dimensions candidatos, las `76.800` dimensions de
las 50 consultas × 512/1024 y el conteo leído del índice legado de 768 para demostrar que no cambia.
`corpus:verify-remote` también exige esta autorización antes de consultar Vectorize.

`deployment-verification.example.json` documenta la evidencia privada posterior: versiones de PWA y
Worker, readiness, allowlist de una cuenta, aprobación humana del candidato y de la ventana exacta,
recorrido desde Pages, huellas de candidato/aprobación/canario, monitorización y reversión.

La ruta `private-evaluation` permite una prueba cerrada de **una sola cuenta durante exactamente 24
horas como máximo**. Antes de iniciarla, la aprobación humana debe fijar la cuenta, el inicio y el
vencimiento, y deben estar aprobados los gates Gemini de 300 respuestas, el laboratorio 28+10×3,
el canario autenticado real y el acceso/presupuesto de prueba NVIDIA NIM. La monitorización continua
debe cubrir las 24 horas desde el inicio. Al vencer la ventana se deben apagar operativamente las
flags, comprobar en un máximo de 15 minutos que `/readiness` rechaza el servicio y que no se aceptan
más solicitudes; el gate solo reconoce la prueba una vez cerrada y con las flags definitivas
apagadas. Esta autorización no permite uso cotidiano ni acredita una licencia productiva de NVIDIA.
Los archivos `*.example.json` son plantillas: `status: not-run`, las aprobaciones pendientes y las
flags superiores apagadas mantienen el servicio cerrado. `evaluationTrial.activeFlags` solo describe
las flags que usaría la ventana autorizada; por sí sola no activa el Worker ni aprueba un trial.

La activación cotidiana o productiva es una autorización separada: exige aprobación humana para ese
alcance y evidencia vigente de licencia NVIDIA NIM AI Enterprise para Nemotron. NVIDIA limita los
endpoints Developer Program gratuitos a desarrollo, prototipos, investigación y pruebas; un producto
en producción requiere licencia AI Enterprise ([condiciones oficiales de NVIDIA NIM](https://docs.api.nvidia.com/nim/docs/product)).
El acceso y presupuesto para las llamadas de prueba también deben verificarse en
`smoke-authorization.json`; no se infieren de que el endpoint esté disponible ni de una cuota
gratuita aparente.

Los E2E en Chromium Android y WebKit iPhone usan un Worker simulado: se registran como simulados y
no acreditan una llamada remota ni un dispositivo físico. `corpus:status -- --gate` exige el canario
real y, para cada modalidad, la monitorización y el cierre descritos arriba.

En producción, `/readiness` exige además los conteos configurados de 88 fuentes y 2.708 fragmentos.
El upload no avanza un checkpoint hasta confirmar el lote completo en ambos índices mediante
`get_by_ids` y en D1. El smoke ejecutable valida previamente la referencia científica, la
verificación remota, las 300 respuestas revisadas, los gates del laboratorio y el expediente de
release que fija la configuración base real: `ENABLE_BETA=false`, Gemini y embeddings habilitados,
y las demás flags apagadas.
