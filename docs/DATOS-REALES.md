# Datos reales y snapshots reproducibles

NextRep usa datos remotos únicamente para enriquecer catálogos. El diario y el historial siguen siendo locales. `scripts/fetch-real-data.mjs` descarga y normaliza dos fuentes en archivos pequeños, registra licencia, fecha y SHA-256 en `data/sources.lock.json`, y copia los artefactos al directorio ignorado `public/data/`.

```bash
npm run fetch-real-data       # usa snapshots ya presentes
node scripts/fetch-real-data.mjs --refresh
```

El snapshot USDA conserva el nombre oficial en inglés y los macronutrientes por 100 g; la UI puede mostrar alias de búsqueda sin sustituir ese nombre. El snapshot wger se incorpora como suplemento, manteniendo prioridad del catálogo principal cuando el nombre normalizado coincide.

Open Food Facts no se empaqueta: se consulta bajo demanda para códigos de barras/búsqueda, se cachea en IndexedDB y se limita la frecuencia para respetar sus límites públicos. Sus datos son comunitarios y pueden contener errores; la app no los presenta como equivalentes a los datos USDA.
