# DESIGN.md · beBetterStudio

> **Dirección: «Sala de montaje».** Cine con disciplina. Fusión elegida el 2026-10-05 de
> tres propuestas exploradas en `propuestas/`: la **atmósfera** de *Sala de proyección* (01),
> la **estructura** de *Mesa de montaje* (02) y **un solo gesto** de *Cartel* (03).
> Contrato y decisiones: `docs/diseno/design-contract.md`.
> Instrucciones de construcción: `docs/diseno/implementation-handoff.md`.
> Vista previa de referencia: `propuestas/05-sala-de-montaje.html`.

Ámbito: la **interfaz** de beBetterStudio (la app interna). Las **piezas publicadas** (reels,
imágenes y carruseles) se rigen por la identidad de marca del vault (*Identidad Visual bebetter*)
y por `presets.ts`. Este documento no las toca.

---

## 1. Visual Theme & Atmosphere

**El reel es la pantalla y la app es la sala de montaje a oscuras.** Hay una zona, el
**escenario**, donde el preview 9:16 manda y la interfaz se retira (oscuridad, luz cálida
de proyector y grano de película). Todo lo demás es la **mesa**: el material ordenado, las
propiedades legibles, todo a un atajo de distancia.

- **Dos temperaturas en la misma pantalla.** Escenario = cine: aire, luz y lentitud.
  Mesa (barra lateral, banco, inspector) = disciplina: densidad, precisión e inmediatez.
  Nunca se mezclan. Una lista no «respira cinematográficamente» y el preview no lleva
  rejilla.
- **Solo tema oscuro.** Es una decisión de marca (*inferida*: las piezas son oscuras y la
  app se usa junto a ellas). No hay modo claro.
- **Escaparate.** Cada pantalla tiene que poder capturarse tal cual para
  `galacticaima.com/casos-de-exito` sin retocar nada.
- Palabras de control: **oscuro cálido, preciso, silencioso, cinematográfico**. No:
  futurista, neón, «SaaS dark», lujoso, juguetón.

## 2. Color

Tokens semánticos. **Ningún hex escrito a mano en componentes**: solo estos nombres. Los
carbones llevan el **mismo tono que el hueso** (≈80–85° en OKLCH), nunca gris puro.
Contraste medido en WCAG 2 sobre cada superficie donde se usa.

| Token | Hex | OKLCH | Rol | Contraste |
|---|---|---|---|---|
| `sala` | `#0C0B0A` | 0.150 0.003 68 | Lienzo del escenario y fondo base | — |
| `s1` | `#121110` | | Barra lateral, banco, inspector | — |
| `s2` | `#1A1815` | | Fila seleccionada, tarjeta, popover | — |
| `s3` | `#24211D` | | Hover fuerte y control presionado | — |
| `linea` | `#24231F` | | Separador (1px) entre zonas y filas | no texto |
| `linea-2` | `#33312C` | | Borde de tarjeta y miniatura | no texto |
| `borde-control` | `#6B665D` | 0.512 0.015 82 | Borde de input, botón secundario y foco inactivo | ≥3,1:1 (WCAG 1.4.11) |
| `hueso` | `#E8E4DC` | 0.920 0.012 85 | Texto principal | 13,9–15,5:1 |
| `hueso-2` | `#A8A39A` | 0.717 0.014 82 | Texto secundario | 6,4–7,8:1 |
| `hueso-3` | `#8A857C` | 0.618 0.015 82 | Metadatos, etiquetas y atajos. **Solo sobre `sala`, `s1` y `s2`** | 4,8–5,1:1 |
| `oro` | `#C5A059` | 0.725 0.100 82 | **Luz**: modo activo, foco, «en pantalla», contador de revisión. El mismo hex de marca | 7,2–8,0:1 |
| `sangre` | `#8B1A1A` | 0.416 0.148 27 | **Solo relleno** del botón Generar. Texto `hueso` encima | 7,3:1 |
| `sangre-hover` | `#A52222` | | Hover de Generar | 5,8:1 |
| `lacre` | `#E2655B` | 0.658 0.158 27 | Error, acción destructiva y marca del **giro** (`//`, segundo tiempo en Revisión) | 4,8–5,9:1 |
| `velo` | `rgba(12,11,10,.72)` | | Fondo tras un panel deslizante o modal | — |

Reglas que obligan:
1. **Un acento de acción (sangre) y una luz (oro).** El lacre no es acento: significa
   «error» o «giro». No hay azul, verde ni neón. Si hace falta indicar «éxito», se hace con
   `hueso` y un icono de check, no con verde.
