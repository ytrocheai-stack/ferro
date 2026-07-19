# NextRep 🏋️

Registro de entrenamientos de gimnasio estilo [Hevy](https://www.hevyapp.com/), para uso personal.
**PWA 100% offline**: se instala desde Chrome en Android y funciona sin conexión.

## Características

- **1,324 ejercicios** con GIF, imagen e instrucciones paso a paso **en español** (dataset [exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset), media © Gym visual)
- **Rutinas**: crea plantillas con ejercicios, series objetivo y descansos
- **Registro de entrenos**: tabla de series con los valores del entreno anterior como referencia, tipos de serie (calentamiento W / al fallo F / drop D), temporizador de descanso con vibración, sonido y notificación
- **Historial** completo, editable
- **Progreso**: gráficas por ejercicio (peso máximo, 1RM estimado con Epley, volumen), récords personales detectados automáticamente
- **Estadísticas**: entrenos por semana, racha, volumen y tiempo total
- **Backup**: exporta/importa todos tus datos en JSON
- kg/lb, pantalla siempre encendida al entrenar (Wake Lock), tema oscuro

Todos los datos viven en tu teléfono (IndexedDB). No hay servidor ni cuentas.

## Desarrollo

```bash
npm install
npm run fetch-data   # descarga el dataset (~150 MB) y genera public/data|images|videos
npm run dev          # http://localhost:5173
npm run build        # build de producción (dist/) con service worker
npm run preview      # sirve el build en http://localhost:4173/ferro/
```

El deploy a GitHub Pages es automático al hacer push a `main` (ver `.github/workflows/deploy.yml`).

## Instalación en el teléfono

1. Abre la URL de GitHub Pages en Chrome (Android)
2. Menú ⋮ → **«Instalar aplicación»** (o «Añadir a pantalla de inicio»)
3. Abre la app instalada una vez con conexión (precachea la biblioteca, ~15 MB)
4. Opcional: en **Perfil → Datos → «Descargar todos los GIFs»** (~130 MB) para tener las animaciones sin conexión. Los GIFs que veas con conexión también quedan guardados automáticamente.

## Stack

Vite · React 18 · TypeScript · Tailwind CSS v4 · Dexie (IndexedDB) · Zustand · Recharts · vite-plugin-pwa (Workbox)

## Atribución

Datos e imágenes de ejercicios: [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) — media © [Gym visual](https://gymvisual.com/). Proyecto personal sin ánimo de lucro, no afiliado a Hevy.
