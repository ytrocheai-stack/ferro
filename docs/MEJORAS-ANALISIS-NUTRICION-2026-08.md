# Navegación, Análisis y Nutrición — agosto de 2026

Esta entrega aplica la jerarquía tipográfica de la opción B y los gradientes azul–violeta de la
opción C con movimiento sutil. La fuente de verdad visual queda en
[`../design-system/nextrep/MASTER.md`](../design-system/nextrep/MASTER.md).

## Revisión UI

| Área | Antes | Después | Por qué |
|---|---|---|---|
| Navegación móvil | Barra plana pegada al borde | Dock flotante con safe area, targets de 44 px y estado activo en gradiente | Mejora jerarquía, pulso táctil y legibilidad sin tapar contenido |
| Navegación escritorio | Mismo patrón móvil estirado | Rail vertical junto al contenido | Aprovecha el ancho y conserva un área de lectura enfocada |
| Rutas secundarias | Análisis y Medidas sin contexto activo fiable | Perfil permanece activo mediante mapeo explícito | Evita que el usuario pierda orientación |
| Análisis | Lista extensa de ceros y volumen sin contexto | Pulso del periodo, comparación, constancia, PRs, fuerza por e1RM, gráfica semanal y dosis muscular compacta | Convierte historial en decisiones y elimina ruido |
| Nutrición | Diario y tendencia básica mezclados | Pestañas Diario/Tendencias, gasto estimado, adherencia, cobertura, gráfica y lectura del coach | Separa registro diario de evaluación de tendencia y declara la confianza |
| Importación Hevy | Selector de archivo sin indicar dónde obtenerlo | Ruta oficial visible, enlace a ayuda, MIME tolerante en Android y estados claros | Resuelve la causa del selector vacío y reduce errores de formato |
| GIFs offline | Botón visible incluso con la biblioteca completa | Conteo contra el catálogo vigente y confirmación de completitud | Las entradas antiguas de caché ya no inflan el progreso |

## Cambios funcionales

### Análisis

- Selector de 4, 8 y 12 semanas con comparación contra el periodo anterior.
- Carga total, sesiones, series efectivas, eventos de PR y constancia respecto al objetivo semanal.
- Evolución semanal con media del periodo y tooltip con sesiones/series.
- Momentum por ejercicio usando cambio de e1RM entre sesiones, sin clasificar ejercicios de una sola aparición.
- Dosis muscular de siete días en resumen visual y detalle contra el rango recomendado.

### Nutrición

- Tendencias de 14 días con huecos explícitos para días sin registro.
- Adherencia calórica dentro de ±10%, proteína al 90% o más y cobertura de registro.
- Gasto energético estimado con balance de energía: ingesta media menos cambio de peso × 7700 kcal/kg.
- La estimación requiere al menos 70% de cobertura, tres pesajes y 14 días de separación dentro de
  la misma ventana analizada. Pesajes históricos fuera de la ventana se ignoran.
- Confianza baja/media/alta y estado vacío honesto cuando faltan datos.

## Causas raíz corregidas

1. **Hevy:** Android abría correctamente el selector, pero la app no explicaba que primero había que
   exportar el CSV en Hevy. Se añadió la ruta oficial y compatibilidad con MIME variables.
2. **GIFs:** se mostraba la acción por disponibilidad del service worker, no por el estado real del
   catálogo. Ahora se comparan rutas canónicas únicas contra Cache Storage.
3. **Navegación:** `NavLink` solo reconocía coincidencias nativas y perdía el estado en rutas
   secundarias. El estado actual ahora se calcula de forma explícita.
4. **Nutrición:** una regresión sobre todos los pesajes podía mezclar periodos incompatibles. Solo se
   consideran mediciones de la ventana vigente.

## Cobertura añadida

- Unitarias: comparación de periodos, progreso por ejercicio, estado de caché GIF y tendencias nutricionales.
- Componentes: navegación accesible/relacionada y guía de importación Hevy.
- E2E: selector de periodo, separación Diario/Tendencias, estado vacío y flujo real de carga CSV.
- Fixtures reproducibles: CSV de Hevy y backup nutricional de 14 días.
