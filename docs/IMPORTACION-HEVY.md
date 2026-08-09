# Importación de Hevy

Desde **Perfil → Datos → Importar datos de Hevy** puedes elegir:

1. **CSV**: en Hevy abre **Perfil → Ajustes → Exportar e importar datos → Exportar datos → Exportar entrenamientos**. Después selecciona ese archivo en NextRep. La [guía oficial de Hevy](https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy) mantiene la ruta vigente. El exportador real usa columnas como `title`, `start_time`, `end_time`, `exercise_title`, `set_index`, `set_type`, `weight_kg`, `reps`, `distance_km`, `duration_seconds` y `rpe`; también puede incluir `description`, `exercise_notes` y `superset_id`. NextRep acepta esta variante y la anterior con `workout_id`/`workout_title`, agrupa filas por entreno, interpreta fechas localizadas como `19 mar 2026, 20:16`, conserva warmups, dropsets, fallo, notas, orden de serie, RPE, distancia y duración, y convierte kilómetros a metros.
2. **API Pro**: pega una API key de Hevy Pro. La app pagina automáticamente los endpoints de entrenos y rutinas (máximo 10 elementos por página), y también intenta obtener carpetas, plantillas y medidas.

Cada importación crea un lote en IndexedDB y referencias externas (`externalRefs`). Volver a importar el mismo ID actualiza el registro en lugar de duplicarlo. El botón **Deshacer última importación de Hevy** elimina los registros de ese lote y lo marca como deshecho.

La API key no se guarda en ajustes ni en backups. La importación se ejecuta desde el navegador; si el endpoint no está disponible, usa el CSV como ruta offline.

Los ejercicios se vinculan por nombre o alias del catálogo. Los nombres de Hevy que no se reconocen quedan como ejercicios personalizados y se muestran en el aviso posterior a la importación para poder revisarlos.

En Android el selector puede etiquetar el CSV como texto, Excel o archivo binario. NextRep acepta esas
variantes de MIME y valida el contenido al importarlo. Si la carpeta Descargas está vacía, vuelve a
Hevy y completa primero la exportación; el selector de NextRep no genera el archivo.
