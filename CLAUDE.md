# NextRep — Contexto para agentes de IA y desarrolladores

> **Lee esto antes de tocar nada.** Resume qué es la app, cómo se trabaja en ella y los
> invariantes que NO se pueden romper. El detalle completo vive en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md),
> [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) y [docs/AUDITORIA-2026-07.md](docs/AUDITORIA-2026-07.md).

## Qué es

**NextRep** (antes "Ferro") es un clon personal de [Hevy](https://www.hevyapp.com/): registro de
entrenos de gimnasio + nutrición + medidas, como **PWA 100% offline**. Un solo usuario, sin
servidor, sin cuentas: todos los datos viven en el dispositivo (IndexedDB + localStorage).
La usa una persona real en su teléfono a diario — **los datos de producción son irreemplazables**.

- **Stack**: Vite 6 · React 18 · TypeScript · Tailwind CSS v4 · Dexie 4 (IndexedDB) · Zustand 5 · Recharts · vite-plugin-pwa (Workbox)
- **Producción**: `https://ytrocheai-stack.github.io/ferro/` (GitHub Pages, rama `gh-pages`)
- **Repo**: `github.com/ytrocheai-stack/ferro` (cuenta autenticada en `gh`: `ytrocheai-stack`)
- **Idioma**: toda la UI, comentarios y docs en español. Nombres de ejercicios en inglés (vienen así del dataset).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run fetch-data` | Descarga el dataset de ejercicios (~150 MB, SHA fijado) y genera `public/data\|images\|videos`. **Necesario una vez antes de dev/build** (esas carpetas están gitignored). |
| `npm run dev` | Vite en `http://localhost:5173` (base `/`, sin service worker). |
| `npm run build` | `tsc && vite build && node scripts/postbuild.mjs` → `dist/` con SW y `404.html`. Base `/ferro/`. |
| `npm run preview` | Sirve `dist/` en `http://localhost:4173/ferro/`. |
| `npm run icons` | Regenera iconos PWA con sharp (las salidas van commiteadas). |

## ⚠️ Invariantes críticos (romperlos = pérdida de datos o app rota)

1. **Los identificadores internos "ferro" son INTOCABLES** aunque la marca visible sea "NextRep":
   - `super('ferro')` en [src/db/db.ts](src/db/db.ts) — nombre de la base IndexedDB.
   - Claves de localStorage `ferro-settings`, `ferro-nutrition-goals`, `ferro-active` (persist de Zustand).
   - Discriminador `app: 'ferro'` / `'ferro-photos'` dentro de los JSON de backup.
   - `base: '/ferro/'` en vite.config.ts, el nombre del repo y la URL de Pages.
   Renombrar cualquiera de ellos vacía (aparentemente) los datos del usuario o rompe la PWA instalada.
2. **El deploy real es la rama `gh-pages`** con el build ya compilado ("Deploy from a branch").
   El workflow de Actions en `.github/workflows/deploy.yml` está **sin commitear y no funciona**
   (el token de `gh` no tiene scope `workflow`). Flujo completo en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).
   Recuerda commitear el código a `main` aparte — no ocurre solo al desplegar.
3. **Los pesos se persisten SIEMPRE en kg** (`weightKg`). Las libras son solo presentación
   (`kgToDisplay`/`displayToKg`/`formatWeight` en [src/lib/format.ts](src/lib/format.ts)). Nunca guardes valores en unidades de display.
4. **Esquema Dexie: cambios solo aditivos.** Para una tabla/índice nuevo: añade `this.version(3).stores({...})`
   re-declarando TODO el esquema, sin borrar los bloques `version(1)`/`version(2)`, e inclúyela en
   `exportBackup`/`importBackup` ([src/lib/backup.ts](src/lib/backup.ts)) con validación. Campos nuevos dentro del
   blob de un registro NO necesitan migración (no son índices).
5. **No uses `loading="lazy"` en imágenes**: Chromium no las carga offline aunque estén en el SW.
   Usa el lazy manual de [src/components/ExerciseThumb.tsx](src/components/ExerciseThumb.tsx) (IntersectionObserver).