2. **`sangre` nunca como texto ni como borde sobre carbón** (2,1:1, ilegible). Por eso se
   creó `lacre`, que es el mismo tono (27°) con luz.
3. **El oro es luz, no lujo.** Nunca como relleno de un botón grande. Como relleno solo en
   el contador de revisión (texto `sala` encima, 8:1).
4. **Se elimina `neon.red #FF3B3B`** (fuera de marca). Se deroga la excepción de «ámbito
   app» de la Decisión 3 de la identidad: ya no hace falta.
5. Luz de proyector del escenario: `radial-gradient(42% 70% at 50% 0%, rgb(197 160 89 / .12), transparent 70%)`.
   Es el único degradado decorativo de toda la app.

## 3. Typography

| Familia | Uso | Pesos |
|---|---|---|
| **IBM Plex Sans** | Toda la UI (la tipografía de cuerpo de la marca) | 300 · 400 · 500 · 600 |
| **IBM Plex Mono** | Cifras, contadores, atajos (`kbd`), horas y metadatos técnicos. Siempre `tabular-nums` | 400 · 500 |
| **IBM Plex Sans Condensed** | Etiquetas de sección en MAYÚSCULAS espaciadas, y solo en el escenario y el inspector | 500 |
| **Anton** | Display de marca, para **tres usos y ninguno más**: wordmark, el **giro** en Revisión y los estados vacíos o de entrada | 400 |
| **Inter Bold** | **Solo dentro del preview.** Es la fuente del render y debe medir igual que FFmpeg | 700 |

Escala (px, interlineado entre paréntesis):

| Token | Tamaño | Uso |
|---|---|---|
| `label` | 11 / 1.0, Condensed 500, MAYÚSCULAS, tracking .2em | Etiqueta de sección (FONDO, SONIDO). Máximo una por grupo |
| `meta` | 12 / 1.4, Mono | Usos, energía, horas, atajos |
| `ui` | 13 / 1.45 | Controles, filas densas, propiedades |
| `body` | 14 / 1.5 | Texto por defecto, frases en el banco |
| `lead` | 16 / 1.5 | Textos de pantallas completas |
| `title` | 26 / 1.1, peso 300, tracking -.01em | Título de panel («Frases», «Revisión») |
| `display` | Anton 40 / 0.98, MAYÚSCULAS | Giro en Revisión, estados vacíos |

- **Mínimo absoluto: 11 px**, y solo en `label`. Se acaban los `text-[9px]` y `text-[10px]`.
- La frase en el banco se muestra **en dos tiempos**: primer tiempo en `hueso`, giro en
  `hueso-2`, y el corte se marca con `//` en `lacre` (vista de fila) o con un salto de
  bloque (vista de lista).
- Las fuentes de la UI se sirven aparte de las del render: `data/fonts` y `/api/fonts` son
  del pipeline de FFmpeg y no se mezclan con la UI.

## 4. Spacing & Grid

