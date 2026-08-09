# Changelog

## 1.2.0 — 2026-08-09

- Rediseñada la navegación como dock flotante en móvil y rail en escritorio, con safe areas, foco accesible y estado correcto en rutas secundarias.
- Reconstruido Análisis con periodos comparables, pulso de carga, constancia, PRs, progresión de e1RM, volumen semanal y dosis muscular compacta.
- Añadida Inteligencia nutricional de 14 días: cobertura, adherencia, gasto estimado, confianza, gráfica ingesta/meta y lectura accionable.
- La estimación nutricional ahora usa solo pesajes de la ventana vigente y evita mezclar mediciones históricas incompatibles.
- Corregido el flujo de importación Hevy con la ruta oficial de exportación, ayuda visible y MIME tolerante en Android.
- Corregido el estado de descarga offline de GIFs: el botón desaparece cuando el catálogo vigente está completo y entradas obsoletas no inflan el conteo.
- Añadidos tests unitarios, de componentes y E2E, además de fixtures reproducibles para Hevy y Nutrición.
- Documentados el sistema visual, las causas raíz y la revisión Antes/Después/Por qué.

## 1.1.0 — 2026-08-08

- Añadida importación Hevy por CSV/API con paginación, referencias externas, lotes y deshacer.
- Corregido el recálculo de volumen, series y PRs al editar entrenos históricos.
- Backups JSON y fotos validados con Zod, límites de tamaño y transacciones sin mutaciones parciales.
- Añadidos snapshots fijados de USDA FoodData Central y wger, con hashes/licencias documentados.
- Mejorada la búsqueda nutricional: favoritos/recientes de forma determinista, alias y cache USDA.
- Open Food Facts actualizado al endpoint v3.6 para códigos de barras y con límites de frecuencia.
- Catálogo de ejercicios complementado con wger y lista larga virtualizada.
- Renovada la superficie visual con gradientes técnicos sutiles, jerarquía B, foco accesible y targets táctiles.
- Añadidos Vitest, Playwright, axe, ESLint y workflow de GitHub Pages reproducible.
