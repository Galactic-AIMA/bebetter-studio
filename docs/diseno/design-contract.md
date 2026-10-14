# Contrato de diseño · beBetterStudio «Sala de montaje»

Fecha: 2026-10-05 · Decidido por David · Sistema: `DESIGN.md` (raíz) · Construcción:
`implementation-handoff.md`.

## Objetivo y artefacto

- **Qué:** rediseño visual de la **interfaz** de beBetterStudio (React 18 + Vite + Tailwind
  3), la app interna que genera reels, imágenes y carruseles de bebetter y los publica por
  n8n.
- **Para quién:** (a) David en el uso diario, en escritorio y móvil; (b) **escaparate** de
  Galactic AIMA: capturas para `galacticaima.com/casos-de-exito` y demos a clientes.
- **Fuera de alcance:** las piezas publicadas (render, presets, carruseles), que se rigen
  por la identidad del vault, y un futuro rediseño «producto vendible», que será otro
  proyecto (decisión de David).

## Brief (respuestas de David, 2026-10-04)

| Pregunta | Respuesta |
|---|---|
| ¿A quién convence? | Al uso diario y al escaparate de Galactic AIMA. La venta como producto queda para después |
| ¿De quién huele? | **De bebetter al 100 %** |
| ¿Qué se siente en 3 s? | **Cine con disciplina** (cine + disciplina) |
| Referencias | Villeneuve, A24, Apple, Linear, Nolan, Notion |
| ¿Cuánto cambia? | Exploración sin límites. **Mejorar la paleta** |
| Elección | La recomendación: **mezcla de 01 Sala + 02 Mesa** y el gesto del giro de 03 Cartel |

## Evidencia

| Fuente | Qué aporta | Confianza |
|---|---|---|
| Vault `Identidad Visual bebetter.md` | Paleta (carbón, hueso, rojo sangre, dorado `#C5A059`), Anton e IBM Plex, voz, dos tiempos, «RAW · STOIC · CINEMATIC» | provided |
| `client/tailwind.config.js`, `index.css` y componentes | Tokens actuales, `text-xs` ×138, `text-[9-10px]`, `neon-red` ×42, hex escritos a mano, `lucide-react` | observed |
| Script de contraste (WCAG 2 + OKLCH) | Rojo sangre sobre carbón 2,13:1; carbones con croma 0 frente al hueso de tono 85°; todos los tokens nuevos ≥ AA | observed |
| `propuestas/01`–`04` y capturas | Las cuatro direcciones con contenido real | observed |
| `awesome-design-md`: linear.app, apple, notion, runwayml, spacex y bugatti | Escalera de superficies, un solo acento, UI que se retira, imagen como interfaz | observed |
| Banco (SQLite local) | Frases reales en norma y fondos de origen IA | observed |
| Métricas | Snapshot de la VM del 2026-09-12 vía vault | provided |
| Solo tema oscuro | No se preguntó. Se deduce de la marca y del uso | **inferred** |
| Registro del español (neutro, de tú) | Deducido del código, no confirmado | **inferred** |
| Sustituir `lucide-react` por Phosphor | Criterio de diseño (taste-skill), no pedido por David | **inferred** · reversible |

## Referencias: qué se conserva, qué cambia y qué no se copia

| Referencia | Se conserva | Cambia | No se copia |
|---|---|---|---|
| **Villeneuve** | Luz cálida que entra en la oscuridad; silencio; escala | La luz es el dorado de marca, no ámbar de película | Fotogramas o carteles de sus películas |
| **Nolan** | Peso y seriedad; títulos condensados (vía Anton) | Solo en el giro de Revisión | Títulos o grafismos de sus películas |
| **A24** | Una idea por pantalla en Revisión; tipografía grande con aire | Sobre carbón, no sobre papel (03 era claro) | Carteles, logo o composición concretos |
| **Apple** | La UI se retira ante el producto; tracking por tamaño; foco visible; interrumpibilidad | El producto es el reel | SF Pro, iconos o materiales de Apple |
| **Linear** | Escalera de superficies, un acento, densidad, atajos, barra lateral agrupada | El acento es sangre/lacre, no lavanda | La fuente de Linear, su lavanda o la composición exacta de su app |
| **Notion** | Propiedades como filas clave-valor legibles | Sin color pastel ni ilustraciones | Su púrpura, sus ilustraciones o sus tarjetas de color |
| **Propuesta 01 Sala** | Escenario, luz de proyector, grano, encendido, sala que baja la luz | Pierde la cabecera de modos | — |
| **Propuesta 02 Mesa** | Barra lateral, banco como tabla con `//`, inspector, `kbd`, j/k | Geist pasa a IBM Plex (la marca) | — |
| **Propuesta 03 Cartel** | Anton + el giro en rojo, solo en Revisión | Lacre sobre carbón en vez de sangre sobre papel | El modo claro |

## Postura final

beBetterStudio es una **sala de montaje a oscuras**: el reel ocupa el escenario, iluminado
por una luz cálida de proyector con grano, y alrededor la mesa de trabajo es precisa, densa
y silenciosa, con barra lateral agrupada, banco con propiedades, inspector y atajos de
teclado. El color se reduce a **carbones con el tono del hueso, hueso para el texto, oro
como luz, sangre como única acción y lacre como señal** (error o giro). Anton, la display de
la marca, aparece solo donde la frase es protagonista (el giro en Revisión) para que el
momento de aprobar una pieza se sienta como ver su cartel.

## Riesgos y lo que no se sabe

1. **Migración de iconos** (Lucide → Phosphor): toca casi todos los componentes. Si pesa
   demasiado, se puede mantener Lucide a `strokeWidth 1.5` y anotarlo como desviación.
2. **Densidad en 1024–1279 px:** cuatro columnas no caben. El plan es plegar la barra
   lateral a un riel, pero falta verificarlo con pantallas reales.
3. **Revisión pasa de modal a pantalla:** cambia la navegación del flujo más usado en
   móvil. Hay que confirmar con David que aprobar o rechazar pieza a pieza con teclado
   le sirve.
4. **El grano y la luz** cuestan GPU en móviles viejos: capa fija y desactivable.
5. **No hay capturas de la app real funcionando:** la base local no arrancó en esta sesión.
   La auditoría se hizo sobre el código; la primera implementación debe verificarse con
   datos reales.
6. Sin confirmar: el tema oscuro único y el registro del español (ver Evidencia).

## Puerta de calidad (para aceptar cada pantalla)

- [ ] Solo usa tokens de `DESIGN.md §2`. `grep` sin resultados de `#FF3B3B`, `neon`,
      `text-\[9px\]`, `text-\[10px\]`, `\[#` ni `bg-white` en `client/src`.
- [ ] Todo texto pasa WCAG AA y los bordes de control 3:1 (tabla de §2).
- [ ] Un solo botón relleno (Generar) por pantalla.
- [ ] El preview sigue midiendo igual que el render (Inter Bold `3.89cqw`, 25 %, interlineado
      1.2, respiro de una línea).
- [ ] Anton solo en wordmark, Revisión y estados vacíos, con las tildes visibles.
- [ ] Sin emojis ni ✓ ✗ ⚠ como iconos; una sola familia de iconos.
- [ ] Teclado: j/k, G, Ctrl K y Esc funcionan; el foco se ve en `oro`.
- [ ] `prefers-reduced-motion` probado: sin pausas ni animaciones.
- [ ] Probado a 390, 1024, 1280 y 1440 px, sin scroll horizontal.
- [ ] Captura a 1440×900 presentable en la card de casos de éxito sin retocar.
