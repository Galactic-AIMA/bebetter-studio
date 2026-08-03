import { fontToCSS } from '../config/fonts'
import { splitByTiempos } from './splitByTiempos'

/**
 * Implementación ÚNICA del word-wrap del texto sobre el lienzo.
 *
 * Antes existían tres copias (Editor.computeWrappedLines, BatchGenerator.computeLines
 * y VideoPreview.drawText); la del batch construía mal la fuente y perdía el peso
 * Bold, midiendo distinto que el render final. Todo pasa ahora por aquí.
 *
 * Además aplica la división por tiempos: cada bloque se envuelve por separado y
 * entre bloques se inserta una línea vacía `''` como respiro. El servidor pinta
 * un `drawtext` por línea moviendo la `y`, así que la línea vacía consume su
 * slot vertical sin dibujar nada.
 */

/** Separador visual entre bloques de tiempo (1 línea de alto). */
export const BLOCK_SEPARATOR = ''

let sharedCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!sharedCtx) {
    const canvas = document.createElement('canvas')
    sharedCtx = canvas.getContext('2d')!
  }
  return sharedCtx
}

/** Envuelve un bloque suelto con la fuente ya fijada en el contexto. */
function wrapBlock(text: string, ctx: CanvasRenderingContext2D, maxPx: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (ctx.measureText(test).width > maxPx && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

export interface WrapTextOptions {
  /** Texto completo de la frase. */
  text: string
  /** Clave de fuente del proyecto, p. ej. 'Inter-Bold'. */
  font: string
  fontSize: number
  /** Ancho máximo del texto en % del ancho de resolución. */
  maxWidth: number
  /** Ancho de la resolución de salida en px. */
  resolutionWidth: number
  /** Aplicar la división por tiempos. Por defecto, sí. */
  splitBlocks?: boolean
  /**
   * Contexto de canvas a usar para medir. Si se pasa uno externo (el del preview)
   * se respeta su estado: la fuente se restaura al salir.
   */
  ctx?: CanvasRenderingContext2D
}

export function wrapText(opts: WrapTextOptions): string[] {
  const { text, font, fontSize, maxWidth, resolutionWidth, splitBlocks = true } = opts
  const ctx = opts.ctx ?? getMeasureCtx()
  const previousFont = ctx.font
  ctx.font = fontToCSS(font, fontSize)

  const maxPx = (maxWidth / 100) * resolutionWidth
  const blocks = splitBlocks ? splitByTiempos(text) : [text]

  const lines: string[] = []
  for (const block of blocks) {
    const wrapped = wrapBlock(block, ctx, maxPx)
    if (!wrapped.length) continue
    if (lines.length) lines.push(BLOCK_SEPARATOR)
    lines.push(...wrapped)
  }

  ctx.font = previousFont
  return lines
}
