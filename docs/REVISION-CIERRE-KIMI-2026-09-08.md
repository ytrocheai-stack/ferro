# Revisión del cierre Kimi — 2026-09-08 UTC

## Resultado del diagnóstico

El reporte anterior confundió ausencia de variables cargadas con ausencia de credenciales. No se conserva evidencia suficiente para atribuirle un comando concreto, pero sí se refutó la afirmación: `.env.providers.local` contiene las tres credenciales de proveedor/Cloudflare y el Worker conserva `NVIDIA_API_KEY` como secreto. `GET /v1/models` autenticado respondió HTTP 200 y confirmó `moonshotai/kimi-k3`. No se registraron valores de secretos.

El cargador del benchmark y laboratorio ya existía. Se reforzó para resolver el archivo desde el repositorio independientemente del directorio de trabajo y para tratar variables con solo espacios como ausentes. Una regresión reprodujo este último caso antes de corregirlo. Se añadió `npm run provider:doctor -- --verify-remote` para impedir repetir un diagnóstico basado únicamente en el entorno del shell.

## Autorización vigente

El usuario autorizó expresamente completar el trabajo y desplegarlo. También autorizó ampliar de 3.500 a **4.500 intentos totales**, manteniendo **40 RPM** y **coste adicional cero**. El archivo local de autorización conserva el diario previo: 2.722 intentos, 2.706 completados, 13 rechazados y tres pendientes. Quedan 1.778 intentos. Los pendientes no se borraron, no se convirtieron en éxitos y no se reenviaron.

La petición autoriza las operaciones de publicación; no constituye evidencia de aprobación de calidad de un candidato todavía no evaluado ni confirmación de una propuesta de entrenamiento que el usuario no ha visto.

## Defectos que el cierre anterior no resolvió

- `CoachRunWorkflow` tiene preparación y un paso de diez minutos que contiene todo el bucle; no tiene pasos durables separados por llamada/herramienta/persistencia. `executeCoachRun` solo reclama filas `queued`, por lo que su rama de recuperación de respuestas no acredita recuperación de una ejecución `running` interrumpida.
- `runAgentLoop` existe, pero Worker y laboratorio mantienen sus propios bucles. Compartir instrucciones y el esquema de herramientas no acredita el motor compartido requerido por el plan.
- El laboratorio/local limita solicitudes mediante archivo y el Worker mediante D1. No comparten el límite global ni el presupuesto total. Las flags remotas se mantienen apagadas durante esta revisión.
- Las 88 fuentes y los 2.708 fragmentos del manifiesto tienen `populationReviewed` sin aprobar. El recuperador de recomendaciones los excluye; habilitar el agente no lo haría apto para proponer cambios sustentados. No se alteraron estas etiquetas para aprobar un gate.
- El consentimiento sigue denominado `coach-beta-v1` pese a la ampliación de contexto. Falta completar el cambio de versión y su regresión de aceptación renovada.
- Los resultados Kimi existentes son 24/300. Antes de generar más, resolver los cambios que alteren huellas, revisar aplicabilidad y congelar el candidato. No se gastaron llamadas de generación en un candidato cuya implementación no cumple todavía el plan.

## Verificación y preparación de publicación

- `npm run check` pasó antes de los cambios de diagnóstico; se vuelve a ejecutar antes de publicar.
- Worker: 49 pruebas. E2E general: 13 aprobadas y un skip preexistente. E2E coach: dos aprobadas, Chromium y WebKit, con proveedor simulado.
- D1 se exportó a `.cache/corpus/hevy/d1-backup-before-publication-2026-09-08.sql`. Se restauró en SQLite aislado, se aplicaron ambas migraciones y `PRAGMA integrity_check` devolvió `ok`; se conservaron 88 fuentes y 2.708 fragmentos.
- Se aplicaron remotamente únicamente `0012_coach_attempts.sql` y `0013_coach_conversations.sql`, que estaban pendientes.
- La publicación de infraestructura se realiza con todos los flags apagados. No equivale a apertura del coach ni a un canario aprobado.
- El build genera `version.json` con el commit para comprobar qué PWA se sirve realmente.

Los informes locales del diagnóstico, estado de gates, respaldo y restauración están en `.cache/corpus/hevy/`. No contienen una aprobación inventada de benchmark, laboratorio, canario o 24 horas.