- Base **4 px**. Escala: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56`.
- Radios (regla única):

| Radio | Dónde |
|---|---|
| `6px` | Controles: botón secundario, input, chip de filtro, `kbd`, menú |
| `10px` | Contenedores: tarjeta, popover, panel deslizante, miniatura grande |
| `14px` | **Solo** el preview del escenario |
| `999px` | **Solo** el botón Generar y el contador de revisión |

- Densidad de la mesa: altura de fila de banco ≥ 56 px (dos tiempos), fila de propiedad
  32 px, control 30–32 px, objetivo táctil ≥ 40 px en móvil.
- Separación por **líneas de 1 px (`linea`)** y espacio, no por tarjetas. Las tarjetas solo
  existen donde hay elevación real (popover, panel deslizante).

## 5. Layout & Composition

**Escritorio (≥1280 px): cuatro columnas fijas.**

```
┌────────┬──────────────┬───────────────────────────┬────────────┐
│ barra  │ banco activo │   ESCENARIO (sala)        │ inspector  │
│ lateral│ (material)   │   preview 9:16 centrado   │ (propie-   │
│ 232px  │ 360px        │   + luz de proyector      │ dades)     │
│ s1     │ s1           │   + botón Generar         │ 300px · s1 │
│        │              │ ─ tira «Próximas salidas» │            │
└────────┴──────────────┴───────────────────────────┴────────────┘
```

- **Barra lateral** (patrón Mesa): espacio de trabajo `bebetter.path`, buscar `Ctrl K`;
  grupos *Crear* (Video · Imagen · Carrusel), *Banco* (Frases · Imágenes · Audio con
  contadores), *Producción* (Lotes · Revisión con contador `oro` · Cola · Cadencia) y
  *Datos* (Analítica · Registro). Sustituye a la cabecera con 10 iconos y al toggle de
  modos.
- **Banco activo:** la lista del grupo seleccionado (frases, imágenes, audio o lotes) con
  filtros como chips. Al elegir un elemento se actualiza el escenario.
- **Escenario:** preview 9:16 de alto completo (≤ 640 px), centrado. Debajo o a su lado,
  **un solo** botón Generar. Abajo, la tira de próximas salidas (cola, franjas reales de la
  cadencia). Es la única zona con luz de proyector y grano.
- **Inspector:** propiedades editables (Fondo, Pista, Duración, Preset, Degradado, Destino)
  como filas clave-valor. Los ajustes de render del `RightPanel` actual viven aquí.
- **1024–1279 px:** la barra lateral se pliega a un riel de iconos de 64 px.
- **< 1024 px (móvil):** se conserva la navegación inferior actual (Banco · Vista ·
  Ajustes), mapeada a banco activo · escenario · inspector. Generar queda fijo encima de
  la barra inferior. Sin scroll horizontal y con un margen lateral de 16 px.
- **Pantallas completas** (sin columnas de banco ni inspector): **Carrusel**, **Analítica**
  y **Revisión**. Revisión deja de ser un modal y pasa a ser pantalla propia (ver §6).
- Los modales actuales (Logs, Cadencia, Audio) pasan a **panel deslizante desde la
  derecha**, que se abre desde el elemento que lo dispara y se cierra hacia el mismo lado.

## 6. Components

| Componente | Especificación |
|---|---|
| **Botón Generar (primario)** | Píldora `999px`, alto 48, relleno `sangre`, texto `hueso` 15/500, punto de 9 px «rec» a la izquierda. **Uno por pantalla.** Hover `sangre-hover`. Al pulsar: `scale(.98)` |
| **Botón secundario** | Radio 6, alto 30–32, borde 1 px `borde-control`, texto `hueso` 13. Hover fondo `s2` |
| **Botón fantasma** | Sin borde, texto `hueso-2`. Hover `hueso` |
| **Destructivo** | Igual que el secundario, con texto `lacre` y confirmación solo si es irreversible |
| **`kbd`** | Mono 11/500, `hueso-2` sobre `s2`, borde `linea-2`, radio 4. Acompaña a cada acción con atajo |
| **Chip de filtro** | Radio 6, alto 26. Apagado: borde discontinuo `borde-control`. Encendido: fondo `s2` y texto `hueso`. Contador en Mono `hueso-3` |
| **Fila de frase** | Primer tiempo `hueso` · `//` en `lacre` · giro `hueso-2`, y debajo una meta Mono 12 `hueso-3` (usos, energía, autor). Seleccionada: fondo `s2` + etiqueta «en pantalla» en `oro`. **Sin barra lateral de color** |
| **Fila de propiedad** | Rejilla 112 px / 1fr, alto 32. Clave `hueso-3` y valor `hueso`, con dato técnico en Mono `hueso-2`. Hover `s2` |
| **Preview** | 9:16, radio 14, sombra `0 40px 120px -20px rgb(0 0 0 / .9)` + anillo 1 px `rgb(232 228 220 / .06)`. El contenido replica el render: degradado de carbón hasta el 52 %, Inter Bold a `3.89cqw`, interlineado 1.2, centrado al 25 % de altura, respiro de una línea entre tiempos y handle en `oro` |
| **Interruptor** | 34×20. Apagado `s3` y encendido `oro` al 28 % con perilla `oro` |
| **Contador de revisión** | Píldora `oro`, texto `sala` Mono 11/500. Desaparece si es 0 |
| **Panel deslizante** | Ancho 420, `s1`, radio 10 en las esquinas interiores, `velo` detrás, entra desde la derecha |
| **Aviso (toast)** | Anclado abajo al centro del escenario, `s2` con borde `linea-2`. Icono Phosphor (no ✓ ✗ ⚠ como texto). Error en `lacre` |
| **Estado vacío** | Una línea en Anton 40 `hueso` + una frase `hueso-2` + una acción. Sin ilustraciones |
| **Revisión del lote** (el gesto del *Cartel*) | Pantalla completa. Pieza a pieza: preview a la derecha y, a la izquierda, la frase en **Anton display**, con el primer tiempo en `hueso`, filete de 72×3 px y el **giro en `lacre`**. Debajo: Aprobar (=encolar), Rechazar y Siguiente con `kbd` (A · X · →) |
| **Iconos** | **Phosphor**: peso *light* en el escenario y *regular* en la mesa. Tamaño 16 en la mesa y 18 en el escenario. Una sola familia (sustituye a `lucide-react`) |

## 7. Motion & Interaction

