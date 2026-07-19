# NextRep 🏋️

Registro de entrenamientos de gimnasio estilo [Hevy](https://www.hevyapp.com/), para uso personal.
**PWA 100% offline**: se instala en Android (Chrome) y iPhone (Safari) y funciona sin conexión.

## Características

- **1,324 ejercicios** con GIF, imagen e instrucciones paso a paso **en español** (dataset [exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset), media © Gym visual), organizados por grupo muscular
- **Rutinas y programas**: plantillas propias con series objetivo, rangos de reps y descansos; programas listos (PPL, Torso/Pierna, Full-body, Bro split, Arnold Split)
- **Registro de entrenos**: valores del entreno anterior como referencia, tipos de serie (W/F/D), superseries, RPE, cardio, sugerencia de doble progresión, calculadora de discos, temporizador de descanso con vibración/sonido/notificación
- **Historial** completo y editable, con récords personales automáticos
- **Análisis**: series por grupo muscular vs. recomendado, heatmap corporal, volumen semanal
- **Nutrición**: diario de comidas (base local de ~250 alimentos, búsqueda Open Food Facts, escáner de código de barras, platos propios, favoritos), objetivos con asistente BMR/TDEE, tendencia de peso suavizada con sugerencia adaptativa de calorías
- **Medidas y fotos**: 15 medidas corporales con gráficas, fotos de progreso con visor y comparador antes/después
- **Backup**: exporta/importa todos tus datos en JSON; series a CSV
- kg/lb, pantalla siempre encendida al entrenar (Wake Lock), tema oscuro

Todos los datos viven en tu teléfono (IndexedDB). No hay servidor ni cuentas.

## Documentación

- [CLAUDE.md](CLAUDE.md) — contexto rápido e invariantes para devs y agentes de IA
- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — cómo funciona todo por dentro
- [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) — cómo se despliega (¡el deploy es manual!)
- [docs/AUDITORIA-2026-07.md](docs/AUDITORIA-2026-07.md) — auditoría de bugs y limitaciones conocidas

## Desarrollo

```bash
npm install
npm run fetch-data   # descarga el dataset (~150 MB) y genera public/data|images|videos
npm run dev          # http://localhost:5173
npm run build        # build de producción (dist/) con service worker
npm run preview      # sirve el build en http://localhost:4173/ferro/
```

El deploy a GitHub Pages es **manual**: se compila y se sube `dist/` a la rama `gh-pages`
(no hay CI activo). Pasos exactos en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

## Instalación en el teléfono

**Android**: abre la URL en Chrome → menú ⋮ → **«Instalar aplicación»**.
**iPhone**: abre la URL en Safari → **Compartir** → **«Añadir a pantalla de inicio»**.

Después:
1. Abre la app instalada una vez con conexión (precachea la biblioteca, ~15 MB)
2. Opcional: en **Perfil → Datos → «Descargar todos los GIFs»** (~130 MB) para tener las animaciones sin conexión. Los GIFs que veas con conexión también quedan guardados automáticamente.

## Stack

Vite · React 18 · TypeScript · Tailwind CSS v4 · Dexie (IndexedDB) · Zustand · Recharts · vite-plugin-pwa (Workbox)

## Atribución

Datos e imágenes de ejercicios: [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) — media © [Gym visual](https://gymvisual.com/). Proyecto personal sin ánimo de lucro, no afiliado a Hevy.
