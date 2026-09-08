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

`smoke-authorization.example.json` es solo una plantilla sin secretos. El smoke real exige copiarla
a un artefacto privado, completar la cuenta canaria, corpus, cuota y flags temporales restringidas,
y usar `npm run coach:smoke -- --execute --confirm-canary ...` después del despliegue controlado.

`scientific-review.example.json` enumera las certificaciones obligatorias de la persona responsable:
relevantes, negativos difíciles, afirmaciones, población/aplicabilidad y exclusiones. La aprobación
estructural del benchmark no sustituye estas certificaciones.

`capacity.example.json` es la plantilla común para autorizar capacidad de almacenamiento y consultas:
debe incluir lo ya almacenado, los `4.159.488` dimensions candidatos, las `76.800` dimensions de
las 50 consultas × 512/1024 y el conteo leído del índice legado de 768 para demostrar que no cambia.
`corpus:verify-remote` también exige esta autorización antes de consultar Vectorize.

`deployment-verification.example.json` documenta la evidencia privada posterior: versiones de PWA y
Worker, readiness, allowlist de una cuenta, activación temporal y su apagado, recorrido completo
desde Pages (incluidos cancelación, cambio de cuenta, abstención, offline y ambos navegadores),
flags definitivas, huellas de candidato/aprobación/smoke, observación de 24 horas sin tráfico
artificial y reversión acotada. `corpus:status -- --gate` no acepta el release sin ese expediente.

En producción, `/readiness` exige además los conteos configurados de 88 fuentes y 2.708 fragmentos.
El upload no avanza un checkpoint hasta confirmar el lote completo en ambos índices mediante
`get_by_ids` y en D1. El smoke ejecutable valida previamente la referencia científica, la
verificación remota, las 300 respuestas revisadas, los gates del laboratorio y el expediente de
release con flags apagadas.