Tokens:

| Token | Valor | Uso |
|---|---|---|
| `t-rapido` | 120 ms, `cubic-bezier(.2,.8,.2,1)` | Hover, selección y chips: toda la mesa |
| `t-base` | 200 ms, misma curva | Cambio del preview, toasts |
| `t-panel` | 320 ms, `cubic-bezier(.22,.8,.2,1)` | Paneles deslizantes (entrada y salida por el mismo lado) |
| `t-sala` | 900 ms, `cubic-bezier(.22,.8,.2,1)` | Solo encendido y oscurecimiento de la sala |

Coreografías (las únicas cuatro con intención narrativa):
1. **Encendido.** Una vez por sesión, al cargar: la luz del proyector y el preview suben
   de opacidad 0 a 1 en `t-sala`. El resto de la app aparece sin animación.
2. **Dos tiempos.** Al elegir una frase, el primer tiempo aparece (200 ms), hay una pausa de
   **450 ms** (el respiro) y entra el giro. Es lo que hace el reel. Si el usuario cambia
   de frase antes, se cancela y empieza la nueva desde su estado actual.
3. **La sala baja la luz.** Mientras se renderiza, barra lateral, banco e inspector bajan
   al 30 % de opacidad en `t-sala` y el punto «rec» late (1 s). Al terminar vuelven.
   Siguen siendo usables: es un atenuado, no un bloqueo.
4. **El giro** (Revisión): primer tiempo desde una máscara (`translateY` 100 % → 0), se traza
   el filete y luego entra el giro. Duración total ≤ 1,2 s.

Reglas: solo se animan `transform` y `opacity`. Todo es interrumpible. El grano de película
es una capa fija con `pointer-events: none` y opacidad .05, y nunca va sobre un contenedor
con scroll. **`prefers-reduced-motion`**: todo pasa a cambio instantáneo o fundido de 120 ms,
sin pausa de respiro y con el grano estático. Teclado: `j`/`k` o flechas recorren el banco;
`G` genera; `Ctrl K` abre la búsqueda; `Esc` cierra paneles. El foco es visible: anillo
2 px `oro` con 2 px de separación.

## 8. Voice & Brand

- Español neutro y de tú (como el código actual), llano, **en cristiano** (como los motivos de error de `Puerta.tsx`):
  qué pasó y qué hacer, sin jerga técnica salvo en Registro.
- Sin emojis ni signos de exclamación en la interfaz, igual que en la marca. Los ✓ ✗ ⚠ se
  sustituyen por iconos.
- Botones con verbo concreto y corto: «Generar reel», «Enviar a la cola», «Otra frase». Un
  nombre por intención en toda la app («Enviar a la cola» y nunca «Encolar» en otro sitio).
- El handle `@bebetter.path` y las reglas de dos tiempos, tercera persona y tildes
  correctas valen para todo texto de marca que la UI muestre. **Anton en mayúsculas tiene
  que conservar las tildes** (dejar margen para que no las recorte una máscara o un
  `overflow`).
- Las cifras públicas se enuncian como en el vault: reproducciones (sumables), nunca
  «personas alcanzadas».

## 9. Anti-patterns

Prohibido (en cada revisión se busca literalmente):
- `#FF3B3B`, `neon-red`, cualquier `text-[9px]` o `text-[10px]`, y cualquier hex escrito a
  mano en un componente (`text-[#E8E4DC]`, `bg-white`, `bg-black/70`).
- `sangre` como texto o borde sobre carbón. El oro como relleno de un botón grande o como
  «color premium».
- Grises neutros (croma 0) para superficies: `#1C1C1C`, `#262626`, `zinc-*` y `neutral-*`.
- Degradados decorativos fuera de la luz de proyector, `glow` en botones (salvo la sombra
  de Generar), glassmorphism, y azul o morado en cualquier forma.
- Tarjetas con borde de color a la izquierda; barras de color como indicador de selección.
- Más de un botón relleno por pantalla, o más de un Generar.
- Cabecera con fila de iconos sin etiqueta; iconos solo con `title` y sin `aria-label`.
- ✓ ✗ ⚠ o emojis como iconos; mezclar Phosphor con Lucide.
- Anton fuera de sus tres usos; Inter fuera del preview.
- Animar `width`, `height`, `top` o `left`; `transition: all`; animaciones en bucle salvo el
  «rec» mientras renderiza; el grano sobre contenedores con scroll.
- Modales que se abren desde el centro sin origen; paneles que entran por un lado y salen
  por otro.
- Un preview que no se parece al render (otra fuente, otro tamaño u otra posición): el
  preview es una promesa sobre el MP4.
