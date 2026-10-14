# Guía de estilo — videos largos de bebetter.path

> Fecha: 2026-10-13 · Motor: **HyperFrames** (HTML + GSAP → MP4)
> Referencias locales: `referencias/bebetter-path-estilo/pinterest/` (fuera de git)

Los videos largos de bebetter.path son **ilustración plana cinematográfica animada**. El norte es **Samurai Jack**: formas geométricas sin contorno, siluetas fuertes, encuadres dramáticos, silencio y pausa. Las referencias de Pinterest concretan dos lenguajes que comparten esa base (A y B) y uno alternativo (vitral). El color va atado a la marca bebetter (ver §2).

---

## 1. Qué enseña cada referencia

| # | Archivo | Qué es | Qué tomamos |
|---|---|---|---|
| R1 | `…123778689753909279….jpg` | Silueta negra de hombre de traje sobre fondo turquesa liso, con un borde de luz crema | **Silueta + rim light.** El personaje es una mancha negra y el volumen solo aparece en un filo de luz. Fondo de un solo color con viñeta suave. Sombra elíptica en el suelo. |
| R2 | `…28358672652633980.mp4` (116 s, 30 fps, ~22 cortes ≈ 5 s por plano) | Corto narrativo en vector plano: oficina, banco del parque, proyector de cine, manos con libro y marco roto, Hollywood al atardecer | **El lenguaje principal para narrar.** Paleta restringida de petróleo y naranja, luz dura con sombras proyectadas largas, texturas de grano, planos de detalle (manos y objetos), mezcla de archivo real dentro de pantallas. *Ojo: el contenido viene girado 90° (pensado para ver horizontal); nosotros lo hacemos 16:9 nativo.* |
| R3 | `…2111131073568209.mp4` (6,5 s, **10 fps**, loop) | Blanco y negro puro: dos ojos y una luna en la oscuridad; se abre un haz de luz y aparece un niño con el móvil | **Contraste absoluto y animación "a dos".** Sin grises, cortes duros de luz o oscuridad, trazo de tinta ligeramente tembloroso y framerate bajo. Ideal para aperturas, momentos íntimos o reflexivos. |
| R4 | `…4644405861240740….mp4` (15 s) | Ciudades nocturnas tipo *Noche estrellada* en mosaico o vitral: cielos en espiral, faroles, calles empedradas | **Estilo alternativo "vitral".** Teselas con junta oscura, espirales de luz, azul cobalto contra ámbar. Para episodios especiales o capítulos de "revelación" o fe, no como base. |

**Samurai Jack (referencia madre):** fondos pintados sin línea, personajes de formas simples, contraste entre planos muy abiertos (paisaje inmenso, figura diminuta) y primerísimos planos (ojos). Ritmo con pausas largas, *split-screen* en paneles y silencios antes de la acción.

---

## 2. Color: la marca pone el marco y la escena tiene libertad dentro de él

> Decisión de David (2026-10-13). Extiende la norma de identidad de bebetter (vault myBrain: *Identidad Visual bebetter*) para el formato largo: carbón `#0A0A0A`, hueso `#E8E4DC` y rojo sangre `#8B1A1A` como **acento único**.

### 2.1 Lo fijo (marca)
- **Marco del episodio:** cortinillas, títulos de capítulo, subtítulos y cierre van en **carbón y hueso**, con **Anton** (títulos, en mayúsculas) e **IBM Plex Sans** (subtítulos y textos).
- **Un solo acento en todo el episodio: rojo sangre.** Marca lo importante de cada plano (la decisión, el objeto clave, el personaje en conflicto). No se introduce ningún otro color saturado como acento.
- **El rim light es hueso**, no crema: el borde de luz de las siluetas siempre es `#E8E4DC`.

### 2.2 La familia del rojo (el acento iluminado)
La brasa naranja de las referencias **no es un color aparte**: es el rojo sangre recibiendo luz.

| Rol | Hex | Uso |
|---|---|---|
| Rojo en sombra | `#5A1010` | cara oculta de un objeto rojo |
| **Rojo sangre** | `#8B1A1A` | valor base del acento |
| Rojo iluminado | `#B8322A` | cara que da a la luz |
| Brillo del rojo | `#D9573F` | solo el filo más expuesto (≤ 2 % del cuadro) |

### 2.3 Lo libre (el mundo de cada escena)
Fríos para ambientar, **siempre apagados** para que el rojo sea lo único que destaque. Valores de partida (sacados de las referencias y desaturados):

| Rol | Hex |
|---|---|
| Fondo profundo (carbón frío) | `#0B1218` |
| Sombra | `#121C24` |
| Petróleo medio | `#232E37` |
| Gris piedra | `#627171` |
| Turquesa apagado | `#3E7F88` |
| Piel o luz cálida | `#C9A08A` |
| Luz (hueso) | `#E8E4DC` |

Cada escena puede mover estos fríos (más verde de noche, más gris en interior, más cálido en un atardecer o un recuerdo), con dos límites: **la saturación nunca supera la del rojo**, y los cálidos (piel, atardecer) no compiten en tono con el acento.

