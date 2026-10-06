# Handoff de implementación · «Sala de montaje»

**Lee primero:** `DESIGN.md` (sistema obligatorio) y `docs/diseno/design-contract.md`
(puerta de calidad). Vista de referencia: `propuestas/05-sala-de-montaje.html`. Pulido con
`impeccable` y `emil-design-eng`; animación con `animate` o GSAP.

## Restricciones obligatorias

- **Tokens:** se reemplazan los colores de `client/tailwind.config.js` por los nombres de
  `DESIGN.md §2` (`sala`, `s1`–`s3`, `linea`, `linea-2`, `borde-control`, `hueso`–`hueso-3`,
  `oro`, `sangre`, `sangre-hover`, `lacre`, `velo`). Se eliminan `carbon`, `bone`, `gold`,
  `blood` y `neon` **después** de migrar todos sus usos. Cero hex en componentes.
- **Tipografía:** `@fontsource/ibm-plex-sans` (300–600), `@fontsource/ibm-plex-mono`
  (400, 500), `@fontsource/ibm-plex-sans-condensed` (500) y `@fontsource/anton`.
  `fontFamily.sans` = Plex Sans. **No tocar** los `@font-face` de `/api/fonts`: son del
  render, y el preview sigue usando su Inter.
- **Escala:** los tamaños de `DESIGN.md §3` como `fontSize` en Tailwind (`label`, `meta`,
  `ui`, `body`, `lead`, `title`, `display`). Mínimo 11 px.
- **Radios:** `rounded-control` 6, `rounded-panel` 10, `rounded-preview` 14 y `full` solo en
  Generar y en el contador.
- **Iconos:** `@phosphor-icons/react`, una familia (ver riesgo 1 del contrato).
- **Motion:** variables CSS `--t-rapido`, `--t-base`, `--t-panel` y `--t-sala` con sus
  curvas. Solo `transform` y `opacity`. Bloque `prefers-reduced-motion` global.

## Orden de trabajo (cada paso se puede entregar por separado)

1. **Cimientos:** tokens, fuentes, escala, radios, variables de motion, grano y luz de
   proyector como utilidades. Sin cambiar el layout.
2. **Shell:** barra lateral (sustituye a `Header` + toggle de modos) y layout de cuatro
   columnas en `Editor.tsx`, con riel en 1024–1279 px. En móvil se conserva `BottomNav`.
3. **Mesa:** `PhraseBank` (filas en dos tiempos con `//`), `ImageBank` y la lista de Lotes;
   `RightPanel` pasa a inspector de propiedades.
4. **Escenario:** `VideoPreview` centrado con luz, Generar único y tira de próximas salidas
   (de `/api/cadence/schedule`).
5. **Revisión** a pantalla completa con el giro en Anton y el teclado A · X · →.
6. **Paneles deslizantes** para Logs, Cadencia y Audio; toasts con Phosphor; estados
   vacíos.
7. **Coreografías** (§7): encendido, dos tiempos, sala que baja la luz y el giro.
8. Carrusel, Analítica y Puerta (login) con el sistema.

## Trampas ya encontradas en la vista de referencia

- La sombra del preview (120 px de desenfoque) se pinta **encima** de cualquier hermano no
  posicionado que tenga debajo: Generar salía al 65 % de color. Generar lleva
  `position: relative; z-index: 1`.
- Anton en mayúsculas dentro de una máscara (`overflow: hidden`) se come las tildes
  (Á, Ñ): hay que reservar `padding-top: .16em` compensado con un margen negativo.
- Una columna `1fr` sin `minmax(0, 1fr)` crece con su contenido (la tira de salidas) y
  saca la cabecera de la pantalla, en escritorio y en móvil.
- `toLocaleString('es-ES')` no agrupa las cifras de 4 dígitos (`1687`): formatear a mano
  para que salga `1.687`.

## Recursos

- Fondos y frases para pruebas: los reales del banco. Nada de lorem ni de nombres
  inventados.
- Sin ilustraciones, SVG dibujados a mano ni emojis. Logo: solo el wordmark en texto
  (hoy no existe una marca gráfica).

## Responsive

Hay que probar a 390, 1024, 1280 y 1440 px. Sin scroll horizontal, objetivo táctil ≥ 40 px
en móvil y Generar fijo sobre la barra inferior.

## El primer entregable debe demostrar

El **paso 1 + 2 + el escenario del editor de video** a 1440×900:
1. El preview es lo primero que se ve y sigue cuadrando con un MP4 generado (comparar un frame).
2. No queda `neon-red` ni ningún hex escrito a mano en los archivos tocados.
3. Una sola acción rellena (Generar) y la barra lateral sustituye a la cabecera de iconos.
4. Pasa la puerta de calidad del contrato en esa pantalla.
