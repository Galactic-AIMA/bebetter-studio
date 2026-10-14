/**
 * Puebla `phrases.estructura` desde la clasificación MANUAL de las 139 frases.
 *
 * No reclasifica nada: carga `clasificacion-estructura-manual.json`, que se
 * escribió a mano el 2026-08-02 **porque Gemini falló en 21 de 139 (15%)**
 * confundiendo *dos oraciones* con *dos tiempos*. La estructura es una propiedad
 * semántica, no de puntuación.
 *
 * Salvaguarda: 24 frases se han REESCRITO desde que se clasificaron (tandas de
 * reconversión). Para esas, la etiqueta podría haber caducado, así que se
 * contrasta el texto ACTUAL con `splitByTiempos`; si el número de bloques
 * contradice la etiqueta, la frase se deja **sin marcar** y se lista para
 * revisión a mano, en vez de escribir un dato que no se ha comprobado.
 *
 *   npx tsx scripts/aplicar-estructura-manual.ts [--apply]
 */
import db from '../src/db'
import { splitByTiempos } from '../src/text/splitByTiempos'

const APLICAR = process.argv.includes('--apply')

interface Clasificada {
  id: string
  texto: string
  estructura: 'dos_tiempos' | 'un_golpe'
  gemini?: string
  coincide?: boolean
  reconvertida?: string
}

const clasificadas = require('./clasificacion-estructura-manual.json') as Clasificada[]
const filas = db.prepare('SELECT id, text, archived FROM phrases').all() as {
  id: string; text: string; archived: number
}[]
const porId = new Map(filas.map((f) => [f.id, f]))
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

const aEscribir: { id: string; estructura: string }[] = []
const enRevision: { id: string; texto: string; etiqueta: string; bloques: number }[] = []
let ausentes = 0

for (const c of clasificadas) {
  const fila = porId.get(c.id)
  if (!fila) { ausentes++; continue }

  const reescrita = norm(fila.text) !== norm(c.texto)
  if (reescrita) {
    // El texto ya no es el que se clasificó: se comprueba que la etiqueta siga
    // teniendo sentido antes de escribirla.
    const bloques = splitByTiempos(fila.text).length
    const contradice = (c.estructura === 'un_golpe' && bloques === 2)
      || (c.estructura === 'dos_tiempos' && bloques === 1)
    if (contradice) {
      enRevision.push({ id: c.id, texto: fila.text, etiqueta: c.estructura, bloques })
      continue
    }
  }
  aEscribir.push({ id: c.id, estructura: c.estructura })
}

const idsClasificados = new Set(clasificadas.map((c) => c.id))
const activasSinDato = filas.filter((f) => f.archived === 0 && !idsClasificados.has(f.id))

console.log(`Entradas en el JSON        : ${clasificadas.length}`)
console.log(`  ya no están en la DB     : ${ausentes}`)
console.log(`A escribir                 : ${aEscribir.length}`)
console.log(`A revisar a mano           : ${enRevision.length}`)
console.log(`Activas sin clasificar     : ${activasSinDato.length}`)

for (const r of enRevision) {
  console.log(`\n  ⚠️ ${r.id.slice(0, 8)} — etiquetada ${r.etiqueta}, hoy da ${r.bloques} bloque(s)`)
  console.log(`     ${r.texto}`)
}
for (const a of activasSinDato) {
  console.log(`\n  ➕ ${a.id.slice(0, 8)} — activa y sin clasificar: ${a.text.slice(0, 80)}`)
}

if (!APLICAR) {
  console.log('\n(simulacro — relanza con --apply para escribir)')
  process.exit(0)
}

const upd = db.prepare('UPDATE phrases SET estructura = ? WHERE id = ?')
const tx = db.transaction((items: typeof aEscribir) => {
  for (const i of items) upd.run(i.estructura, i.id)
})
tx(aEscribir)

const resumen = db.prepare(
  `SELECT estructura, COUNT(*) n FROM phrases WHERE archived = 0 GROUP BY estructura`
).all() as { estructura: string | null; n: number }[]
console.log('\nEscrito. Reparto de las activas:')
for (const r of resumen) console.log(`  ${r.estructura ?? 'SIN DATO'}: ${r.n}`)
