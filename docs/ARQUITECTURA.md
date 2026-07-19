# Arquitectura de NextRep

> Documento de referencia para entender cómo funciona la app por dentro. Complementa a
> [../CLAUDE.md](../CLAUDE.md) (invariantes y convenciones) y [DESPLIEGUE.md](DESPLIEGUE.md) (build y deploy).
> Última actualización: 2026-07-19 (auditoría completa, ver [AUDITORIA-2026-07.md](AUDITORIA-2026-07.md)).

## Visión general

PWA de una sola persona, 100% offline, sin backend. Tres dominios funcionales:

1. **Entrenos** — rutinas, sesión activa, historial, progresión, PRs, análisis de volumen.
2. **Nutrición** — diario de comidas (4 vías de registro + platos), objetivos, tendencia de peso.
3. **Medidas** — peso/medidas corporales y fotos de progreso.

Persistencia dual: los **datos finales** viven en Dexie/IndexedDB (base `ferro`); el **estado de
sesión** (entreno en curso, ajustes, objetivos) vive en Zustand con `persist` en localStorage.
Nada importante existe solo en memoria.

## Esquema de datos (Dexie, base `ferro`)

Definido en [src/db/db.ts](../src/db/db.ts); tipos en [src/db/types.ts](../src/db/types.ts). PK de todas las tablas: `id` (string de `uid()`).

| Tabla | Índices | Contenido | Versión |
|---|---|---|---|
| `workouts` | `startedAt` | Entrenos terminados: ejercicios → series (`LoggedSet`), volumen, PRs congelados | v1 |
| `routines` | `sortOrder`, `folderId` | Plantillas del usuario (`RoutineExercise[]`, rango de reps, descansos) | v1 (+`folderId` v2) |
| `customExercises` | — | Ejercicios propios (id `custom-…`) | v1 |
| `folders` | `sortOrder` | Carpetas de rutinas | v2 |
| `measurements` | `date`, `kind`, `[kind+date]` | Peso, % graso, perímetros (15 tipos) | v2 |
| `photos` | `date` | Fotos de progreso (`Blob` JPEG ≤1080px) | v2 |
| `foods` | `name`, `source`, `usedAt`, `offCode` | Alimentos: `custom-…`, caché OFF (`off-<ean>`), y base `seed-…` materializados al marcarlos favoritos | v2 |
| `dishes` | `name` | Platos: combinaciones de alimentos con macros denormalizados (`DishItem[]`) | v2 |
| `foodLog` | `date`, `[date+meal]` | Diario: una entrada por alimento/plato registrado, macros ya calculados (robusto a borrar el origen) | v2 |

Notas:
- Los campos añadidos con el tiempo (`rpe`, `durationSec`/`distanceM` de cardio, `supersetGroup`,
  `repRangeMin/Max`) viven dentro del blob del registro, no son índices → no exigieron migración.
- Los índices `[kind+date]`, `[date+meal]` y los secundarios de `foods` están declarados pero las
  consultas actuales no los usan (filtran por el campo simple); disponibles para futuras queries.
- `ensurePersistentStorage()` pide `navigator.storage.persist()` al arrancar.

## Stores Zustand (localStorage)

| Store | Clave persist | Contenido |
|---|---|---|
| [activeWorkout.ts](../src/stores/activeWorkout.ts) | `ferro-active` | Solo `{session, rest}` (partialize). La sesión activa sobrevive a recargas/cierres. Un `rest` ya vencido se descarta en el `merge` de rehidratación (evita avisos fantasma). |
| [settings.ts](../src/stores/settings.ts) | `ferro-settings` | Unidades, descanso por defecto, sonido/vibración/notificación, wake lock, RPE, objetivo semanal, barra y discos. |
| [nutrition.ts](../src/stores/nutrition.ts) | `ferro-nutrition-goals` | Objetivos de kcal/macros + parámetros del wizard (sexo, edad, altura, actividad, objetivo). |
| [toasts.ts](../src/stores/toasts.ts) | (sin persist) | Toasts efímeros, máx 3, autodismiss 5 s, patrón `toastUndo`. |

