# Despliegue de NextRep

> El deploy REAL es manual, a la rama `gh-pages` con el build ya compilado
> (GitHub Pages en modo "Deploy from a branch"). **NO hay CI activo**: el
> `.github/workflows/deploy.yml` del working tree nunca se pudo subir porque el token de `gh`
> (cuenta `ytrocheai-stack`) no tiene el scope `workflow`. Si algún día se añade ese scope,
> puede commitearse el workflow y retirar este flujo manual.

- **URL de producción**: `https://ytrocheai-stack.github.io/ferro/` (instalada como PWA en el
  teléfono del usuario — la ruta `/ferro/` no puede cambiar).
- **Repo**: `github.com/ytrocheai-stack/ferro`. El código fuente vive en `main`; el build en `gh-pages`.

## Flujo paso a paso

```bash
# 0. Prerequisito una sola vez por máquina: npm install && npm run fetch-data

# 1. Compilar (incluye tsc y genera dist/ con service worker y 404.html)
npm run build

# 2. Worktree de la rama gh-pages (NO huérfana: la rama ya existe)
git fetch origin gh-pages
git worktree add --detach /tmp/ferro-deploy origin/gh-pages

# 3. Reemplazar el contenido por el build nuevo
cd /tmp/ferro-deploy
find . -mindepth 1 -maxdepth 1 -not -name '.git' -exec rm -rf {} +
cp -r <ruta-del-repo>/dist/. .

# 4. Commit y push — el push YA dispara el build de Pages solo
git add -A
git commit -m "Deploy: <qué cambió>"
git push origin HEAD:gh-pages

# 5. Verificar (estado "building" → "built" en ~1 min)
gh api repos/ytrocheai-stack/ferro/pages/builds/latest --jq .status

# 6. Limpiar el worktree
cd <ruta-del-repo>
git worktree remove /tmp/ferro-deploy --force
```

Después, abrir la URL de producción y comprobar el cambio en vivo (la PWA instalada recibe el SW
nuevo con `autoUpdate` al siguiente arranque/recarga).

## No olvidar

1. **Commitear `main` aparte.** El deploy solo toca `gh-pages`; el código fuente hay que
   commitearlo y pushearlo a `main` explícitamente o quedará solo en local.
2. La configuración de Pages (source = rama `gh-pages`) ya quedó hecha en el primer deploy; los
   `gh api -X PUT .../pages` y `POST .../pages/builds` que se usaron entonces **ya no hacen falta**.
3. El dataset (`public/data|images|videos`) está gitignored pero SÍ va dentro de `dist/` al buildear,
   así que `gh-pages` pesa ~150 MB por commit de deploy. Es esperado.
4. `vite preview` sirve el build local en `http://localhost:4173/ferro/` si quieres probarlo antes.
