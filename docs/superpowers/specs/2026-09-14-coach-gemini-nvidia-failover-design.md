# Diseño: Coach cloud con Gemini y NVIDIA

**Fecha:** 2026-09-14
**Estado:** aprobado por el usuario
**Alcance:** generación del Coach en `/v1/coach/runs`, cuotas de proveedores, consentimiento, telemetría, cuentas autorizadas y despliegue. También incluye las correcciones necesarias para que el plan de sesiones del Coach pueda declararse implementado.

## Objetivo

El Coach debe responder desde el teléfono aunque la PC del propietario esté apagada. La generación se ejecutará en el Worker de Cloudflare con `gemini-3.6-flash` como proveedor preferido y `deepseek-ai/deepseek-v4-flash-0731` en NVIDIA como respaldo. Ambos endpoints se usarán exclusivamente en sus niveles gratuitos.

No se usará OpenAI, Codex, GPT-5.6 Luna ni una API key de OpenAI. El Coach tampoco producirá una respuesta determinista cuando no haya una respuesta válida de un proveedor generativo.

## Alcance y límites

- La política se aplica a las conversaciones del Coach y sus runs durables.
- Los cálculos locales de volumen, PR, RIR, tendencias y validaciones de seguridad pueden seguir siendo deterministas. No pueden convertirse en un mensaje del Coach ni aparentar una respuesta generada.
- Si Gemini y NVIDIA no producen una respuesta válida, el run termina en `failed` con un error recuperable. La PWA conserva la conversación y ofrece reintentar; no inserta un mensaje de asistente.
- La integración no activa funciones facturables, grounding, búsqueda ni herramientas externas de Gemini.
- Las credenciales viven solamente en secretos del Worker y nunca se incluyen en el bundle público, D1, logs o respuestas.
- Se conservan todos los invariantes de `AGENTS.md`, especialmente la base IndexedDB `ferro`, las claves de `localStorage`, `/ferro/`, los pesos en kg y las migraciones aditivas.

## Proveedores y selección

### Adaptadores

La generación se separará detrás de una interfaz común. Cada adaptador declara su identificador de proveedor, modelo, capacidad de streaming, timeout y forma de normalizar uso y errores.

- `GeminiGenerationProvider`: llama a la API Gemini con `gemini-3.6-flash`, salida JSON estructurada y el mismo contrato `agentWireResponseSchema` que valida hoy el Worker.
- `NvidiaGenerationProvider`: conserva el endpoint OpenAI-compatible de NVIDIA y el modelo `deepseek-ai/deepseek-v4-flash-0731`.
- `CoachGenerationRouter`: selecciona proveedor, reserva cuota, registra el intento y ejecuta como máximo un intento enviado por proveedor para cada llamada lógica del protocolo del agente.

No existirá un adaptador local ni un adaptador OpenAI. Cambiar de proveedor en el futuro requerirá configuración y un adaptador, no cambios en la PWA ni en el contrato durable.

### Orden y failover

1. Gemini es el primer candidato siempre que su circuito y sus cuotas permitan reservar la llamada.
2. Si Gemini no puede reservar o falla, se intenta NVIDIA inmediatamente si su circuito y cuota lo permiten.
3. Si una ejecución comienza con NVIDIA porque Gemini estaba temporalmente no disponible, NVIDIA puede caer hacia Gemini únicamente cuando el gate de Gemini ya permita una prueba half-open. No se ignora un circuito abierto para forzar la llamada.
4. Nunca se reintenta el mismo proveedor dentro de la misma llamada lógica y nunca se alterna en bucle. El máximo es dos solicitudes generativas enviadas.
5. Son fallos aptos para failover: error de red, timeout, `408`, `429`, `5xx`, respuesta vacía, rechazo sin contenido utilizable, truncamiento, JSON inválido o incumplimiento del esquema/contrato del Coach.
6. Un error de autenticación o configuración también permite usar el otro proveedor, pero queda registrado como fallo operativo no transitorio.
7. Una respuesta solo se acepta después de validar completamente JSON, contrato, referencias RAG y operaciones propuestas. Un parcial de streaming jamás es aplicable.

Los circuitos son independientes y compartidos entre isolates mediante D1. Se abren tras fallos consecutivos configurables, respetan `Retry-After` cuando existe y conceden una sola prueba half-open al terminar el enfriamiento.

## Cuotas gratuitas

### NVIDIA

NVIDIA se contabiliza únicamente por solicitudes. El límite global es de 40 RPM para la API key y se comparte entre ambas cuentas, generaciones, embeddings y cualquier otro endpoint que use la misma credencial.

- `NVIDIA_REQUESTS_PER_MINUTE=40` es la fuente de configuración.
- D1 coordina un token bucket global para impedir que distintos isolates o usuarios excedan el límite.
- Las reservas no se devuelven después de despachar una solicitud, aunque la respuesta falle o se desconozca.
- El despacho se espacia de forma segura y honra `Retry-After` en respuestas `429`.
- Se elimina para NVIDIA cualquier gate semanal o diario basado en tokens. Los tokens observados pueden conservarse solo como telemetría diagnóstica, nunca como saldo o autorización.