## Dominio: entrenos

### Ciclo de vida de una sesión

- **Empezar**: `startEmpty()` · `startFromRoutine(r)` (crea `ActiveExercise[]` con las series
  planificadas vacías) · `repeatWorkout(w)` (series vacías con `prev` = las del entreno repetido) ·
  `startEditing(w)` (copia las series existentes; conserva `startedAt/endedAt` originales al guardar).
- **`prev` (columna "Anterior")**: `prevSetsIn(historial, exerciseId)` devuelve las series **de
  trabajo** (completadas, sin calentamientos) del último entreno con ese ejercicio. El historial se
  carga **una sola vez por lote** y se comparte entre ejercicios. El mapeo fila→prev es por *ordinal
  de serie de trabajo* (`prevWorkingSetFor`): las filas de calentamiento de hoy no consumen índice
  y muestran "—".
- **Completar serie** (`toggleSet`): exige datos efectivos (reps, o duración/distancia en cardio,
  escritos o de placeholder) — si no, toast y no se marca. Autorrellena desde `placeholderFor`
  (prev equivalente o fila de arriba). Vibra solo si el ajuste "Vibración" está activo. Arranca el
  descanso salvo que sea calentamiento, se esté editando, o no sea el último ejercicio del tramo
  contiguo de la superserie.
- **Descanso**: `rest = {endsAt, totalSec}` absoluto. `RestTimerOverlay` (global en [App.tsx](../src/App.tsx))
  pinta con `useNow(250)`, programa `setTimeout` al vencimiento y re-sincroniza en
  `visibilitychange` (iOS congela timers). Al vencer: vibración + bip WebAudio + notificación,
  según ajustes.
- **Finalizar** (`finish`): descarta series incompletas y ejercicios vacíos; calcula `volumeKg`
  (series de trabajo), `totalSets` y `prs` (`detectPRs` contra el historial anterior). Guard de
  reentrada: un doble toque no duplica el entreno. Al editar, regenera los PRs de ESE entreno
  (los de entrenos posteriores no se recalculan — decisión conocida).
- **Superseries**: `supersetGroup` numérico compartido. "Último del grupo" = por **adyacencia**
  (el siguiente ejercicio no comparte grupo), de modo que reordenar y partir un grupo no rompe el
  disparo del descanso.

### Progresión y estadísticas

- [progression.ts](../src/lib/progression.ts): `suggestProgression` (doble progresión: si todas las series al peso
  máximo llegan al tope del rango de reps → sugiere +2.5 kg), `warmupSets` (rampa desde la barra),
  `calcPlates` (discos por lado según los configurados en Perfil).
- [stats.ts](../src/lib/stats.ts): `epley1RM`, `workingSets` (= completadas y no-warmup: la regla de qué cuenta
  para volumen y PRs), `bestsOfSets`/`bestsFromHistory`/`detectPRs` (peso máx, e1RM, volumen por
  serie — hasta 3 PRs por ejercicio), `weeklySetsByGroup` (ventana rodante de 7 días), `ema`
  (suavizado α=0.25), `exerciseSeries` (puntos para las gráficas de ExerciseDetail).
- **Análisis** ([Analysis.tsx](../src/pages/Analysis.tsx)): heatmap y series por grupo usan **últimos 7 días rodantes**;
  el gráfico "Volumen semanal" usa **semanas de calendario (lunes)** con `addWeeks` (DST-safe).

### Catálogo de ejercicios

- Dataset `hasaneyldrm/exercises-dataset` fijado por SHA; `scripts/fetch-dataset.mjs` genera
  `public/data/exercises.json` (slim, ~1 MB: nombre en, instrucciones es, target/equipo/bodyPart)
  + 1.324 jpg + 1.324 gif. Carpetas gitignored (se regeneran).
