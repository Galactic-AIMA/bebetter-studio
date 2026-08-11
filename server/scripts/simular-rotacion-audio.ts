/**
 * Simula el reparto de pistas de audio sobre el banco de frases activas usando el
 * código REAL (`bestAudio`), y lo compara con la lógica anterior al 2026-08-03
 * (gate por mood + desempate por SCORE_EPSILON), que colapsaba el pool.
 *
 * Solo LEE la DB. Sirve para verificar el arreglo sin tener que generar 118 reels.
 *
 *   npx tsx scripts/simular-rotacion-audio.ts [tamañoDeLote]
 */
import db from '../src/db'
import { getAllAudioMeta, AudioMeta } from '../src/services/audioMetadata'
import { bestAudio, noteChosen, scoreAudio, RotationState } from '../src/services/audioMatching'

const LOTE = Number(process.argv[2]) || 20

interface Phrase { id: string; text: string; nivel_energia: number | null; mood_category: string | null }

// Réplica de la lógica anterior al arreglo, para tener con qué comparar.
const SCORE_EPSILON = 0.05
function bestAudioViejo(meta: AudioMeta[], e: number | null, mood: string | null) {
  const tagged = meta.filter((m) => m.energia !== null && m.moodCategory)
  if (tagged.length === 0) return null
  const sameMood = mood ? tagged.filter((m) => m.moodCategory === mood) : []
  const pool = sameMood.length > 0 ? sameMood : tagged
  const cands = pool.map((m) => ({
    filename: m.filename,
    score: scoreAudio(e, mood, m.energia, m.moodCategory),
    usageCount: m.usageCount,
  }))
  cands.sort((a, b) => (Math.abs(a.score - b.score) > SCORE_EPSILON ? b.score - a.score : a.usageCount - b.usageCount))
  return cands[0]
}

const phrases = db.prepare(
  `SELECT id, text, nivel_energia, mood_category FROM phrases
   WHERE archived = 0 AND embedding IS NOT NULL
   ORDER BY usage_count ASC, created_at DESC`
).all() as Phrase[]
const meta = [...getAllAudioMeta().values()]

const corto = (f: string) => f.replace('reelsvideo.io_', '').replace('.mp3', '')
const byName = new Map(meta.map((m) => [m.filename, m]))

function reparto(pistas: (string | undefined)[]) {
  const m = new Map<string, number>()
  for (const p of pistas) m.set(p ?? '(ninguna)', (m.get(p ?? '(ninguna)') ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

let fallos = 0
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? '✅' : '❌'} ${msg}`)
  if (!ok) fallos++
}

for (const [titulo, sub] of [
  [`LOTE de ${LOTE} frases (las primeras de la cola del batchPlanner)`, phrases.slice(0, LOTE)],
  [`BANCO COMPLETO (${phrases.length} frases activas)`, phrases],
] as [string, Phrase[]][]) {
  console.log(`\n=========== ${titulo} ===========`)

  const viejo = sub.map((p) => bestAudioViejo(meta, p.nivel_energia, p.mood_category)?.filename)

  // Rotación igual que en producción: memoria de lote + siembra vacía (aquí se
  // simula desde cero para que el resultado sea reproducible).
  const rotation: RotationState = { extraUsage: new Map(), recentTextures: [] }
  const elegidas = sub.map((p) => {
    const a = bestAudio(meta, p.nivel_energia, p.mood_category, rotation)
    if (a) noteChosen(rotation, a)
    return a
  })
  const nuevo = elegidas.map((a) => a?.filename)

  console.log('\n-- ANTES (gate por mood) --')
  for (const [f, n] of reparto(viejo)) {
    console.log(`  ${corto(f).padEnd(16)}${String(n).padStart(4)}  ${'█'.repeat(Math.round((n / sub.length) * 40))}`)
  }
  console.log('\n-- DESPUÉS (energía + textura) --')
  for (const [f, n] of reparto(nuevo)) {
    const t = byName.get(f)
    console.log(`  ${corto(f).padEnd(16)}${String(n).padStart(4)}  ${(t?.textura ?? '-').padEnd(10)}${'█'.repeat(Math.round((n / sub.length) * 40))}`)
  }

  // Métricas que definen si el arreglo funciona.
  const repV = reparto(viejo), repN = reparto(nuevo)
  let mismaPista = 0, mismaTextura = 0
  const repeticiones: string[] = []
  for (let i = 1; i < elegidas.length; i++) {
    if (elegidas[i]?.filename === elegidas[i - 1]?.filename) {
      mismaPista++
      const e = (n: number) => sub[n].nivel_energia
      const candidatos = meta.filter((m) => Math.abs((e(i) ?? 5) - (m.energia ?? 5)) <= 2).length
      repeticiones.push(
        `      #${i}: e${e(i - 1)} y e${e(i)} → ${corto(elegidas[i]!.filename)} (${elegidas[i]!.textura}, e${elegidas[i]!.energia}); ${candidatos} pista(s) en su banda`
      )
    }
    if (elegidas[i]?.textura && elegidas[i]?.textura === elegidas[i - 1]?.textura) mismaTextura++
  }
  const desajustes = elegidas.map((a, i) => Math.abs((sub[i].nivel_energia ?? 5) - (a?.energia ?? 5)))
  const medio = desajustes.reduce((a, b) => a + b, 0) / desajustes.length

  console.log(`\n  pistas distintas ....... ${repV.length} → ${repN.length}  (de ${meta.length} en el banco)`)
  console.log(`  máximo por pista ....... ${repV[0][1]} → ${repN[0][1]}  (${((repN[0][1] / sub.length) * 100).toFixed(0)}% del set)`)
  console.log(`  reels seguidos misma pista ... ${mismaPista}/${elegidas.length - 1}`)
  for (const r of repeticiones) console.log(r)
  console.log(`  reels seguidos misma textura . ${mismaTextura}/${elegidas.length - 1}`)
  console.log(`  desajuste de energía ... ${medio.toFixed(2)} de media, ${Math.max(...desajustes)} máx.\n`)

  // La cobertura total solo se exige sobre el banco entero. En un lote de 20 pedir
  // las 12 pistas obligaría a que casi cada frase tomase una distinta: no es el
  // objetivo, y además depende de qué energías traiga ese lote concreto.
  if (sub.length === phrases.length) {
    check(repN.length === meta.length, `entran en rotación las ${meta.length} pistas del banco`)
  }
  check(mismaPista === 0, 'ningún reel repite la pista del anterior')
  check(repN[0][1] / sub.length <= 0.25, 'ninguna pista acapara más del 25% del set')
  check(Math.max(...desajustes) <= 2, 'ninguna pista se aleja más de 2 puntos de energía de su frase')
  check(elegidas.every((a) => a !== null), 'todas las frases recibieron pista')
}

console.log(fallos === 0 ? '\n✅ TODO CORRECTO' : `\n❌ ${fallos} comprobación(es) fallida(s)`)
process.exit(fallos === 0 ? 0 : 1)
