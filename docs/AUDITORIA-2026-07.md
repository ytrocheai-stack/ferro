# Auditoría de bugs — julio 2026

> Auditoría completa del código (entrenos, datos/plataforma, nutrición/medidas/análisis/perfil/
> biblioteca) realizada el 2026-07-19. Estado: **22 bugs corregidos, 3 funcionalidades a medias
> rematadas, 8 limitaciones documentadas como decisiones conocidas.** Los fixes marcados 🧪 se
> verificaron ejecutando el flujo real en el navegador; el resto por inspección de código +
> compilación.

## Bugs corregidos

### Entrenos

| # | Sev. | Bug | Fix |
|---|---|---|---|
| 1 🧪 | ALTA | Los calentamientos del entreno anterior contaminaban la columna "Anterior" y el autorrelleno (indexado posicional de `prev`): con previos `[W 20×10, 100×8…]`, la serie 1 de hoy mostraba/rellenaba 20×10 | `prev` guarda solo series de trabajo y el mapeo fila→prev es por ordinal de serie de trabajo (`prevWorkingSetFor`); las filas W de hoy muestran "—" ([activeWorkout.ts](../src/stores/activeWorkout.ts)) |
| 2 🧪 | ALTA | Un descanso persistido que venció con la app cerrada disparaba vibración + notificación fantasma al reabrir | El `merge` de rehidratación descarta `rest` con `endsAt` pasado |
| 3 🧪 | ALTA | Se podía completar una serie vacía → se guardaba 0×0 e inflaba `totalSets` | `toggleSet` exige reps (o duración/distancia en cardio) efectivas; si no, toast "Rellena la serie antes de completarla" |
| 4 🧪 | MEDIA | Doble toque rápido en "Finalizar" creaba el entreno duplicado | Guard de reentrada en `finish()` |
| 5 🧪 | MEDIA | Completar un calentamiento arrancaba el descanso completo de trabajo | Los warmups ya no inician descanso automático |
| 6 | MEDIA | Reordenar ejercicios podía partir una superserie y el descanso saltaba en el miembro equivocado (búsqueda por nº de grupo, no contigüidad) | "Último de superserie" redefinido por adyacencia |
| 7 | MEDIA-BAJA | El peso aceptaba negativos/valores absurdos con teclado físico (reps sí estaba protegido) | Clamp ≥0 en peso, duración y distancia ([ActiveWorkoutPage.tsx](../src/pages/ActiveWorkoutPage.tsx)) |
| 8 | MEDIA | La vibración al completar serie ignoraba el ajuste "Vibración" | Condicionada a `settings.vibration` |
| 9 | PERF | `prevSetsFor` cargaba TODA la tabla `workouts` una vez POR ejercicio (O(N·historial) al empezar rutina) | El historial se carga una vez por lote y se comparte (`recentWorkouts` + `prevSetsIn`) |

### Datos / plataforma

| # | Sev. | Bug | Fix |
|---|---|---|---|
| 10 | MEDIA-ALTA | CSV sin BOM UTF-8 → Excel en Windows mostraba mal acentos/ñ | BOM `﻿` + `charset=utf-8` ([csv.ts](../src/lib/csv.ts)) |
| 11 🧪 | MEDIA | `importBackup` solo validaba `app` y que `workouts` fuera array: un backup truncado/editado reemplazaba TODO con registros rotos que crasheaban Perfil/Historial | Validación por registro ANTES de la transacción (workouts estricto; rutinas/medidas/foodLog mínimos) con error claro y datos intactos ([backup.ts](../src/lib/backup.ts)) |
| 12 | BAJA | `new AudioContext()` sin fallback `webkitAudioContext` (Safari viejo → sin bip, silencioso) | Constructor con fallback ([notify.ts](../src/lib/notify.ts)) |
| 13 | BAJA | `parseDec` solo sustituía la primera coma; dos formularios usaban `parseFloat` a mano | Normaliza todas las comas; unificado en peso (Nutrition) y medidas |
| 14 | ALTA (conf.) | Object URLs de fotos nunca se revocaban (WeakMap inútil: `useLiveQuery` devuelve Blobs nuevos en cada refresco) → memoria creciente y fotos borradas retenidas | Hook `useBlobUrl` con `revokeObjectURL` en cleanup; `blobUrl` eliminado ([photos.ts](../src/lib/photos.ts)) |
| 15 🧪 | ALTA (conf.) | Escape cerraba TODOS los sheets anidados a la vez | Pila de sheets: Escape solo cierra el superior ([Sheet.tsx](../src/components/Sheet.tsx)) |

### Nutrición / análisis / medidas

