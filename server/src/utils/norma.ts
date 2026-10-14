/**
 * La norma de marca, en un solo sitio.
 *
 * Dos reglas, ambas decididas el 2026-08-02 y registradas en `Identidad Visual
 * bebetter` §1, al mismo nivel que el handle o la paleta:
 *
 *   1. **Dos tiempos** — tesis y giro. Una frase de un golpe no se publica.
 *   2. **Tercera persona** — se habla de la gente, no se le habla al lector.
 *
 * Hasta ahora el filtro era David mirando la pantalla, y en el flujo manual eso
 * bastaba. En automático no: el bot propondría frases que nunca se publicarían.
 *
 * ⚠️ **`NULL` no cumple la norma, a propósito.** Una frase recién añadida y sin
 * clasificar se queda fuera del pool hasta que se le marque. Es la dirección
 * segura —mejor que no salga a que salga sin comprobar—, pero es un agujero
 * silencioso si nadie lo mira: por eso `/embed-all` devuelve cuántas quedan sin
 * `estructura`, y el listado expone las dos columnas para que la UI las enseñe.
 *
 * ⚠️ Y es un filtro **de selección, no de archivo**: las frases fuera de norma
 * siguen en la DB y en toda la analítica y el histórico. Se despriorizan, no se
 * retiran — la reconversión por tandas es lo que sostiene el pool.
 */

/** Predicado SQL de la norma. Va SIEMPRE acompañado de `archived = 0`. */
export const EN_NORMA_SQL = `estructura = 'dos_tiempos' AND persona = 'tercera'`

/** Motivo por el que una frase queda fuera de norma, para poder explicarlo. */
export function fueraDeNorma(estructura: string | null, persona: string | null): string[] {
  const motivos: string[] = []
  if (estructura !== 'dos_tiempos') motivos.push(estructura ? 'un golpe' : 'estructura sin clasificar')
  if (persona !== 'tercera') motivos.push(persona ? 'segunda persona' : 'persona sin clasificar')
  return motivos
}
