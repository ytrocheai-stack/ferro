---
name: NextRep
description: Fitness móvil con materiales de titanio y champagne, vidrio y superficies de lectura.
colors:
  bg: "#F3F0EA"
  surface: "#FCFAF6"
  surface-2: "#EAE5DC"
  border: "#D8D1C5"
  text: "#292723"
  muted: "#6D675E"
  primary: "#79603A"
  primary-strong: "#DEC8A3"
  on-primary: "#352A1B"
  accent: "#827B70"
  success: "#18794E"
  warning: "#925800"
  danger: "#C93436"
  glass-fill: "rgb(255 253 248 / 0.70)"
  glass-solid: "#F9F6EF"
  glass-edge: "rgb(255 255 255 / 0.85)"
  glass-reflection: "rgb(255 255 255 / 0.58)"
  glass-selected: "rgb(255 253 247 / 0.92)"
  ambient-warm: "rgb(209 183 137 / 0.28)"
  ambient-cool: "rgb(168 179 182 / 0.19)"
  input-border: "#AAA194"
  bg-dark: "#171715"
  surface-dark: "#242420"
  surface-2-dark: "#30302A"
  border-dark: "#45433B"
  text-dark: "#F4F0E8"
  muted-dark: "#B8B1A4"
  primary-dark: "#E2CBA4"
  primary-strong-dark: "#DEC8A3"
  on-primary-dark: "#352A1B"
  accent-dark: "#ACA99E"
  success-dark: "#63D99A"
  warning-dark: "#F3BE65"
  danger-dark: "#FF8587"
  glass-fill-dark: "rgb(43 43 37 / 0.76)"
  glass-solid-dark: "#2A2A25"
  glass-edge-dark: "rgb(230 218 194 / 0.18)"
  glass-reflection-dark: "rgb(233 219 188 / 0.07)"
  glass-selected-dark: "rgb(215 195 161 / 0.15)"
  ambient-warm-dark: "rgb(182 146 86 / 0.14)"
  ambient-cool-dark: "rgb(151 165 162 / 0.08)"
  input-border-dark: "#777367"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: "38px"
    letterSpacing: "-0.025em"
  title:
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "-0.02em"
  sheet-title:
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontSize: "16px"
    lineHeight: "24px"
  label:
    fontSize: "14px"
    lineHeight: "20px"
  navigation:
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "14px"
rounded:
  input: "12px"
  control: "14px"
  card: "20px"
  glass: "24px"
  sheet-top: "28px"
  pill: "999px"
spacing:
  tight: "4px"
  stack: "8px"
  control: "12px"
  compact-page: "16px"
  page: "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    padding: "10px 12px"
---

# Design System: NextRep

## Overview

Interfaz fitness móvil de carácter Apple premium, con titanio cálido y champagne. El vidrio aporta profundidad a los planos superpuestos y a los resúmenes; las superficies de lectura mantienen listas, formularios y tablas nítidos. Esta documentación describe el sistema construido, cuya fuente de implementación es `src/index.css` y los componentes compartidos.

Características: jerarquía tipográfica sobria, controles táctiles amplios, cinco destinos estables, respuesta breve y dos apariencias completas. No se ha establecido una metáfora de marca adicional ni existe un PRODUCT.md confirmado.

## Colors

La paleta combina neutros cálidos y acentos champagne. Los valores sin sufijo corresponden al tema claro; `-dark` contiene sus equivalentes oscuros. Las primitivas del frontmatter reproducen los valores CSS, incluidos los materiales translúcidos.

### Primary

`primary` identifica selección, enlaces y cifras destacadas. `primary-strong` rellena la acción principal; `on-primary` conserva su tinta oscura en ambos temas. `success`, `warning` y `danger` expresan estado funcional.

### Neutral

`bg` sostiene la página; `surface` y `surface-2` organizan lectura y campos; `text`, `muted` y `border` establecen jerarquía. `accent` aporta el matiz titanio. La familia `glass` define relleno, alternativa sólida, borde, reflejo y selección; `ambient-warm` y `ambient-cool` iluminan el fondo de forma estática.

Apariencia admite sistema, claro y oscuro. La preferencia se persiste y se resuelve antes del montaje; en modo sistema acompaña sus cambios. También se actualizan `color-scheme` y el color del navegador.

## Typography

El stack del sistema sirve a toda la interfaz; las cifras de registro usan números tabulares y el resto números proporcionales. Los títulos de página siguen `headline`, las secciones `title` y los paneles `sheet-title`. Los cuerpos y etiquetas conservan lectura cómoda; el dock usa su escala compacta propia. A anchuras de hasta 360 px, el título pasa a 28/34 px.

## Layout

La aplicación se centra en una columna de hasta 448 px, con ancho mínimo de 320 px. Los márgenes internos son 20 px y bajan a 16 px hasta 360 px. Las cabeceras permanecen visibles con respeto al área segura superior. Se conserva el zoom del navegador.

