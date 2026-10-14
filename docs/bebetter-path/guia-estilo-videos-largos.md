# Guía de estilo — videos largos de bebetter.path

> Fecha: 2026-10-13 · Motor: **HyperFrames** (HTML + GSAP → MP4)
> Referencias locales: `referencias/bebetter-path-estilo/pinterest/` (fuera de git)

Los videos largos de bebetter.path son **ilustración plana cinematográfica animada**. El norte es **Samurai Jack**: formas geométricas sin contorno, siluetas fuertes, encuadres dramáticos, silencio y pausa. Las referencias de Pinterest concretan tres lenguajes que comparten esa base y uno alternativo (vitral).

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

## 2. Paletas (muestreadas de las referencias)

### A · "Petróleo y brasa" (base, de R2 y R1)
| Rol | Hex |
|---|---|
| Noche / fondo profundo | `#0B1218` |
| Sombra | `#121C24` |
| Petróleo medio | `#232E37` |
| Gris piedra | `#627171` |
| Turquesa acento (R1) | `#1FA3B8` |
| **Brasa (acento principal)** | `#DD644D` |
| Óxido | `#9B5B4B` |
| Piel o luz cálida | `#D8A48E` |
| Crema o rim light | `#F8D5B7` |

Regla: **70 % fríos oscuros, 20 % medios, 10 % brasa.** La brasa marca lo importante de cada plano (el objeto, la decisión, el personaje).

### B · "Tinta" (de R3)
`#000000` · `#F5F2EA` (blanco papel). Nada más. Si hace falta un acento, una sola gota de brasa `#DD644D`.

### C · "Vitral" (de R4)
| Rol | Hex |
|---|---|
| Junta o plomo | `#060611` |
| Noche | `#161726` |
| Cobalto | `#162F58` |
| Azul medio | `#2D5B7B` |
| Turquesa | `#5B8993` |
| Tierra | `#6E533B` |
| Ámbar | `#A57944` |
| Oro luz | `#DDC17B` |

---

## 3. Reglas de dibujo

1. **Sin contorno** en los estilos A y C (formas planas que se separan por valor). Solo el estilo B usa línea de tinta.
2. **Silueta primero:** cada personaje debe leerse rellenado en negro. Las formas son geométricas (torsos trapezoidales, cabezas simples) y las manos son expresivas, con más detalle que la cara.
3. **Luz dura:** una sola fuente por plano. Sombras proyectadas largas y nítidas, *rim light* crema en el borde que da a la luz.
4. **Textura:** grano o *noise* sutil encima de todo (opacidad 6–10 %), y degradados radiales de viñeta. Nunca degradados "glossy".
5. **Composición Tartakovsky:** alterna planos generales (figura < 10 % del cuadro) con primeros planos extremos. Usa mucho espacio negativo y horizontes bajos.
6. **Tipografía:** mínima. Títulos de capítulo en mayúsculas con mucho tracking, en crema sobre negro. Subtítulos discretos abajo, nunca encima del foco.

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

- **A · Petróleo y brasa:** el cuerpo narrativo de cada episodio (historias, ejemplos, personajes).
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
- Copiar composiciones concretas de las referencias: tomamos el lenguaje, no las escenas.
