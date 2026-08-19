/**
 * Prueba del emparejamiento por procedencia SIN cosechar nada (2026-08-18).
 *
 * Inventa dos procedencias sobre pistas reales del banco, vectoriza sus frases de
 * origen y comprueba a qué frases del banco empareja cada una. Limpia lo insertado
 * al terminar: es un script de verificación, no de datos.
 *
 *   npx tsx scripts/_probar-matching-audio.ts
 */
import 'dotenv/config'
import db from '../src/db'
import { embedText } from '../src/services/geminiService'
import { upsertSource, setSourcePhrase, deleteSource } from '../src/services/audioSources'
import { pickAudioForPhrase } from '../src/services/audioMatching'

const PRUEBAS = [
  { url: 'https://prueba.local/reel/A', frase: 'La disciplina es elegir lo que quieres a largo plazo por encima de lo que quieres ahora.' },
  { url: 'https://prueba.local/reel/B', frase: 'Nadie va a venir a salvarte. Levántate tú.' },
]

async function main() {
  const pistas = db.prepare(`SELECT filename FROM audio_tracks ORDER BY filename LIMIT 2`)
    .all() as { filename: string }[]
  if (pistas.length < 2) throw new Error('Hacen falta al menos 2 pistas en audio_tracks')

  console.log('Procedencias de prueba:')
  for (const [i, p] of PRUEBAS.entries()) {
    upsertSource({ sourceUrl: p.url, filename: pistas[i].filename })
    setSourcePhrase(p.url, p.frase, await embedText(p.frase, 'SEMANTIC_SIMILARITY'))
    console.log(`  ${pistas[i].filename}  ←  "${p.frase}"`)
  }

  const frases = db.prepare(
    `SELECT id, text FROM phrases WHERE embedding_texto IS NOT NULL AND archived = 0 LIMIT 8`
  ).all() as { id: string; text: string }[]

  console.log('\nQué corte elige cada frase:')
  for (const f of frases) {
    const pick = pickAudioForPhrase(f.id)
    const corta = f.text.replace(/\s+/g, ' ').slice(0, 58)
    if (!pick) { console.log(`  ✗ "${corta}…"  → sin corte`); continue }
    console.log(`  "${corta}…"`)
    console.log(`      → ${pick.filename}  coseno ${pick.score.toFixed(3)}  por «${pick.sourcePhrase?.slice(0, 45)}…»`)
  }

  for (const p of PRUEBAS) deleteSource(p.url)
  const quedan = db.prepare(`SELECT COUNT(*) n FROM audio_sources`).get() as { n: number }
  console.log(`\nLimpiado. Procedencias reales en la base: ${quedan.n}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