El dock inferior apila avisos, descanso, sesión, compositor Coach, teclado numérico y navegación. Mide su altura real para reservar espacio de contenido y respeta el área segura inferior. Se eleva con el teclado del sistema mediante el viewport visual y oculta las tabs durante edición numérica o apertura del teclado. Un modal oculta el dock y el teclado numérico.

Entrenar, Nutrición, Coach, Progreso y Biblioteca son los cinco destinos; Coach ocupa el centro. Perfil se abre desde la cabecera. Progreso usa navegación interna y Nutrición controles segmentados. Las series se registran en tabla, sin convertir cada celda en una tarjeta decorativa.

## Elevation & Depth

El sistema combina capas tonales, bordes, sombras suaves y vidrio. Las tarjetas de lectura mezclan surface al 92% y tienen sombra en ambos temas. Los resúmenes de vidrio, cabeceras, navegación, accesorios del dock, sheets y toasts usan desenfoque de 20 px, saturación 1.15 y reflejo diagonal cuando el navegador lo soporta. El sheet eleva la opacidad del relleno para mantener legibilidad. Las sombras exactas viven en el sidecar.

Sin soporte de desenfoque, los planos de vidrio usan una alternativa sólida; con transparencia reducida se elimina el filtro. Las listas y tablas no reciben desenfoque. La iluminación ambiental es estática y no captura interacción.

## Shapes

Campos suavemente redondeados, controles de 14 px, tarjetas de 20 px y paneles de vidrio de 24 px forman la familia. Los sheets tienen esquinas superiores de 28 px; chips y barras de progreso usan extremos de píldora. Bordes finos delimitan lectura y bordes reflectantes distinguen el vidrio.

## Components

### Buttons

Acciones principales champagne con tinta `on-primary`, altura mínima de 50 px y peso semibold. Las secundarias usan surface-2; las destructivas una mezcla tenue de danger con texto danger. La presión escala a 0.97 durante 120 ms y el estado deshabilitado reduce la opacidad a 0.45. Con puntero fino, hover aumenta ligeramente el brillo. El foco visible lleva contorno de 2 px con separación de 2 px.

### Inputs / Fields

Campos de al menos 44 px con texto de 16 px, borde específico de entrada y fondo surface-2. El foco cambia el borde a primary y añade un halo al 15%. Etiquetas, ayuda y errores se presentan con jerarquía compartida. El teclado numérico de entrenamiento pertenece al dock para preservar el espacio de edición.

### Chips

Filtros de píldora de al menos 44 px. La selección cambia borde y texto a primary con fondo mezclado al 10%; el estado no seleccionado usa surface-2.

### Cards / Containers

Tarjetas de lectura con borde y sombra tenue; paneles de resumen de vidrio con borde reflectante, profundidad y padding de 20 px. Los estados vacíos reúnen icono, título, explicación y acciones sobre surface. Perfil utiliza disclosures para agrupar contenido secundario.

### Navigation

Dock de cinco columnas con destinos de al menos 56 px, icono y etiqueta persistente. El destino activo adopta primary y glass-selected. La navegación es inmediata; no se animan entradas de página. La navegación segmentada conserva áreas táctiles de al menos 44 px.

### Sheets

Diálogo modal inferior, hasta 85dvh o 92dvh en variante completa, con scroll interno. Entrada de 220 ms y salida de 160 ms; la salida mantiene el panel hasta terminar. El handle sigue el dedo con Pointer Events; una cancelación vuelve al origen y el arrastre descendente suficiente cierra. El título o panel recibe foco inicial, Tab queda dentro del modal superior y Escape solo cierra ese modal. El fondo permanece inerte, el bloqueo de scroll admite anidación y el foco vuelve al disparador conectado cuando es seguro.

### Toasts y descanso

Los avisos se anuncian cortésmente sin robar foco. Sus temporizadores se pausan por razones independientes: documento oculto, modal abierto o foco en una acción. La salida dura 160 ms y desactiva la acción. El progreso de descanso usa scaleX y una transición lineal breve.

Con movimiento reducido, las transiciones pasan a 100 ms, el sheet usa opacidad y se eliminan traslaciones de toast y escalados de presión; el progreso de descanso y los disclosures cambian sin transición.

## Do's and Don'ts

- **Do** reutilizar los tokens semánticos en ambos temas y reservar on-primary para el fondo de acción principal.
- **Do** usar vidrio en resúmenes y planos superpuestos con su alternativa sólida y soporte de transparencia reducida.
- **Do** mantener lectura nítida en series, listas y campos, y objetivos táctiles de al menos 44 px.
- **Do** reservar la altura medida del dock y respetar las áreas seguras.
- **Don't** limitar el vidrio únicamente a cabeceras y navegación: el sistema implementado también lo usa en resúmenes, sheets y avisos.
- **Don't** añadir rebotes de series, entradas de página o transiciones universales que retrasen el registro.

La evidencia de verificación y sus límites se registran en [la revisión visual](artifacts/premium-ui/REVIEW.md). El cierre incluyó npm run check (241 tests y build), premium E2E (6/6 en Chromium/WebKit) y Coach E2E (2/2 con proveedor simulado).