| # | Sev. | Bug | Fix |
|---|---|---|---|
| 16 | MEDIA | La EMA se re-sembraba con la ventana de 30 pesos: el primer punto de tendencia era el peso crudo → la línea "saltaba" y sesgaba el %/semana | EMA sobre toda la serie; solo se recortan los últimos 30 para pintar ([Nutrition.tsx](../src/pages/Nutrition.tsx)) |
| 17 | MEDIA | El escáner offline cortaba con error sin consultar la caché (que sí tenía códigos ya escaneados) | `lookupBarcode` se intenta siempre (caché Dexie primero); mensajes según conexión ([FoodPicker.tsx](../src/components/FoodPicker.tsx)) |
| 18 | MEDIA | Editar gramos reescalaba desde macros ya redondeados (deriva acumulativa en ediciones repetidas) | Si el alimento origen sigue en Dexie, recalcula exacto desde per-100g; si no, proporcional |
| 19 | MEDIA | Buckets de "Volumen semanal" con `+7×86400000` → doble conteo/hueco de 1 h en los cambios de hora (DST) | `addWeeks` de date-fns ([Analysis.tsx](../src/pages/Analysis.tsx)) |
| 20 | MEDIA | "Series semanales por grupo" decía "semanal" pero usaba 7 días rodantes (inconsistente con "Volumen semanal" por semana ISO) | Retitulado "(últimos 7 días)" — el cálculo rodante es intencional para el heatmap |
| 21 | BAJA | `CompareSheet` podía recibir una foto `undefined` (aserción `!` sobre `find`) | Selección validada con `useMemo`; solo se abre con las 2 fotos presentes ([Measurements.tsx](../src/pages/Measurements.tsx)) |
| 22 | BAJA | El efecto de la cámara del escáner dependía de la identidad del callback `onDetect` (riesgo de reinicio/parpadeo en re-renders) | Callback vía ref; el efecto solo depende de `supported` ([BarcodeScanner.tsx](../src/components/BarcodeScanner.tsx)) |

## Funcionalidades a medias, rematadas 🧪

| Feature | Estado previo | Ahora |
|---|---|---|
| **Favoritos de alimentos** | `toggleFavoriteFood` era código muerto; la estrella nunca podía aparecer; los ~250 alimentos base no podían favoritarse | Estrella tocable en cada fila (Local y Online). Los alimentos base se "materializan" en Dexie al favoritarlos (`source: 'seed'`, `usedAt: 0`) y se des-materializan al quitarlos. Favoritos fijados arriba de la lista |
| **Visor de fotos de progreso** | Tocar una miniatura abría directamente "¿Eliminar esta foto?" (borrado accidental a un toque) | Tocar abre un visor (foto grande + fecha); eliminar vive dentro, con confirmación y Deshacer |
| **Platos (dishes)** | Tabla, tipos y backup existían; cero interfaz | Pestaña "Platos" completa en el selector de comida: crear/editar/eliminar platos (alimentos con gramos, macros exactos), registrar con ración 0.5×/1×/1.5×/2×/personalizada como una entrada agregada ([DishPicker.tsx](../src/components/DishPicker.tsx)) |

## Limitaciones conocidas (documentadas, sin cambio de código)

1. **PRs congelados**: se calculan al guardar el entreno y no se recalculan si después editas/borras
   un entreno anterior (un "PR" antiguo puede quedar mostrado). Recalcular todo el historial sería
   una feature aparte.
2. **Notificación de descanso en background profundo**: sin push server, la notificación solo puede
   dispararse con la app viva o al volver a ella (`visibilitychange`). Limitación estructural de PWA.
3. **Medianoche**: el día de Nutrición no auto-avanza si la app queda abierta al cruzar las 00:00
   (los datos son correctos; la vista sigue en el día que estabas). El contador semanal de Home
   tampoco se refresca al cambiar de semana hasta la siguiente escritura en Dexie.
4. **`ProgressPhoto.note`** existe en tipos y backup pero sin UI para capturarla/mostrarla.
5. **`CustomExerciseSheet` offline**: si `exercises.json` nunca cargó, el Select de músculo muestra
   "—" (sin pérdida de datos).
6. **Índices Dexie sin uso**: `[kind+date]`, `[date+meal]` y los secundarios de `foods` están
   declarados pero las queries actuales no los necesitan; quedan para el futuro.
7. **Superserie partida**: si reordenas y separas los miembros, cada tramo contiguo descansa por su
   cuenta (comportamiento definido tras el fix 6); el color/letra siguen marcando la pertenencia.
8. **Búsqueda OFF requiere red** (NetworkFirst con caché de 7 días como respaldo); el escáner sí
   funciona offline para códigos ya vistos (fix 17).