## Convenciones de código

- **Modales**: nunca `alert`/`confirm`/`<select>` nativos. Usa `Sheet`/`ActionSheet`/`Confirm`
  ([src/components/Sheet.tsx](src/components/Sheet.tsx)) y `Select` ([src/components/Select.tsx](src/components/Select.tsx)). Escape cierra solo el sheet
  superior (hay una pila interna).
- **Dexie reactivo**: `useLiveQuery(() => db.tabla…, deps, valorInicial)` — el 3er argumento
  distingue "cargando" (`undefined` → skeleton) de "vacío" (`[]` → estado vacío).
- **Estado Zustand**: datos con selector (`useActive((s) => s.session)`), acciones con
  `useActive.getState().accion()` (evita suscripciones innecesarias).
- **Borrados con Deshacer**: snapshot + `toastUndo(mensaje, restaurar)` ([src/stores/toasts.ts](src/stores/toasts.ts)).
- **Cronómetros por timestamp**: guarda `endsAt`/`startedAt` absolutos y pinta con `useNow()`;
  nunca cuentes ticks (iOS congela timers en background).
- **Entrada decimal**: acepta coma española con `parseDec()` ([src/lib/format.ts](src/lib/format.ts)).
- **IDs**: `uid()` de format.ts (UUID v4 con fallback iOS < 15.4). Ejercicios custom: prefijo `custom-`;
  alimentos: `seed-…` / `custom-…` / `off-<código de barras>`.
- **Ejercicio posiblemente inexistente**: al pintar por `exerciseId`, usa siempre fallback
  (`info?.name ?? 'Ejercicio eliminado'`) — el ejercicio pudo borrarse del catálogo.
- **Exportar archivos**: `shareOrDownloadFile()` (Web Share API en iOS, `<a download>` en el resto).
- **Compatibilidad iOS** es transversal: audio desbloqueado en primer gesto (`unlockAudio`),
  teclado en pantalla (`useVisualViewportOffset` en GymKeypad), EXIF en fotos, `isIOS()`/`isStandalone()`
  en [src/lib/platform.ts](src/lib/platform.ts) para ramas de UI.

## Mapa rápido de carpetas

```
src/
├── pages/        Una por ruta (Home, ActiveWorkoutPage, History, WorkoutDetail, RoutineEditor,
│                 Exercises, ExerciseDetail, Nutrition, Measurements, Analysis, Profile)
├── components/   Sheet/Select/Confirm (modales), ExercisePicker, FoodPicker, DishPicker,
│                 GymKeypad, BarcodeScanner, TemplateBrowser, ExerciseThumb, Toasts, iconos…
├── stores/       Zustand: activeWorkout (sesión en curso), settings, nutrition (objetivos), toasts
├── db/           db.ts (esquema Dexie v2, 9 tablas) + types.ts (todos los tipos de datos)
├── data/         exercises.ts (catálogo), muscleGroups.ts, templates.ts (programas),
│                 foods.ts + foods.seed.ts (~250 alimentos), translations.ts, measurementLabels.ts
├── lib/          format, stats (1RM/PRs/volumen), progression (doble progresión), nutrition
│                 (BMR/TDEE/EMA), backup, csv, notify, photos, gifs, openFoodFacts, platform…
└── App.tsx       Shell: layout, TabBar, RestTimerOverlay global, ActiveBanner, Toasts
scripts/          fetch-dataset.mjs · postbuild.mjs · generate-icons.mjs
docs/             ARQUITECTURA.md · DESPLIEGUE.md · AUDITORIA-2026-07.md
```

## Decisiones/limitaciones conocidas (no son bugs)

Ver la lista completa con contexto en [docs/AUDITORIA-2026-07.md](docs/AUDITORIA-2026-07.md). Las principales:
los PRs se calculan al guardar y no se recalculan al editar entrenos pasados; la notificación de
fin de descanso solo puede llegar con la app abierta o al volver a ella (PWA sin push server);
el día de Nutrición no auto-avanza al cruzar medianoche con la app abierta.