Proporción: **70 % fríos oscuros · 20 % medios y luz · ≤ 10 % familia del rojo.**

### 2.4 Por estilo
- **A · Petróleo y rojo** (cuerpo narrativo): §2.2 y §2.3 completas.
- **B · Tinta:** es la marca pura. Carbón `#0A0A0A`, hueso `#E8E4DC` y, como mucho, una gota de rojo sangre.
- **C · Vitral (excepción consciente):** puede salirse de la marca con cobalto y ámbar, pero la escena entra y sale por el marco de carbón y hueso, y nunca son más de 1–2 escenas por episodio.

| Vitral | Hex |
|---|---|
| Junta o plomo | `#060611` |
| Noche | `#161726` |
| Cobalto | `#162F58` |
| Azul medio | `#2D5B7B` |
| Turquesa | `#5B8993` |
| Tierra | `#6E533B` |
| Ámbar | `#A57944` |
| Oro luz | `#DDC17B` |

### 2.5 Prueba de cada fotograma
1. **En blanco y negro debe seguir leyéndose bien** (las siluetas y el foco se distinguen solo por valor).
2. **En color, lo único que grita es el rojo sangre.**

---

## 3. Reglas de dibujo

1. **Sin contorno** en los estilos A y C (formas planas que se separan por valor). Solo el estilo B usa línea de tinta.
2. **Silueta primero:** cada personaje debe leerse rellenado en negro. Las formas son geométricas (torsos trapezoidales, cabezas simples) y las manos son expresivas, con más detalle que la cara.
3. **Luz dura:** una sola fuente por plano. Sombras proyectadas largas y nítidas, *rim light* hueso en el borde que da a la luz.
4. **Textura:** grano o *noise* sutil encima de todo (opacidad 6–10 %), y degradados radiales de viñeta. Nunca degradados "glossy".
5. **Composición Tartakovsky:** alterna planos generales (figura < 10 % del cuadro) con primeros planos extremos. Usa mucho espacio negativo y horizontes bajos.
6. **Tipografía (de marca):** mínima. Títulos de capítulo en **Anton** mayúsculas, hueso sobre carbón. Subtítulos en **IBM Plex Sans**, discretos abajo, nunca encima del foco.

---

## 4. Movimiento (HyperFrames + GSAP)

| Recurso | Cómo |
|---|---|
| **Parallax por capas** | 3–5 capas SVG (fondo, medio, personaje, primer plano, grano). La cámara se mueve con `x`/`scale` lentos (8–12 s por plano) y la capa cercana se mueve ×2–3 respecto al fondo. |
| **Ritmo** | Un plano cada **4–6 s** de media (R2: ~5 s). Las pausas son contenido: deja 1–2 s de quietud antes de cada idea clave. |
| **Easing** | `power2.inOut` para cámara y `expo.out` para apariciones. Nada de rebotes ni `elastic`. |
| **Animación de personaje** | Poses clave más que interpolación continua. En el estilo B, *stepped* a **10–12 fps** (`steps()` o cambio de frames SVG). En A, se mezclan movimientos suaves de cámara con personajes "a dos" (12 fps). |
| **Luz como transición** | Abrir o cerrar un haz de luz (R3), barrer una sombra o fundir a negro. Se evitan los *wipes* genéricos. |
| **Split-screen** | Paneles que se deslizan (homenaje a Samurai Jack) para acciones simultáneas o contraste antes/después. |
| **Vitral (C)** | Las teselas aparecen por *stagger* radial desde el centro de luz, las espirales del cielo rotan muy lento (60 s/vuelta) y los faroles titilan con opacidad 0,85↔1. |

Formato: **16:9, 1920×1080, 24 fps** de salida (cine). Se puede derivar un corte vertical 9:16 reencuadrando las capas, no rotando.

---

## 5. Cuándo usar cada estilo

- **A · Petróleo y rojo:** el cuerpo narrativo de cada episodio (historias, ejemplos, personajes).
- **B · Tinta:** aperturas, introspección, la "noche oscura" del protagonista, citas.
- **C · Vitral:** clímax espiritual o de revelación, cierres especiales. Un episodio no debería tener más de 1–2 escenas así.

Un episodio típico: abre en **B**, se desarrolla en **A** y llega a un clímax opcional en **C**, para cerrar otra vez en **A** con luz cálida (atardecer, como el final de R2).

---

## 6. Skills a cargar al producir

`hyperframes` (entrada obligatoria) → `hyperframes-creative`, `hyperframes-animation`, `hyperframes-keyframes`, `motion-graphics`, `hyperframes-audio`. Para guion o explicador sin metraje: `faceless-explainer`.

## 7. Qué evitar

- Personajes "corporate Memphis" o de stock con contornos gruesos.
- Gradientes brillantes o efecto 3D plástico.
- Cortes rápidos tipo short (< 2 s) en el formato largo.
- Un segundo acento saturado (naranja, amarillo, turquesa vivo): el acento es solo el rojo sangre.
- Copiar composiciones concretas de las referencias: tomamos el lenguaje, no las escenas.
