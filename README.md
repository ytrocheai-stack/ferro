# NextRep

Registro de entrenamientos y nutrición personal, inspirado en Hevy. Es una PWA offline-first: los datos del usuario viven en IndexedDB del dispositivo y la interfaz mantiene la misma experiencia en Android, iPhone y escritorio.

## Qué incluye

- Biblioteca de ejercicios con imágenes/GIFs, catálogo complementario de wger y ejercicios personalizados.
- Rutinas, superseries, calentamientos, RPE, cardio, progresión y PRs recalculados cronológicamente.
- Historial editable, medidas, fotos y análisis comparativo de carga, constancia, fuerza y dosis muscular.
- Diario nutricional con alimentos base, USDA FoodData Central, Open Food Facts, escáner y platos.
- Tendencias nutricionales con adherencia, cobertura, gasto energético estimado y confianza basada en datos.
- Backup JSON validado (con límite de tamaño), CSV de series y restauración segura sin mutaciones parciales.
- Importación Hevy por CSV o API Pro: entrenos, rutinas, carpetas, medidas y ejercicios; lotes trazables y deshacer.
- PWA instalable y usable sin conexión; los snapshots de datos quedan fijados por hash.

## Desarrollo

```bash
npm install
npm run fetch-data   # dataset de ejercicios + snapshots USDA/wger
npm run dev          # http://localhost:5173
npm run check        # lint, typecheck, tests y build
npm run test:e2e     # Playwright (Chromium + WebKit)
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
