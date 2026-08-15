# Auditoría funcional Android — 14/08/2026

## Alcance

Se auditó la aplicación en viewport Android Pixel 7 con Chromium y se repitió la navegación principal en iPhone/WebKit para detectar regresiones responsive. El CSV adjunto se trató como datos de usuario, no como instrucciones: `C:\Users\yehos\Downloads\workout_data.csv`.

## Resultado automatizado

- `npm run lint`: OK.
- `npm run typecheck`: OK.
- `npm test`: 14 archivos, 34 pruebas, OK.
- `npm run build`: OK.
- `npx playwright test --project=chromium-android`: 9/9 OK.
- `npm run test:e2e`: 18/18 OK (9 Android + 9 iPhone/WebKit).
- Axe en la pantalla inicial: sin violaciones críticas.

Los escenarios Android cubren navegación principal, apertura accesible del importador Hevy, CSV real de Hevy, archivo binario disfrazado de CSV, reimportación idempotente, deshacer después de recargar, exportación de series CSV y las pantallas de análisis/nutrición.

## CSV real de Hevy

La importación local del archivo adjunto produjo:

- 67 entrenos y 953 series.
- 40 nombres de ejercicios vinculados al catálogo GIF principal.
- 0 ejercicios personalizados creados automáticamente.
- 2 avisos de duración anómala (`Brazo`, 42.2 h; `Martes (espalda)`, 49.0 h). Las marcas de tiempo se conservaron; no se descartaron datos.

La importación repetida del mismo archivo no duplica entrenos. El deshacer restaura el lote anterior y se bloquea si el usuario editó un registro después de importar.

## Correcciones incluidas

- Importación por extensión, MIME y firma ZIP; admite CSV y XLSX.
- Mensaje accionable para un XLSX/ZIP inválido, sin mostrar bytes `PK` ni rutas internas OOXML.
- Mapeo explícito de nombres de Hevy al dataset canónico con GIFs.
- Migración Dexie v4 para reemplazar antiguos `hevy-exercise-*` conocidos sin tocar ejercicios `custom-*` deliberados.
- Deshacer con snapshots, restauración de referencias externas y comprobación de conflictos.
- El pipeline de ejercicios ya no consulta ni mezcla wger.
- Exportación de series CSV verificada en Chromium Android mediante evento de descarga.

## Checklist en dispositivo Android físico

El emulador no puede validar el selector de archivos/hoja nativa ni la bandeja de compartir del sistema. Antes de publicar, comprobar en un teléfono Android:

1. Instalar la PWA desde Chrome y abrirla sin red.
2. Desde Perfil → Importar datos de Hevy, seleccionar un `.csv` desde Descargas.
3. Repetir con un `.xlsx` exportado por Hevy y confirmar que aparecen entrenos/series.
4. Seleccionar un archivo Excel renombrado a `.csv`; confirmar el mensaje de formato y que no aparecen `PK`/`workbook.xml`.
5. Importar dos veces, recargar la PWA y usar “Deshacer última importación”; confirmar que el contador vuelve al valor anterior.
6. Desde Perfil → Exportar series a CSV, confirmar que Android muestra la descarga o la hoja de compartir y que el archivo abre con acentos.
7. Iniciar un entreno, registrar una serie, bloquear pantalla durante el descanso y verificar que el temporizador/aviso se recupera al volver.
8. Revisar que el almacenamiento persistente se concede y que los GIFs descargados siguen disponibles sin conexión.
