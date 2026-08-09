# Despliegue de NextRep

- **Repositorio**: `github.com/ytrocheai-stack/ferro`
- **URL**: `https://ytrocheai-stack.github.io/ferro/`
- **Ruta pública**: `/ferro/` (forma parte del contrato de la PWA y de sus enlaces internos)

El workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) se ejecuta al hacer push a `main` o manualmente desde Actions. GitHub Pages está configurado en modo `workflow` y el despliegue automático quedó verificado con la ejecución [31299312626](https://github.com/ytrocheai-stack/ferro/actions/runs/31299312626).

## Publicar una versión

```bash
npm run check
git add -A
git commit -m "feat: siguiente versión"
git push origin main
```

Para una prueba local usa `npm run build` y `npm run preview`; la URL de preview incluye `/ferro/`. Después de un deploy, abre la URL en una ventana privada y comprueba que cargan `/ferro/`, `/ferro/data/exercises.json`, el manifest y el service worker.

## Operación y rollback

GitHub Pages conserva los artefactos de Actions. Para revertir, revierte el commit de `main` y vuelve a publicar; no borres la base IndexedDB del usuario. Si cambia el formato de datos, añade una versión Dexie aditiva y una nota de migración antes del release.
