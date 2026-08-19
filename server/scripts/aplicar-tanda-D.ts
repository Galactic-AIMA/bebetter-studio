/**
 * Tanda D — las 28 últimas frases fuera de norma. Archivar la original + crear una nueva.
 *
 *   npx tsx scripts/aplicar-tanda-D.ts            (dry-run)
 *   npx tsx scripts/aplicar-tanda-D.ts --apply
 *
 * Cierra la reconversión abierta el 2026-08-02. Las 32 fuera de norma **están todas
 * publicadas** (`usage_count > 0`, ninguna sin usar): no es munición perdida, es el
 * histórico anterior a la norma. Cuatro se quedan fuera a propósito —están en el mejor
 * cuartil de retención y fallan solo por la persona, así que reescribirlas sería apostar
 * contra el dato particular con el dato general— y las otras 28 son esta tanda.
 *
 * Por qué NO se sobrescribe el texto: `publications.phrase_id` cuelga de estas frases y
 * de ahí sale toda la analítica (insights, skip, watch, el few-shot por reach real).
 * Reescribir en su sitio dejaría esas métricas atribuidas a unas palabras que nunca se
 * publicaron. Es el mismo criterio de las tandas B y C.
 *
 * ⚠️ **Este script usa la API ASÍNCRONA de `dbClient`.** Los de las tandas A, B y C se
 * escribieron antes de la Fase 2 y hoy están rotos: `db.prepare(...).all()` devuelve una
 * promesa y `db.transaction(fn)()` ya no es invocable. Ya cumplieron su función, pero no
 * sirven de plantilla.
 *
 * Deshacer: `_tandaD-aplicada.json` guarda el id nuevo y el viejo de cada par.
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import db, { MOTOR } from '../src/db'

const APLICAR = process.argv.includes('--apply')
const MAPA = JSON.parse(fs.readFileSync(path.join(__dirname, '_tandaD.json'), 'utf-8')) as
  { id: string; nuevo: string }[]

interface Fila { id: string; text: string; author: string | null; category: string | null }

const buscar = db.prepare(`SELECT id, text, author, category FROM phrases WHERE id LIKE ? AND archived = 0`)
const contar = db.prepare(
  `SELECT (SELECT COUNT(*) FROM publications WHERE phrase_id = @id) AS pubs,
          (SELECT COUNT(*) FROM videos WHERE phrase_id = @id) AS vids`
)
// `estructura` y `persona` se escriben a mano y no se suponen: las 28 pasaron por
// `validar-frases.ts` (dos tiempos + tercera por heurística Y por Vertex) antes de entrar.
// Sin autor: las paráfrasis dejaron de firmarse con el nombre de la fuente (2026-08-18).
const insertar = db.prepare(`
  INSERT INTO phrases (id, text, category, author, sort_order, estructura, persona)
  VALUES (@id, @texto, @categoria, NULL, @orden, 'dos_tiempos', 'tercera')
`)
const archivar = db.prepare(`UPDATE phrases SET archived = 1 WHERE id = ?`)

async function main() {
  const pares: { nuevoId: string; viejoId: string; viejo: string; nuevo: string; autorViejo: string | null }[] = []
  const saltadas: string[] = []

  console.log(`\n${APLICAR ? 'APLICANDO' : 'DRY-RUN'} — tanda D (${MAPA.length} frases, archivar + crear)\n`)
  // Se dice en voz alta a propósito: la primera pasada de este script escribió en
  // SQLite mientras la app corría sobre Postgres, y el resumen final salió correcto
  // porque lo leía del mismo motor equivocado.
  console.log(`motor: ${MOTOR}`)

  const minOrden = (((await db.prepare(`SELECT MIN(sort_order) m FROM phrases`).get()) as any).m ?? 0) as number
  let orden = minOrden - MAPA.length

  for (const m of MAPA) {
    const filas = (await buscar.all(m.id.length === 8 ? `${m.id}%` : m.id)) as Fila[]
    if (filas.length !== 1) { saltadas.push(`${m.id}: resuelve a ${filas.length} filas`); continue }
    const vieja = filas[0]
    const { pubs, vids } = (await contar.get({ id: vieja.id })) as any

    const nuevoId = uuidv4()
    console.log(`${vieja.id.slice(0, 8)} → ${nuevoId.slice(0, 8)}   (${pubs} pub · ${vids} vídeo${Number(vids) === 1 ? '' : 's'})${vieja.author ? `  [quita autor: ${vieja.author}]` : ''}`)
    console.log(`   archiva: ${vieja.text}`)
    console.log(`   entra  : ${m.nuevo}\n`)

    if (APLICAR) {
      await db.transaction(async () => {
        await insertar.run({ id: nuevoId, texto: m.nuevo, categoria: vieja.category, orden: orden++ })
        await archivar.run(vieja.id)
      })
    }
    pares.push({ nuevoId, viejoId: vieja.id, viejo: vieja.text, nuevo: m.nuevo, autorViejo: vieja.author })
  }

  console.log(`Listas: ${pares.length} · saltadas: ${saltadas.length}`)
  for (const s of saltadas) console.log(`   ⚠️ ${s}`)

  if (!APLICAR) { console.log('\n(dry-run — relanza con --apply)'); await db.close(); return }

  fs.writeFileSync(path.join(__dirname, '_tandaD-aplicada.json'), JSON.stringify(pares, null, 2), 'utf-8')

  const q = async (sql: string) => Number(((await db.prepare(sql).get()) as any).n)
  console.log(`\nBanco activo → ${await q('SELECT COUNT(*) n FROM phrases WHERE archived = 0')} frases`)
  console.log(`  en norma          : ${await q("SELECT COUNT(*) n FROM phrases WHERE archived=0 AND estructura='dos_tiempos' AND persona='tercera'")}`)
  console.log(`  en norma + franja : ${await q("SELECT COUNT(*) n FROM phrases WHERE archived=0 AND estructura='dos_tiempos' AND persona='tercera' AND LENGTH(text) BETWEEN 90 AND 130")}`)
  console.log(`  fuera de norma    : ${await q("SELECT COUNT(*) n FROM phrases WHERE archived=0 AND (estructura<>'dos_tiempos' OR persona<>'tercera')")}`)
  console.log('\n⚠️ Las nuevas entran SIN embedding: lanza POST /api/phrases/embed-all o no entran al pool.')
  await db.close()
}

main().catch((e) => { console.error('FALLO:', e.message); process.exit(1) })
