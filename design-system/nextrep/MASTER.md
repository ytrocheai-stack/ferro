# Sistema visual de NextRep

> Fuente de verdad para nuevas pantallas y revisiones UI. Última actualización: 2026-08-09.

## Dirección

NextRep usa una estética OLED técnica y sobria. La jerarquía tipográfica sigue la opción B elegida
por el usuario; los gradientes azul–violeta de la opción C se reservan para estados activos, datos
destacados y profundidad ambiental. El resultado debe sentirse preciso y premium, no decorativo.

## Tokens

| Rol | Valor | Uso |
|---|---|---|
| Fondo | `#0b0b0f` | Lienzo OLED |
| Superficie | `#16161c` | Cards y dock |
| Superficie elevada | `#1f1f27` | Controles y cards anidadas |
| Borde | `#2a2a33` | Separación de bajo contraste |
| Primario | `#3d8bfd` | Acción y datos principales |
| Acento | `#8c72ff` | Gradientes y selección |
| Texto | `#f2f2f5` | Jerarquía principal |
| Texto secundario | `#8f8f9b` | Contexto y etiquetas |
| Éxito | `#33c076` | Tendencias favorables |
| Peligro | `#f4504f` | Borrado y alertas |
| Advertencia | `#f2a33c` | Atención moderada |

- Tipografía: `Inter, ui-sans-serif, system-ui, sans-serif`.
- Título de página: 24–28 px, 750–800, tracking negativo sutil.
- Título de sección: 15–18 px, 700–750.
- Texto funcional: mínimo 12 px; labels compactos solo si conservan contraste y legibilidad.
- Espaciado base: 4 px; padding habitual de card: 16 px; radio habitual: 16–20 px.

## Gradientes

- Activo: `linear-gradient(135deg, #3d8bfd, #8c72ff)`.
- Ambiental: halos azul/violeta con opacidad máxima de 12%; nunca detrás de texto largo.
- Datos: una sola serie principal azul; violeta para referencia o selección, no para competir.
- Evitar arcoíris, glow intenso y gradientes en cada superficie.

## Navegación

- Móvil: dock flotante inferior, cinco destinos, icono SVG consistente y etiqueta siempre visible.
- Escritorio: rail vertical junto al contenedor principal; no estirar una barra móvil a todo el ancho.
- El destino activo usa gradiente azul–violeta, `aria-current="page"` y contraste perceptible.
- Las rutas secundarias (`/analisis`, `/medidas`) mantienen **Perfil** activo.
- Respetar safe areas y reservar espacio para que ninguna acción quede bajo el dock.

## Movimiento e interacción

- Transiciones funcionales de 150–220 ms; entrada de página de 180 ms.
- Feedback de presión por color/sombra, sin saltos de layout.
- Hover solo en dispositivos con puntero fino.
- `prefers-reduced-motion: reduce` desactiva movimiento no esencial.
- Targets táctiles de al menos 44 × 44 px y foco de teclado visible.

## Datos y estados vacíos

- Cada métrica debe responder una pregunta: carga, frecuencia, progreso, adherencia o recuperación.
- Mostrar el periodo, la comparación y la calidad de los datos cerca del valor.
- Días sin registro son huecos, no ceros.
- No inventar puntuaciones opacas. Si la señal no es suficiente, explicar qué dato falta.
- Reducir muros de ceros: primero resumen/heatmap, después detalle compacto.

## Lista de entrega

- [ ] 393 px y 1024 px sin scroll horizontal ni contenido tapado.
- [ ] Navegación accesible por nombre, foco y estado actual.
- [ ] Contraste WCAG AA y sin violaciones axe críticas.
- [ ] SVG para iconos; sin emoji funcional.
- [ ] Estados loading, vacío, error y éxito explícitos.
- [ ] Cero errores o warnings de consola en los flujos modificados.
