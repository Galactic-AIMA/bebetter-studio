/**
 * Prueba de humo de la capa de datos (2026-08-19).
 *
 * Toca CADA capa —audio, procedencias, matching, lotes, analítica, transacciones—
 * y comprueba que devuelve datos de verdad. Compilar no basta en este refactor: los
 * `as any` se tragan una promesa sin protestar, así que una llamada sin `await`
 * pasa el compilador y luego devuelve un objeto vacío en producción.
 *
 * Es también el test que hay que volver a correr DESPUÉS de cambiar el motor a
 * Postgres: si da los mismos números, el cambio de motor no rompió nada.
 *
 *   npx tsx scripts/probar-capa-datos.ts
 */
import 'dotenv/config'
import db from '../src/db'
import { getAllAudioMeta, getRecentAudio } from '../src/services/audioMetadata'
import { getSourcesByTrack } from '../src/services/audioSources'
import { pickAudioForPhrase } from '../src/services/audioMatching'
import { planBatch } from '../src/services/batchPlanner'
import { pieceStats, summaryByDimension } from '../src/services/insightsService'

async function main() {
  const ok = (n: string, v: any) => console.log(`  ${String(v).padStart(6)}  ${n}`)

  const frases = await db.prepare(`SELECT COUNT(*) n FROM phrases`).get<{ n: number }>()
  ok('frases en la base', frases?.n)
  ok('pistas de audio', (await getAllAudioMeta()).size)
  ok('procedencias (pistas)', (await getSourcesByTrack()).size)
  const rec = await getRecentAudio(3)
  ok('pistas recientes', rec.tracks.length)

  const p = await db.prepare(
    `SELECT id FROM phrases WHERE embedding_texto IS NOT NULL AND archived = 0 LIMIT 1`
  ).get<{ id: string }>()
  const pick = p ? await pickAudioForPhrase(p.id) : null
  ok('auto-pick de audio', pick ? `${pick.filename.slice(0, 22)} ${pick.score.toFixed(3)}` : 'null')

  const pares = await planBatch('phrases', 3, false, 10)
  ok('lote planificado', pares.length)
  if (pares[0]) ok('  1a pieza dura', `${pares[0].duracionSeg}s`)

  const stats = await pieceStats()
  ok('piezas con receta', stats.length)
  ok('dimensiones', (await summaryByDimension(stats)).length)

  // Transaccion: debe deshacerse entera.
  const antes = (await db.prepare(`SELECT COUNT(*) n FROM phrases`).get<{ n: number }>())!.n
  try {
    await db.transaction(async () => {
      await db.prepare(`INSERT INTO phrases (id, text) VALUES ('_humo_', 'prueba')`).run()
      throw new Error('fallo a proposito')
    })
  } catch { /* esperado */ }
  const despues = (await db.prepare(`SELECT COUNT(*) n FROM phrases`).get<{ n: number }>())!.n
  ok('rollback (antes==despues)', `${antes} == ${despues} -> ${antes === despues ? 'OK' : 'FALLO'}`)
}
main().catch((e) => { console.error('FALLO:', e); process.exit(1) })
