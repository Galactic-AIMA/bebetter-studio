/**
 * Tanda B — 15 frases CON HISTÓRICO: se archiva la original y entra una nueva.
 *
 *   npx tsx scripts/aplicar-tanda-B.ts            (dry-run)
 *   npx tsx scripts/aplicar-tanda-B.ts --apply
 *
 * Por qué no se sobrescriben, a diferencia de la tanda A: estas tienen
 * publicaciones o vídeos colgando. `publications.phrase_id` apunta a la frase, y
 * de ahí sale toda la analítica —insights, skip, watch, el few-shot por reach
 * real—. Reescribir el texto en su sitio dejaría esas métricas atribuidas a unas
 * palabras que ya no son las que se publicaron. Es la misma decisión del
 * 2026-07-29 con las 20 reescritas a dos tiempos.
 *
 * La original queda `archived = 1`: fuera del listado, de /random, de /recommend
 * y del planificador, pero intacta para todo lo histórico.
 *
 * La nueva entra ya en norma —`estructura` y `persona` verificadas por
 * `validar-frases.ts`, no supuestas— y SIN autor: las paráfrasis dejan de
 * firmarse con el nombre de la fuente (decisión del 2026-08-18).
 *
 * Deshacer: `_tandaB-aplicada.json` guarda el id nuevo y el viejo de cada par.
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import db from '../src/db'

const APLICAR = process.argv.includes('--apply')
const MAPA = JSON.parse(fs.readFileSync(path.join(__dirname, '_tandaB.json'), 'utf-8')) as
  { id: string; nuevo: string }[]

interface Fila { id: string; text: string; author: string | null; category: string | null }

const buscar = db.prepare(`SELECT id, text, author, category FROM phrases WHERE id LIKE ? AND archived = 0`)
const contar = db.prepare(
  `SELECT (SELECT COUNT(*) FROM publications WHERE phrase_id = @id) AS pubs,
          (SELECT COUNT(*) FROM videos WHERE phrase_id = @id) AS vids`
)
const insertar = db.prepare(`
  INSERT INTO phrases (id, text, category, author, sort_order, estructura, persona)
  VALUES (@id, @texto, @categoria, NULL, @orden, 'dos_tiempos', 'tercera')
`)
const archivar = db.prepare(`UPDATE phrases SET archived = 1 WHERE id = ?`)

const pares: { nuevoId: string; viejoId: string; viejo: string; nuevo: string; autorViejo: string | null }[] = []
const saltadas: string[] = []

console.log(`\n${APLICAR ? 'APLICANDO' : 'DRY-RUN'} — tanda B (${MAPA.length} frases, archivar + crear)\n`)

const minOrden = ((db.prepare(`SELECT MIN(sort_order) m FROM phrases`).get() as any).m ?? 0) as number
let orden = minOrden - MAPA.length

for (const m of MAPA) {
  const filas = buscar.all(m.id.length === 8 ? `${m.id}%` : m.id) as Fila[]
  if (filas.length !== 1) { saltadas.push(`${m.id}: resuelve a ${filas.length} filas`); continue }
  const vieja = filas[0]
  const { pubs, vids } = contar.get({ id: vieja.id }) as any

  if (pubs === 0 && vids === 0) {
    // Sin histórico no hay nada que preservar: archivar y duplicar solo ensucia
    // el banco. Va a la tanda A, que reescribe en su sitio.
    saltadas.push(`${m.id}: no tiene histórico (0 pubs, 0 vídeos) — corresponde reescribir en su sitio`)
    continue
  }

  const nuevoId = uuidv4()
  console.log(`${vieja.id.slice(0, 8)} → ${nuevoId.slice(0, 8)}   (${pubs} pub · ${vids} vídeo${vids === 1 ? '' : 's'})${vieja.author ? `  [quita autor: ${vieja.author}]` : ''}`)
  console.log(`   archiva: ${vieja.text}`)
  console.log(`   entra  : ${m.nuevo}\n`)

  if (APLICAR) {
    db.transaction(() => {
      insertar.run({ id: nuevoId, texto: m.nuevo, categoria: vieja.category, orden: orden++ })
      archivar.run(vieja.id)
    })()
  }
  pares.push({ nuevoId, viejoId: vieja.id, viejo: vieja.text, nuevo: m.nuevo, autorViejo: vieja.author })
}

console.log(`Listas: ${pares.length} · saltadas: ${saltadas.length}`)
for (const s of saltadas) console.log(`   ⚠️ ${s}`)

if (!APLICAR) { console.log('\n(dry-run — relanza con --apply)'); process.exit(0) }

fs.writeFileSync(path.join(__dirname, '_tandaB-aplicada.json'), JSON.stringify(pares, null, 2), 'utf-8')

const q = (sql: string) => (db.prepare(sql).get() as any).n as number
console.log(`\nBanco activo → ${q('SELECT COUNT(*) n FROM phrases WHERE archived = 0')} frases`)
console.log(`  en norma          : ${q("SELECT COUNT(*) n FROM phrases WHERE archived=0 AND estructura='dos_tiempos' AND persona='tercera'")}`)
console.log(`  en norma + franja : ${q("SELECT COUNT(*) n FROM phrases WHERE archived=0 AND estructura='dos_tiempos' AND persona='tercera' AND LENGTH(text) BETWEEN 90 AND 130")}`)
console.log('⚠️ Las nuevas entran SIN embedding: hay que vectorizarlas o no entran al pool.')
