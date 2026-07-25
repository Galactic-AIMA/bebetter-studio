/**
 * Validación v2 del matching conceptual-simbólico (2026-07-24).
 *
 * v1 reveló: la extracción de elementos/temas funciona, PERO el ranking se
 * aplana porque los `temas` abstractos convergen a vocabulario motivacional
 * genérico ("superación" en 9/10 imágenes). Hipótesis: lo que discrimina es lo
 * CONCRETO (elementos de imagen ↔ metáforas visuales de frase).
 *
 * Este script CACHEA los análisis de Gemini (caros) a un JSON y compara 3
 * variantes del documento a embeber (baratas) sobre los mismos análisis, para
 * elegir el builder antes de re-vectorizar. NO toca la DB.
 *
 * Uso:  npx tsx scripts/validate-matching.ts
 *       (borra el cache JSON para re-analizar)
 */
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { config } from '../src/config'
import { analyzeImageStructured, analyzePhraseStructured, embedText, ImageAnalysis, PhraseAnalysis } from '../src/services/geminiService'
import { cosine } from '../src/utils/matching'

const db = new Database(config.paths.db, { readonly: true })
const CACHE = path.join(process.env.TEMP || '/tmp', 'bebetter-match-cache.json')

const IMAGE_SUBSET = [
  'Berserk.jfif', 'descarga (8).jfif', 'descarga (2).jfif',   // guerreros/espada
  'descarga (10).jfif', 'descarga (23).jfif',                 // luz/faro/torre
  'descarga (13).jfif',                                       // camino/carretera
  'descarga (7).jfif', 'descarga (21).jfif',                  // cruz / playa-luz
  'descarga (11).jfif', 'descarga (22).jfif',                 // farola / meditación
]

// Frases con símbolo matcheable en el subset + 2 controles negativos (sin imagen).
const PHRASE_LIKES = [
  'El guerrero construye su realidad',      // guerrero → Berserk/d8/d2
  'guerrero en la oscuridad no pide luz',   // guerrero+luz
  'El camino de mil pasos',                 // camino → d13
  'La disciplina es el puente',             // puente (control: ninguna imagen)
  'lobo que todos quieran callar',          // lobo (control: ninguna imagen)
]

interface Cache {
  images: Record<string, ImageAnalysis>
  phrases: Record<string, { text: string; analysis: PhraseAnalysis }>
}

async function buildCache(): Promise<Cache> {
  if (fs.existsSync(CACHE)) {
    console.log('· usando cache de análisis:', CACHE)
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  }
  console.log('· analizando con Gemini (se cachea para próximas corridas)…')
  const cache: Cache = { images: {}, phrases: {} }
  for (const f of IMAGE_SUBSET) {
    const p = path.join(config.paths.images, f)
    if (!fs.existsSync(p)) { console.log('  ⚠ falta en disco:', f); continue }
    cache.images[f] = await analyzeImageStructured(p)
    console.log('  img ✓', f)
  }
  for (const like of PHRASE_LIKES) {
    const row = db.prepare(`SELECT id, text FROM phrases WHERE text LIKE ?`).get(`%${like}%`) as any
    if (!row) { console.log('  ⚠ sin frase:', like); continue }
    cache.phrases[like] = { text: row.text, analysis: await analyzePhraseStructured(row.text) }
    console.log('  frase ✓', like)
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2))
  return cache
}

// ── Variantes de documento a comparar ─────────────────────────────────────────
type Builder = { name: string; img: (a: ImageAnalysis) => string; phr: (a: PhraseAnalysis) => string }

const BUILDERS: Builder[] = [
  {
    name: 'A_actual (elem+temas+mood)',
    img: (a) => `Elementos: ${a.elementos.join(', ')}. Temas: ${a.temas.join(', ')}. Emoción: ${a.emocionDominante}. Atmósfera: ${a.descripcionMood}`,
    phr: (a) => `Elementos: ${a.metaforasVisuales.join(', ')}. Temas: ${a.temas.join(', ')}. Atmósfera: ${a.mood}`,
  },
  {
    name: 'B_concreto (solo elementos)',
    img: (a) => a.elementos.join(', '),
    phr: (a) => a.metaforasVisuales.join(', '),
  },
  {
    name: 'C_balance (elem×2 + mood, sin temas)',
    img: (a) => `${a.elementos.join(', ')}. ${a.elementos.join(', ')}. ${a.descripcionMood}`,
    phr: (a) => `${a.metaforasVisuales.join(', ')}. ${a.metaforasVisuales.join(', ')}. ${a.mood}`,
  },
]

async function embedMap(texts: Record<string, string>): Promise<Record<string, Float32Array>> {
  const out: Record<string, Float32Array> = {}
  for (const [k, t] of Object.entries(texts)) out[k] = await embedText(t)
  return out
}

async function run() {
  const cache = await buildCache()
  const imgKeys = Object.keys(cache.images)

  for (const b of BUILDERS) {
    console.log(`\n╔══ VARIANTE: ${b.name} ══`)
    const imgEmb = await embedMap(Object.fromEntries(imgKeys.map((k) => [k, b.img(cache.images[k])])))

    for (const like of Object.keys(cache.phrases)) {
      const { text, analysis } = cache.phrases[like]
      const pEmb = await embedText(b.phr(analysis))
      const ranked = imgKeys
        .map((k) => ({ k, s: cosine(pEmb, imgEmb[k]) }))
        .sort((x, y) => y.s - x.s)
      const top3 = ranked.slice(0, 3).map((r) => `${r.k.replace('.jfif', '')} ${r.s.toFixed(3)}`).join('  |  ')
      const spread = (ranked[0].s - ranked[ranked.length - 1].s).toFixed(3)
      console.log(`  «${text.slice(0, 42)}…»`)
      console.log(`     top3: ${top3}   (spread ${spread})`)
    }
  }
  console.log('\n═══ FIN ═══  (cache:', CACHE + ')')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