### Gemini

Gemini se limita por proyecto, no por API key. El Worker aplicará de forma coordinada las tres dimensiones publicadas por Google:

- `GEMINI_REQUESTS_PER_MINUTE`: solicitudes por minuto.
- `GEMINI_INPUT_TOKENS_PER_MINUTE`: tokens de entrada por minuto.
- `GEMINI_REQUESTS_PER_DAY`: solicitudes por día; la ventana reinicia a medianoche del Pacífico.

Los valores se tomarán de los límites efectivos mostrados para el proyecto gratuito en Google AI Studio antes del despliegue. No se inventarán constantes ni se usarán límites de un tier pagado.

Antes de enviar, el Worker reserva una solicitud y una estimación conservadora de tokens de entrada. Después actualiza la contabilidad con `usageMetadata` cuando esté disponible. El contexto se reducirá antes del envío mediante límites de historial, selección RAG y topes explícitos; no se resumirá mediante una llamada adicional. Una respuesta sin metadatos se cobra contra el gate con la estimación reservada.

Para mantener el uso gratuito:

- el proyecto de Google usado para la clave debe permanecer en el Free tier sin facturación activada;
- se usa la API estándar sin grounding, búsqueda, batch, priority ni herramientas con coste;
- el probe de despliegue realiza una sola llamada mínima y también consume cuota;
- si el límite diario se agota, Gemini queda inhabilitado hasta el siguiente reset y el tráfico pasa a NVIDIA.

## Persistencia y contabilidad

Una migración D1 aditiva añadirá ventanas de cuota y estado de circuitos sin borrar las tablas históricas. `coach_run_attempts` seguirá siendo el ledger durable de intentos y se ampliará de forma compatible para distinguir `provider` y `model`.

Cada intento registra:

- proveedor, modelo y número lógico;
- si fue reservado, enviado, completado, fallido o incierto;
- clase de error y `retryAfterMs`;
- tokens de entrada/salida medidos por Gemini, cuando existan;
- timestamps, sin prompts, datos de salud ni credenciales.

La idempotencia sigue asociada al run y a la huella de la llamada. Un reinicio del Workflow nunca vuelve a enviar un intento marcado `sent` con resultado incierto. El segundo proveedor es un intento nuevo y explícito, no una repetición accidental.

## Respuesta cuando ambos proveedores fallan

El run termina como `failed` con uno de los códigos estables de transporte o proveedor. No se persiste `decision_json`, no se crea un mensaje del asistente y no se devuelve `coachUnavailable` ni otra decisión sintética.

La PWA:

- conserva el mensaje del usuario y el borrador posterior;
- muestra un estado breve de indisponibilidad, no una recomendación de entrenamiento;
- permite reintentar creando un nuevo intento idempotente/reconciliable;
- sigue recuperando por GET después de resultados inciertos y al recargar;
- nunca duplica mensajes o aplica un parcial.

## Streaming

El streaming permanece detrás de `ENABLE_COACH_STREAMING`. La generación completa validada es la única respuesta aplicable. Si un adaptador no puede garantizar parciales seguros del campo `decision.explanation`, el Worker usa respuesta completa para ese proveedor.

Cuando SSE esté habilitado, una desconexión del canal cliente no inicia otra generación. La PWA cae a polling autenticado del mismo run. Los snapshots terminales representan `completed`, `failed` o `cancelled`; un snapshot fallido no contiene texto de Coach.

## Identidad, consentimiento y privacidad

La allowlist de producción contiene exactamente estas cuentas:

- `user_3ITDXf8hPt81kAjzS3Dw8U77qfE`
- `user_3JLkakQ34GXgGQhWGAWSfrLW3TB`

Ambas pasan por la misma autenticación Clerk, autorización por propietario, límites de concurrencia y cuotas globales de proveedor. Cada dispositivo debe registrar el consentimiento vigente antes de enviar contexto.

El consentimiento indicará expresamente que los datos seleccionados del entrenamiento pueden enviarse a Google Gemini o NVIDIA. También advertirá que, según la tabla de precios de Google, el contenido del Free tier puede utilizarse para mejorar sus productos. Importar un backup no convierte un consentimiento de otro dispositivo en autorización vigente.

## Configuración de producción

Variables no secretas previstas:

