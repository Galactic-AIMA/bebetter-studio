import { fontToCSS } from '../config/fonts'
import { wrapWith, MeasureText } from '@shared/wrap'

/**
 * Medición del wrap en el NAVEGADOR: pone la fuente en un contexto de canvas y
 * mide con `measureText`.
 *
 * El algoritmo —cómo se parten las líneas y dónde va el respiro entre tiempos—
 * ya no vive aquí: está en `@shared/wrap`, compartido con el servidor, que lo
 * ejecuta midiendo contra el TTF que pinta FFmpeg. Este archivo solo aporta el
 * medidor. Así el preview y el vídeo no pueden volver a divergir por tener dos
 * implementaciones.
 */

export { BLOCK_SEPARATOR } from '@shared/wrap'

let sharedCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!sharedCtx) {
    const canvas = document.createElement('canvas')
    sharedCtx = canvas.getContext('2d')!
  }
  return sharedCtx
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
  const { text, font, fontSize, maxWidth, resolutionWidth, splitBlocks } = opts
  const ctx = opts.ctx ?? getMeasureCtx()
  const previousFont = ctx.font
  ctx.font = fontToCSS(font, fontSize)

  const measure: MeasureText = (s) => ctx.measureText(s).width
  const lines = wrapWith(measure, {
    text,
    maxPx: (maxWidth / 100) * resolutionWidth,
    splitBlocks,
  })

  ctx.font = previousFont
  return lines
}