- [exercises.ts](../src/data/exercises.ts): `loadExercises()` (fetch + caché de módulo), `useCatalog()` (dataset +
  customs de Dexie en vivo, `byId` para resolver), `searchExercises` (grupo muscular / equipo /
  texto normalizado con términos traducidos), `exerciseGroup()`.
- [muscleGroups.ts](../src/data/muscleGroups.ts): 11 `MuscleGroup` + mapeo `target→grupo`, etiquetas es, orden canónico
  y `RECOMMENDED_WEEKLY_SETS` (rangos de hipertrofia para Análisis).
- [templates.ts](../src/data/templates.ts): 5 programas (PPL, Torso/Pierna, Full-body, Bro split, Arnold) con IDs
  verificados contra el dataset; `TemplateBrowser` los aplica creando carpeta + rutinas.

## Dominio: nutrición

### Registro de comida (5 vías, [FoodPicker.tsx](../src/components/FoodPicker.tsx))

1. **Local**: catálogo combinado ([foods.ts](../src/data/foods.ts)) = ~250 alimentos base (`foods.seed.ts`) + Dexie.
   Sin búsqueda ordena favoritos primero y luego por recencia (`usedAt`). La estrella marca
   favorito (`toggleFavoriteFood`); un alimento base se "materializa" en Dexie al favoritarlo y
   la copia estática se oculta para no duplicar.
2. **Platos** ([DishPicker.tsx](../src/components/DishPicker.tsx)): crear/editar/eliminar platos (nombre + alimentos con gramos,
   macros denormalizados en `DishItem`); registrar un plato pide la **ración** (0.5×/1×/1.5×/2×/
   personalizada) y crea **una** entrada agregada en `foodLog` (sin `foodId`).
3. **Buscar online**: Open Food Facts ([openFoodFacts.ts](../src/lib/openFoodFacts.ts)); cachea resultados en Dexie
   **preservando** `usedAt`/`favorite` (buscar no contamina "recientes").
4. **Escanear**: `BarcodeDetector` con fallback a entrada manual; `lookupBarcode` resuelve
   **primero desde la caché Dexie** (funciona offline para códigos ya vistos) y si no, red.
5. **Crear alimento**: valores por 100 g, id `custom-…`.

`macrosForGrams` calcula por regla de tres desde los valores por 100 g (kcal a entero, macros a
0.1 g). Editar la cantidad de una entrada recalcula **exacto** desde el alimento origen si sigue
en Dexie; si no, proporcional.

### Objetivos y tendencia

- **Wizard** ([NutritionGoalsWizard.tsx](../src/components/NutritionGoalsWizard.tsx)): Mifflin-St Jeor → TDEE por factor de actividad →
  reparto (proteína 2/2.2 g·kg, grasa 0.9 g·kg, carbos el resto) según objetivo
  (volumen +10% / mantener / definición −15%). Precarga el último peso real (por fecha) y solo
  inserta una medición nueva si difiere.
- **Tendencia de peso** ([Nutrition.tsx](../src/pages/Nutrition.tsx) `WeightTrendCard`): EMA sobre **toda** la serie de
  pesos (se pintan los últimos 30). `weeklyChangePct` exige ≥14 días reales de calendario y
  calcula %/semana sobre la tendencia suavizada. `suggestCalorieAdjustment` compara con el ritmo
  esperado del objetivo y sugiere ±100-200 kcal.
- **Día**: clave local `YYYY-MM-DD`; no se puede navegar a futuro; "Copiar el día anterior" busca
  hasta 14 días atrás. Resumen semanal = media de los días CON registros en los últimos 7.

## Dominio: medidas y fotos

- [Measurements.tsx](../src/pages/Measurements.tsx): 15 tipos de medida (kg/%/cm), última por tipo, detalle con gráfica e
  histórico borrable (con Deshacer).
