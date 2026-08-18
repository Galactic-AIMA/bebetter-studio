import { splitByTiempos } from './splitByTiempos'

/**
 * Implementación ÚNICA del word-wrap, compartida por cliente y servidor.
 *
 * Vive en `server/src/text/` y el cliente la importa por el alias `@shared`
 * (ver `client/vite.config.ts`). Es a propósito: el servidor la compila con
 * `tsc` y su `rootDir` es `src`, así que un directorio hermano fuera de `src`
 * lo rompería. El cliente, en cambio, la empaqueta Vite y no le importa dónde
 * esté el archivo. Este módulo NO puede importar nada de Node ni del DOM.
 *
 * Antes hubo cinco copias de este algoritmo: tres en el cliente (unificadas el
 * 14-may) y dos más en el servidor —`videoGenerator` e `imageGenerator`— que
 * además medían con una estimación (`length * fontSize * 0.55`) en vez de con
 * la fuente real. Todas pasan ahora por aquí, y lo único que cambia entre
 * entornos es CÓMO se mide un texto:
 *
 *   · Cliente  → `canvas.measureText` sobre la fuente web
 *   · Servidor → fontkit sobre el mismo TTF que luego pinta FFmpeg
 *
 * El servidor mide contra el TTF **porque es el que acaba dibujando**: ahí
 * está la verdad de los píxeles, no en la fuente que muestra el navegador.
 */

/** Separador visual entre bloques de tiempo (1 línea de alto). */
export const BLOCK_SEPARATOR = ''

/** Devuelve el ancho en píxeles de un texto con la fuente y tamaño ya fijados. */
export type MeasureText = (text: string) => number

export interface WrapOptions {
  /** Texto completo de la frase. */
  text: string
  /** Ancho máximo de línea, en píxeles. */
  maxPx: number
  /** Aplicar la división por tiempos. Por defecto, sí. */
  splitBlocks?: boolean
}

/** Envuelve un bloque suelto. Nunca parte una palabra: si no cabe, desborda. */
function wrapBlock(text: string, measure: MeasureText, maxPx: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (measure(test) > maxPx && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Envuelve el texto y aplica la división por tiempos: cada bloque se envuelve
 * por separado y entre bloques se inserta una línea vacía `''` como respiro.
 * El renderizador pinta un `drawtext` por línea moviendo la `y`, así que la
 * línea vacía consume su slot vertical sin dibujar nada.
 */
export function wrapWith(measure: MeasureText, opts: WrapOptions): string[] {
  const { text, maxPx, splitBlocks = true } = opts
  const blocks = splitBlocks ? splitByTiempos(text) : [text]

  const lines: string[] = []
  for (const block of blocks) {
    const wrapped = wrapBlock(block, measure, maxPx)
    if (!wrapped.length) continue
    if (lines.length) lines.push(BLOCK_SEPARATOR)
    lines.push(...wrapped)
  }
  return lines
}