| Variable | Valor o regla |
|---|---|
| `COACH_PROVIDER_ORDER` | `gemini,nvidia` |
| `GEMINI_MODEL` | `gemini-3.6-flash` |
| `GEMINI_REQUESTS_PER_MINUTE` | Obligatoria y sin valor predeterminado; se copia del límite efectivo de AI Studio. |
| `GEMINI_INPUT_TOKENS_PER_MINUTE` | Obligatoria y sin valor predeterminado; se copia del límite efectivo de AI Studio. |
| `GEMINI_REQUESTS_PER_DAY` | Obligatoria y sin valor predeterminado; se copia del límite efectivo de AI Studio. |
| `NVIDIA_MODEL` | `deepseek-ai/deepseek-v4-flash-0731` |
| `NVIDIA_REQUESTS_PER_MINUTE` | `40` |
| `ENABLE_GEMINI` | `true` |
| `ENABLE_NVIDIA` | `true` |

Secretos:

```text
GEMINI_API_KEY
NVIDIA_API_KEY
```

El Worker fallará cerrado para el proveedor cuya configuración sea incompleta. El endpoint autenticado de readiness mostrará capacidades y nombres de modelo, nunca secretos ni saldos sensibles.

## Correcciones del plan original incluidas

Antes del despliegue también se corregirán los fallos reproducidos durante la auditoría del plan:

- timeout del cliente que hoy no cubre el consumo completo del body;
- botón de reintento que hoy solo refresca por GET;
- migración v9→v10 que no asigna correctamente `conversationId` a runs antiguos ni normaliza secuencias;
- posible pérdida del primer borrador durante la carga de la conversación;
- clasificación de `provider-circuit-open` como error recuperable;
- restauración y validación estricta de entidades del Coach sin importar consentimiento como autorización;
- scroll de transcript durante snapshots y fallback efectivo de SSE a polling;
- documentación de flags, migraciones, costes operativos y rollback;
- pruebas de regresión, accesibilidad, persistencia y rendimiento exigidas por las sesiones del plan.

Las correcciones se implementarán con pruebas de regresión primero y respetando todos los cambios preexistentes del worktree.

## Pruebas y gates

### Unitarias y de integración

- Gemini exitoso: NVIDIA no recibe llamadas.
- Gemini falla por cada clase recuperable: NVIDIA recibe exactamente una llamada.
- Gemini no tiene cuota: NVIDIA es primero sin gastar una reserva Gemini.
- NVIDIA primero falla y Gemini admite half-open: Gemini puede completar el run.
- Ambos fallan: run `failed`, sin `decision_json` y sin mensaje de asistente.
- JSON o contrato inválido activa failover y nunca se aplica.
- Dos usuarios e isolates concurrentes respetan globalmente 40 RPM de NVIDIA.
- Gemini respeta RPM, TPM de entrada y RPD del proyecto, incluido el reset diario del Pacífico.
- Reinicio de Workflow no repite un intento `sent` o incierto.
- Los secrets no aparecen en build, logs, errores, backups ni endpoints.
- Las regresiones identificadas en la auditoría tienen pruebas específicas.

### Verificación local

Se ejecutarán `npm run check`, `npm run test:worker`, los E2E generales y los E2E del Coach. Las pruebas de proveedor usarán fetch simulado; una prueba remota mínima se ejecutará después del despliegue con las claves reales y las cuentas autorizadas.

### Despliegue

1. Confirmar que el proyecto Gemini está en Free tier y leer sus tres límites efectivos.
2. Configurar `GEMINI_API_KEY` como secreto y verificar `NVIDIA_API_KEY` existente.
3. Desplegar primero la PWA desde `main` y comprobar su `version.json`.
4. Aplicar migraciones D1 aditivas pendientes.
5. Desplegar el Worker de producción.
6. Verificar `/health`, CORS, autorización de ambas cuentas, readiness y un run real mínimo.
7. Confirmar telemetría: Gemini fue preferido, no hubo fallback innecesario y las cuotas se contabilizaron.

El rollback desactiva Gemini o NVIDIA mediante flags y orden de proveedores, sin revertir ni borrar migraciones D1. Si ambos se desactivan, el Coach queda explícitamente no disponible y no genera una respuesta determinista.

## Criterios de aceptación

- El Coach responde en el teléfono con la PC apagada.
- Gemini 3.6 Flash atiende las solicitudes normales; NVIDIA DeepSeek solo recibe fallback o tráfico cuando Gemini no está disponible.
- No existe uso de OpenAI/Codex/Luna.
- Ningún fallo de proveedores produce una respuesta determinista del Coach.
- NVIDIA nunca excede el gate coordinado de 40 RPM y no se bloquea por tokens.
- Gemini respeta los tres límites reales del proyecto gratuito.
- Las dos cuentas Clerk pueden usar el Coach tras consentimiento vigente.
- El plan original queda verificado con pruebas, documentación y despliegue remoto comprobable.

## Fuentes de límites y modelo

- [Gemini 3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)
- [Límites de Gemini API](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Precios de Gemini Developer API](https://ai.google.dev/gemini-api/docs/pricing)
- [NVIDIA API Documentation](https://docs.api.nvidia.com/)
- [NVIDIA NIM FAQ](https://forums.developer.nvidia.com/t/nvidia-nim-faq/300317)
