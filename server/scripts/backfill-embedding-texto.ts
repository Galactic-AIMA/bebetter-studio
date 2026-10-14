/**
 * Rellena `phrases.embedding_texto` (2026-08-18).
 *
 * Es el lado "frase" del emparejamiento por procedencia: el vector del TEXTO CRUDO,
 * que es lo único comparable con la frase de origen de un corte de audio. NO
 * sustituye a `phrases.embedding`, que vectoriza las metáforas visuales y sigue
 * buscando imagen de fondo.
 *
 *   npx tsx scripts/backfill-embedding-texto.ts        → solo las que faltan
 *   npx tsx scripts/backfill-embedding-texto.ts --force → todas
 */
import 'dotenv/config'
import db from '../src/db'
import { embedText } from '../src/services/geminiService'

async function main() {
  const force = process.argv.includes('--force')
  const rows = db.prepare(
    `SELECT id, text FROM phrases${force ? '' : ' WHERE embedding_texto IS NULL'}`
  ).all() as { id: string; text: string }[]

  console.log(`Frases a vectorizar: ${rows.length}${force ? ' (--force)' : ''}`)
  const update = db.prepare(`UPDATE phrases SET embedding_texto = ? WHERE id = ?`)
  let ok = 0
  for (const [i, p] of rows.entries()) {
    try {
      const v = await embedText(p.text, 'SEMANTIC_SIMILARITY')
      update.run(Buffer.from(v.buffer, v.byteOffset, v.byteLength), p.id)
      ok++
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${rows.length}`)
    } catch (e: any) {
      console.error(`  ✗ ${p.id}: ${e.message}`)
    }
  }
  const total = db.prepare(`SELECT COUNT(*) n FROM phrases WHERE embedding_texto IS NOT NULL`).get() as { n: number }
  console.log(`Vectorizadas ${ok}/${rows.length}. Con embedding_texto en total: ${total.n}`)
}

main()
