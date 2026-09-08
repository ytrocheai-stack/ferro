# NextRep

Registro de entrenamientos y nutrición personal, inspirado en Hevy. Es una PWA offline-first: los datos del usuario viven en IndexedDB del dispositivo y la interfaz mantiene la misma experiencia en Android, iPhone y escritorio.

## Qué incluye

- Biblioteca de ejercicios con imágenes/GIFs, catálogo complementario de wger y ejercicios personalizados.
- Rutinas, superseries, calentamientos, RPE/RIR, cardio, progresión y PRs recalculados cronológicamente.
- Historial editable, medidas, fotos y análisis comparativo de carga, constancia, fuerza y dosis muscular.
- Diario nutricional con alimentos base, USDA FoodData Central, Open Food Facts, escáner y platos.
- Tendencias nutricionales con adherencia, cobertura, gasto energético estimado y confianza basada en datos.
- Backup JSON validado (con límite de tamaño), CSV de series y restauración segura sin mutaciones parciales.
- Importación Hevy por CSV o API Pro: entrenos, rutinas, carpetas, medidas y ejercicios; lotes trazables y deshacer.
- PWA instalable y usable sin conexión; los snapshots de datos quedan fijados por hash.

## Coach adaptativo (beta cerrada)

El coach tiene una implementación local parcial: motor determinista compartido, contratos de eventos
y cambios, propuestas locales, autenticación con Clerk y un Worker para RAG/explicaciones. La revisión
del 30 de agosto corrigió aislamiento de cola, presupuesto, decisiones mixtas, calentamientos,
reintentos, namespaces, rollback, evaluación y readiness; **todavía no está listo para abrir la beta**.
El paquete científico local ya se prepara reproduciblemente (88 fuentes, 2.708 fragmentos y 47
autores recuperados), pero los embeddings, la carga remota y la evaluación Flash permanecen
bloqueados hasta disponer de autorización de coste cero. Los flags de beta y proveedores siguen
apagados; el HTTP 200 del Worker no acredita el despliegue de estos cambios.

Consulta el [estado y criterios de apertura](docs/ADAPTACION-ENTRENAMIENTO.md) y la
[auditoría con pruebas y hallazgos](docs/AUDITORIA-COACH-2026-08-30.md), junto con el
[registro final de correcciones](docs/CORRECCION-HALLAZGOS-2026-08-31.md). La suite general y el
Worker se verifican localmente; aún no cubren el recorrido remoto completo ni aprueban la apertura.
El canario `.cache` es solo una referencia local fuera de Git.

### Laboratorio reproducible del agente

La primera entrega del agente original vive en `packages/agent-lab` y trabaja exclusivamente con
escenarios ficticios. Coordina `session-finished`, Training Agent y Research Agent, consulta solo
un corpus aprobado que se le entregue explícitamente y devuelve propuestas sin aplicarlas. Sus
ejecuciones simuladas no se consideran evidencia de calidad de un modelo real.

```bash
npm run agent:lab       # una decisión explicable sobre un escenario ficticio
npm run agent:evaluate  # 28 casos de aceptación + 10 de seguridad × 3 repeticiones
npm run agent:rag       # valida resultados reales; falla si faltan vectores/citas/revisión
npm run corpus:prepare -- --input C:\\Users\\yehos\\Downloads\\Hevy_Corpus
npm run corpus:embed   # plan local; requiere --execute + autorización para llamar a NVIDIA
npm run corpus:upload   # plan local; requiere --execute --apply-migrations + capacidad/backup/credenciales
npm run corpus:status
```

El resultado esperado de la fase es evidencia local reproducible sobre cómo decide el agente; no es
una apertura de beta ni un despliegue.

## Desarrollo

```bash
npm install
npm run fetch-data   # dataset de ejercicios + snapshots USDA/wger
npm run dev          # http://localhost:5173
npm run check        # lint, typecheck, tests y build
npm run test:e2e     # Playwright (Chromium + WebKit)
npm run test:e2e:coach # flujo del agente con Clerk y Worker simulados
```

El build usa `/ferro/` como basename para mantener compatibilidad con el sitio publicado y con IndexedDB `ferro`. No cambies esos identificadores sin una migración explícita.

## Datos externos y licencias

Los snapshots reproducibles y sus hashes están en [`data/sources.lock.json`](data/sources.lock.json). El workflow ejecuta `npm run fetch-data` antes del build para regenerar `public/data`.

- Ejercicios y media: [exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset), con atribución a Gym visual.
- Alimentos: [USDA FoodData Central Foundation](https://fdc.nal.usda.gov/download-datasets.html), CC0; el nombre oficial se conserva y las búsquedas pueden usar alias verificados.
- Ejercicios complementarios: [wger](https://wger.de/en/software/api), CC BY-SA.
- Productos y códigos de barras: [Open Food Facts](https://world.openfoodfacts.org/data), datos comunitarios; la app muestra estos resultados como fuente cacheada y aplica límites de consulta.

Consulta [`docs/DATOS-REALES.md`](docs/DATOS-REALES.md) para refrescar snapshots,
[`docs/IMPORTACION-HEVY.md`](docs/IMPORTACION-HEVY.md) para CSV/API y
[`docs/MEJORAS-ANALISIS-NUTRICION-2026-08.md`](docs/MEJORAS-ANALISIS-NUTRICION-2026-08.md)
para el detalle de esta entrega.

## Publicación

Cada push a `main` ejecuta [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), instala dependencias con `npm ci`, regenera los datos fijados, ejecuta el build y despliega GitHub Pages. La guía de operación está en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

## Instalación

En Android abre la URL en Chrome y elige **Instalar aplicación**. En iPhone abre Safari, toca **Compartir** y después **Añadir a pantalla de inicio**. Abre la app una vez con conexión para precachear la biblioteca; los GIFs pendientes se descargan desde **Perfil → Datos** y la acción se oculta al completar el catálogo.

## Arquitectura

- React 18 + TypeScript + Vite + Tailwind CSS v4.
- Dexie/IndexedDB para persistencia local y Zustand para la sesión activa.
- Vitest + Testing Library para unit/integration; Playwright + axe para smoke y accesibilidad.
- `docs/ARQUITECTURA.md` mantiene el mapa técnico e invariantes.
