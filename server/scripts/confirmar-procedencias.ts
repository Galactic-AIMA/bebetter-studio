/**
 * Vectoriza las frases de origen ya propuestas (2026-08-18).
 *
 * Es el paso que mete los cortes en el pool: hasta aquí están descargados y con la
 * frase que leyó Gemini, pero mudos para el matcher.
 *
 *   npx tsx scripts/confirmar-procedencias.ts            # las que falten
 *   npx tsx scripts/confirmar-procedencias.ts --force    # todas otra vez
 *
 * ⚠️ Confirmar en bloque se salta la revisión humana que el panel 🎵 impone a
 * propósito. Vale para arrancar un banco entero de golpe; corregir una frase mal
 * leída sigue siendo cosa de David, y basta con reescribirla y darle a Confirmar.
 */
import 'dotenv/config'
import db from '../src/db'
import { confirmarProcedencia } from '../src/services/audioHarvest'

async function main() {
  const force = process.argv.includes('--force')
  const filas = db.prepare(
    `SELECT source_url, source_phrase FROM audio_sources
     WHERE source_phrase IS NOT NULL${force ? '' : ' AND source_embedding IS NULL'}`
  ).all() as { source_url: string; source_phrase: string }[]

  console.log(`${filas.length} procedencias a vectorizar\n`)
  let ok = 0
  for (const f of filas) {
    try {
      await confirmarProcedencia(f.source_url, f.source_phrase)
      ok++
    } catch (e: any) {
      console.log(`  ✗ ${f.source_url}: ${e.message.slice(0, 120)}`)
    }
  }

  const enPool = db.prepare(
    `SELECT COUNT(DISTINCT filename) n FROM audio_sources WHERE source_embedding IS NOT NULL`
  ).get() as { n: number }
  console.log(`${ok}/${filas.length} vectorizadas. Cortes en el pool: ${enPool.n}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
