/**
 * Qué corte elige cada frase con el banco real (2026-08-18).
 *
 * Comprueba las dos cosas que pueden salir mal a la vez:
 *   AFINIDAD  → que la frase de origen del corte elegido tenga que ver con la frase.
 *   REPARTO   → que no acabe todo el catálogo sonando con dos pistas. El coseno
 *               entre frases de este nicho se mueve en centésimas, así que un
 *               matcher puede parecer razonable frase a frase y estar colapsando.
 *
 *   npx tsx scripts/revisar-emparejamiento.ts [cuántas]
 */
import 'dotenv/config'
import db from '../src/db'
import { getAllAudioMeta, getRecentAudio } from '../src/services/audioMetadata'
import { getSourcesByTrack } from '../src/services/audioSources'
import { bestAudio, noteChosen, RotationState } from '../src/services/audioMatching'
import { duracionSegunAudio, DURACION_MIN, DURACION_MAX } from '../src/utils/duracionReel'

function vec(b: Buffer | null): Float32Array | null {
  if (!b || b.byteLength === 0) return null
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

function main() {
  const muestra = Number(process.argv[2]) || 12
  const frases = db.prepare(
    `SELECT id, text, embedding_texto FROM phrases
     WHERE embedding_texto IS NOT NULL AND archived = 0`
  ).all() as { id: string; text: string; embedding_texto: Buffer }[]

  const meta = [...getAllAudioMeta().values()]
  const fuentes = getSourcesByTrack()
  const enPool = meta.filter((m) => (fuentes.get(m.filename) ?? []).some((f) => f.sourceEmbedding))
  console.log(`${frases.length} frases · ${enPool.length} cortes en el pool\n`)

  // Igual que un lote: la rotación se arrastra entre elecciones.
  const reciente = getRecentAudio(3)
  const rotation: RotationState = {
    extraUsage: new Map(),
    recentTextures: reciente.textures,
    recentTracks: reciente.tracks,
  }

  const conteo = new Map<string, number>()
  const scores: number[] = []
  const duraciones: number[] = []
  for (const [i, f] of frases.entries()) {
    const pick = bestAudio(meta, vec(f.embedding_texto), rotation, fuentes)
    if (!pick) { console.log(`✗ sin corte: ${f.text.slice(0, 50)}`); continue }
    noteChosen(rotation, pick)
    conteo.set(pick.filename, (conteo.get(pick.filename) ?? 0) + 1)
    scores.push(pick.score)
    duraciones.push(duracionSegunAudio(pick.duracionSeg, 10))
    if (i < muestra) {
      console.log(`  "${f.text.replace(/\s+/g, ' ').slice(0, 66)}…"`)
      console.log(`     → ${pick.filename}  ${pick.score.toFixed(3)}`)
      console.log(`       porque un reel usó ese corte para: «${(pick.sourcePhrase ?? '').slice(0, 62)}…»`)
      if (pick.reelsDelNicho > 1) console.log(`       (${pick.reelsDelNicho} reels del nicho usan este tema)`)
    }
  }

  const usados = [...conteo.entries()].sort((a, b) => b[1] - a[1])
  const media = scores.reduce((a, b) => a + b, 0) / scores.length
  console.log(`\nReparto: ${usados.length} de ${enPool.length} cortes usados`)
  console.log(`Coseno medio del elegido: ${media.toFixed(3)}`)
  console.log(`El más repetido se lleva ${usados[0][1]} de ${scores.length} frases (${(100 * usados[0][1] / scores.length).toFixed(0)}%)`)
  // Duración: cada pieza dura lo que su corte, acotada. Interesa cuántas tocan los
  // topes, que es donde vuelve a haber bucle (suelo) o recorte (techo).
  const alTecho = duraciones.filter((d) => d === DURACION_MAX).length
  const alSuelo = duraciones.filter((d) => d === DURACION_MIN).length
  const mediaDur = duraciones.reduce((a, b) => a + b, 0) / duraciones.length
  console.log(
    `\nDuración: media ${mediaDur.toFixed(1)}s · min ${Math.min(...duraciones)}s · max ${Math.max(...duraciones)}s`
  )
  console.log(`  recortadas al techo (${DURACION_MAX}s): ${alTecho}`)
  console.log(`  estiradas al suelo (${DURACION_MIN}s, ahí SÍ habría bucle): ${alSuelo}`)
  console.log(`  exactas a su corte: ${duraciones.length - alTecho - alSuelo}`)

  console.log('\nTop 8:')
  for (const [f, n] of usados.slice(0, 8)) console.log(`  ${String(n).padStart(3)}  ${f}`)
}

main()
