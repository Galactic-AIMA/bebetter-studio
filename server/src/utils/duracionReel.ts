/**
 * Cuánto dura un reel generado automáticamente: **lo que dure su audio** (2026-08-18).
 *
 * Decisión de David, y corrige la recomendación contraria que salía de los números.
 * Los datos decían que el watch está clavado en ~5,5 s dures lo que dures y que 8 s
 * rinde algo mejor que 10 s, así que la duración parecía un parámetro fijo a afinar.
 * Pero eso ignoraba lo que se oye: con duración fija, un corte más corto que el vídeo
 * ==da la vuelta al bucle y la costura se nota==. A 10 s le pasaba a **24 de los 34
 * cortes del pool (71%)**.
 *
 * Así que manda el audio, acotado por los dos lados:
 *
 *   SUELO  → por debajo no se baja aunque el corte sea cortísimo, porque una frase de
 *     dos tiempos necesita tiempo de lectura. Medido sobre el banco: **el corte más
 *     corto dura 5,37 s**, así que con 5 s ninguno tiene que repetirse. Cero bucles.
 *   TECHO  → los cortes largos se recortan en vez de estirar el vídeo. Un reel de 14 s
 *     es lo peor de la tabla de retención (39% a 12 s), y recortar NO suena a costura:
 *     el último segundo lleva `afade=out`, que es justo para eso. Afecta a 10 de 34.
 *
 * Los 24 restantes pasan tal cual: ni bucle ni recorte.
 */

/** Segundos mínimos de un reel automático. Ver arriba: tiempo de lectura. */
export const DURACION_MIN = 5
/** Segundos máximos. Alargar más no compra watch — el espectador se va a los ~5,5 s. */
export const DURACION_MAX = 10

/**
 * Duración del reel a partir de la del corte de audio.
 *
 * Sin audio (o sin saber cuánto dura) devuelve `porDefecto`: la política solo aplica
 * cuando hay un corte que la sostenga.
 */
export function duracionSegunAudio(
  audioSeg: number | null | undefined,
  porDefecto: number
): number {
  if (typeof audioSeg !== 'number' || !Number.isFinite(audioSeg) || audioSeg <= 0) {
    return porDefecto
  }
  // Se redondea a una décima: FFmpeg acepta decimales y truncar a entero volvería a
  // meter hasta 0,9 s de bucle en un corte de 7,4 s, que es justo lo que se evita.
  const acotada = Math.min(DURACION_MAX, Math.max(DURACION_MIN, audioSeg))
  return Math.round(acotada * 10) / 10
}
