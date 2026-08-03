/**
 * Degradado de carbón detrás del texto ("scrim").
 *
 * El hueso `#E8E4DC` pierde contraste sobre las imágenes claras del banco, así
 * que se interpone una capa de carbón semitransparente entre la imagen y el
 * texto: opaca arriba y transparente hacia abajo.
 *
 * La geometría se deriva de `text.position.y` para que el degradado acompañe al
 * texto si alguien lo baja. Los valores son un default configurable, no una
 * constante a fuego: el servidor replica exactamente estos números
 * (server/src/services/videoGenerator.ts → SCRIM) para que preview y render
 * coincidan visualmente.
 */

export interface ScrimConfig {
  /** Color del velo. */
  color: string
  /** Opacidad en el borde superior (0-1). */
  opacity: number
  /**
   * Cuánto se extiende el degradado por debajo del centro del texto, en % de la
   * altura. Con el default de texto (positionY 25) el degradado muere en el 50%.
   */
  spanBelowText: number
}

export const DEFAULT_SCRIM: ScrimConfig = {
  color: '#0A0A0A',
  opacity: 0.45,
  spanBelowText: 25,
}

/** Punto (en % de altura) donde el degradado llega a alpha 0. */
export function scrimEndPct(textPositionY: number, scrim: ScrimConfig = DEFAULT_SCRIM): number {
  return Math.min(100, Math.max(1, textPositionY + scrim.spanBelowText))
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/** Pinta el degradado sobre el canvas del preview (entre la imagen y el texto). */
export function drawTextScrim(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  textPositionY: number,
  scrim: ScrimConfig = DEFAULT_SCRIM
): void {
  if (scrim.opacity <= 0) return
  const [r, g, b] = hexToRgb(scrim.color)
  const endY = (scrimEndPct(textPositionY, scrim) / 100) * H
  const grad = ctx.createLinearGradient(0, 0, 0, endY)
  grad.addColorStop(0, `rgba(${r},${g},${b},${scrim.opacity})`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  const prev = ctx.fillStyle
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, endY)
  ctx.fillStyle = prev
}
