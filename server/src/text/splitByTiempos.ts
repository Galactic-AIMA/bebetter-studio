/**
 * División de una frase por "tiempos" (estructura de tensión A ↔ B).
 *
 * Las frases de bebetter suelen tener dos tiempos: una tesis y su giro. Si el
 * giro cae a mitad de línea, el efecto se pierde. Esta función decide dónde
 * cortar de forma determinista, medida sobre el banco real de frases:
 *
 *  - ~48% tienen una división limpia (un punto que separa dos oraciones) → se parte ahí.
 *  - ~43% no tienen separador → bloque único. El fallback es OBLIGATORIO:
 *    nunca se fuerza una división.
 *  - ~8% son ambiguas (varios puntos) → se parte por el separador más cercano
 *    a la mitad del texto (por nº de caracteres).
 *  - El delimitador explícito `//` manda sobre todo lo anterior.
 *
 * El punto y coma también separa tiempos ("La vida de los hombres es aburrida;
 * la satisfacción está en construir"). Se usa SOLO cuando no hay ningún punto
 * candidato: 27 frases del banco activo dependen de él, y darle el mismo rango
 * que al punto cambiaría el corte de frases que hoy se parten bien.
 *
 * Devuelve siempre 1 o 2 bloques, ya trimmeados y sin el `//`.
 */

/** Delimitador explícito de autor. Tiene prioridad sobre la heurística. */
export const EXPLICIT_DELIMITER = '//'

/**
 * Índices de corte candidatos: posición (exclusiva) donde termina el primer
 * bloque. Un candidato es una racha de puntos seguida de espacio, con texto
 * real a ambos lados. Se exige el espacio para no partir "3.5" ni "bebetter.path".
 */
function periodBoundaries(text: string, separator: '.' | ';' = '.'): number[] {
  const boundaries: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== separator) continue
    // avanzar hasta el final de la racha (elipsis "..." cuenta como una sola)
    let end = i
    while (end + 1 < text.length && text[end + 1] === separator) end++
    const cut = end + 1
    i = end
    if (cut >= text.length) continue
    if (!/\s/.test(text[cut])) continue
    const before = text.slice(0, cut).replace(/[.;\s]/g, '')
    const after = text.slice(cut).trim()
    if (!before.length || !after.length) continue
    boundaries.push(cut)
  }
  return boundaries
}

export function splitByTiempos(input: string): string[] {
  const text = (input ?? '').trim()
  if (!text) return ['']

  // 1. Delimitador explícito: manda sobre todo.
  const delimIdx = text.indexOf(EXPLICIT_DELIMITER)
  if (delimIdx !== -1) {
    const a = text.slice(0, delimIdx).trim()
    const b = text.slice(delimIdx + EXPLICIT_DELIMITER.length).replace(/\/\//g, ' ').trim()
    const parts = [a, b].filter(Boolean)
    return parts.length ? parts : [text]
  }

  // 2. Punto que separa dos oraciones; si no hay ninguno, punto y coma.
  const boundaries = periodBoundaries(text, '.')
  const candidates = boundaries.length ? boundaries : periodBoundaries(text, ';')
  if (candidates.length === 0) return [text] // fallback obligatorio: bloque único

  const mid = text.length / 2
  const cut = candidates.reduce((best, b) =>
    Math.abs(b - mid) < Math.abs(best - mid) ? b : best
  )

  // Un punto al cerrar el primer bloque es tipografía correcta; un `;` colgando
  // al final de un titular, no. Se retira sólo en ese caso.
  const first = text.slice(0, cut).trim().replace(/;$/, '')
  const second = text.slice(cut).trim()
  if (!first || !second) return [text]
  return [first, second]
}
