/**
 * Tanda A — las 17 frases que se pueden reescribir EN SU SITIO.
 *
 *   npx tsx scripts/aplicar-tanda-A.ts            (dry-run)
 *   npx tsx scripts/aplicar-tanda-A.ts --apply
 *
 * Son las únicas de las 78 pendientes con **0 publicaciones y 0 vídeos**, así que
 * un UPDATE no rompe ningún histórico. Para el resto habrá que archivar la
 * original y crear una nueva, como en julio.
 *
 * ⚠️ La comprobación se hace fila a fila y en el momento de aplicar, no se confía
 * en el inventario: el 2026-08-02 una frase con el contador en cero resultó estar
 * publicada. Mirar `publications` a solas no basta; se suman `videos`.
 *
 * Qué cambia en cada fila:
 *   · `text`        → la versión en norma y en franja (validada con validar-frases)
 *   · `author`      → NULL: decisión del 2026-08-18, las paráfrasis dejan de
 *                     firmarse con el nombre de la fuente. El campo queda para
 *                     citas literales de verdad
 *   · `estructura`  → 'dos_tiempos'   (verificado por la puerta, no supuesto)
 *   · `persona`     → 'tercera'       (idem, con los dos jueces de acuerdo)
 *   · `embedding` y `descripcion_mood` → NULL, los regenera /api/phrases/embed-all
 *
 * El texto viejo se guarda en `_tandaA-aplicada.json` para poder deshacer.
 */
import fs from 'fs'
import path from 'path'
import db from '../src/db'

const APLICAR = process.argv.includes('--apply')
const MAPA = JSON.parse(fs.readFileSync(path.join(__dirname, '_tandaA.json'), 'utf-8')) as
  { id: string; nuevo: string }[]

interface Fila { id: string; text: string; author: string | null }

const buscar = db.prepare(`SELECT id, text, author FROM phrases WHERE id LIKE ? AND archived = 0`)
const contar = db.prepare(
  `SELECT (SELECT COUNT(*) FROM publications WHERE phrase_id = @id)
        + (SELECT COUNT(*) FROM videos WHERE phrase_id = @id) AS n`
)
const actualizar = db.prepare(`
  UPDATE phrases
     SET text = @texto, author = NULL, estructura = 'dos_tiempos', persona = 'tercera',
         embedding = NULL, descripcion_mood = NULL
   WHERE id = @id
`)

const hechas: { id: string; viejo: string; nuevo: string; autorViejo: string | null }[] = []
const saltadas: string[] = []

console.log(`\n${APLICAR ? 'APLICANDO' : 'DRY-RUN'} — tanda A (${MAPA.length} frases)\n`)

for (const m of MAPA) {
  const filas = buscar.all(m.id.length === 8 ? `${m.id}%` : m.id) as Fila[]
  if (filas.length !== 1) {
    saltadas.push(`${m.id}: resuelve a ${filas.length} filas`)
    continue
  }
  const fila = filas[0]
  const usos = (contar.get({ id: fila.id }) as any).n as number
  if (usos > 0) {
    saltadas.push(`${m.id}: tiene ${usos} publicación/vídeo — hay que archivar, no sobrescribir`)
    continue
  }

  console.log(`${fila.id.slice(0, 8)}${fila.author ? `  [quita autor: ${fila.author}]` : ''}`)
  console.log(`   antes: ${fila.text}`)
  console.log(`   ahora: ${m.nuevo}\n`)

  if (APLICAR) actualizar.run({ id: fila.id, texto: m.nuevo })
  hechas.push({ id: fila.id, viejo: fila.text, nuevo: m.nuevo, autorViejo: fila.author })
}

console.log(`Listas: ${hechas.length} · saltadas: ${saltadas.length}`)
for (const s of saltadas) console.log(`   ⚠️ ${s}`)

if (!APLICAR) {
  console.log('\n(dry-run — relanza con --apply)')
  process.exit(0)
}

fs.writeFileSync(path.join(__dirname, '_tandaA-aplicada.json'), JSON.stringify(hechas, null, 2), 'utf-8')

const enNorma = db.prepare(
  `SELECT COUNT(*) n FROM phrases WHERE archived = 0 AND estructura = 'dos_tiempos' AND persona = 'tercera'`
).get() as any
const enFranja = db.prepare(
  `SELECT COUNT(*) n FROM phrases WHERE archived = 0 AND estructura = 'dos_tiempos' AND persona = 'tercera'
     AND LENGTH(text) BETWEEN 90 AND 130`
).get() as any
console.log(`\nBanco activo → en norma: ${enNorma.n} · en norma Y en franja: ${enFranja.n}`)
console.log('⚠️ Falta re-vectorizar: POST /api/phrases/embed-all con los ids, o el botón del banco.')