- **Fotos**: captura → `resizeImageToBlob` (EXIF-aware vía `createImageBitmap` con fallback
  `<img>`, máx 1080px JPEG) → Blob en Dexie. Grid → **visor** (foto grande + fecha + borrar con
  confirmación y Deshacer). Modo comparar: 2 fotos con slider antes/después. Los object URLs se
  gestionan con `useBlobUrl` (hook que revoca al desmontar — nunca `URL.createObjectURL` suelto).

## PWA / offline (vite.config.ts + Workbox)

- **Precache** (~10.6 MB, ~1.364 entradas): shell JS/CSS/HTML, `data/exercises.json` y TODAS las
  miniaturas jpg. `maximumFileSizeToCacheInBytes: 8 MB`.
- **Runtime caching**: GIFs (`videos/**`, ~130 MB) en CacheFirst caché `gifs` (máx 1.500,
  `purgeOnQuotaError`) — se llenan al verlos o con "Descargar todos los GIFs" en Perfil
  ([gifs.ts](../src/lib/gifs.ts), 6 workers). Open Food Facts en NetworkFirst (timeout 6 s, 7 días).
- **Navegación**: fallback SPA a `index.html` precacheado (denylist jpg/gif/json) + `404.html`
  copiado por postbuild para deep links en GitHub Pages.
- **Actualización**: `registerType: 'autoUpdate'` — el SW nuevo hace `skipWaiting` +
  `clientsClaim` + `cleanupOutdatedCaches`; el usuario recibe la versión nueva al recargar.
- En dev (`npm run dev`) NO hay service worker.

## Backup / exportación

- **Backup general** ([backup.ts](../src/lib/backup.ts)): JSON con las 8 tablas (sin fotos) + settings + objetivos.
  Import: valida shape por registro ANTES de tocar nada (workouts estricto; rutinas, medidas y
  foodLog mínimos) y reemplaza TODO dentro de una transacción atómica.
- **Backup de fotos**: archivo aparte (dataURL base64); el import AÑADE, no reemplaza.
- **CSV de series** ([csv.ts](../src/lib/csv.ts)): una fila por serie, escapado RFC 4180, con BOM UTF-8 para Excel.
- Todo se entrega vía `shareOrDownloadFile` (Web Share API con archivo en iOS; `<a download>` si no).

## Compatibilidad iOS (transversal)

`uid()` con fallback sin `crypto.randomUUID` · `unlockAudio()` en el primer `pointerdown`
(AudioContext con fallback webkit) · `useVisualViewportOffset` para que la barra ± del keypad no
quede bajo el teclado · EXIF de fotos · Web Share para exportar · metas Apple en index.html +
`InstallCard` en Perfil (iOS no tiene `beforeinstallprompt`) · safe-areas (`env(safe-area-inset-*)`)
· timers por timestamp con resync en `visibilitychange` · toggle "Vibración" oculto en iOS.

## UI: tokens y patrones

- **Tokens** (`@theme` en [index.css](../src/index.css)): `bg #0b0b0f`, `surface #16161c`, `surface-2 #1f1f27`,
  `border #2a2a33`, `primary #3d8bfd`, `text #f2f2f5`, `muted #8f8f9b`, `success #33c076`,
  `danger #f4504f`, `warning #f2a33c`. Tema oscuro fijo. Colores de macros: P azul, C verde, G naranja.
- **Clases propias**: `.card`, `.btn` (+`-primary/-surface/-danger`), `.input`, `.chip`
  (+`-active`), `.pressable`, `.skeleton`, `.tabular`; animaciones `sheet-in/out`, `scrim-in/out`,
  `check-pop`, `timer-pulse`. `prefers-reduced-motion` respetado globalmente.
- **Página típica**: header (back o h1) → `useLiveQuery` con skeleton → cards → sheets al final
  del JSX. Rutas en español ([main.tsx](../src/main.tsx)), páginas lazy (Recharts fuera del bundle inicial).
- **Gráficas Recharts**: estilo oscuro inline (`contentStyle` `#1f1f27`, grid `#2a2a33`,
  ejes `#8f8f9b`, línea principal `#3d8bfd`).
