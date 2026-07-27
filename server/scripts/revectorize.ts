/**
 * Re-vectorización del banco con el pipeline conceptual-simbólico (2026-07-24).
 *
 * Reusa exactamente las funciones de producción (geminiService) para que los
 * vectores guardados queden en el MISMO espacio que usan las rutas /recommend.
 *   - Frases:   analyzePhraseStructured → buildPhraseDocument → embedText
 *   - Imágenes: analyzeImageStructured  → buildImageDocument  → embedText
 *
 * Se hizo backup de la DB antes de correr (data/bebetter.db.bak-*).
 * Uso:  npx tsx scripts/revectorize.ts            (frases + imágenes)
 *       npx tsx scripts/revectorize.ts --phrases  (solo frases)
 *       npx tsx scripts/revectorize.ts --images   (solo imágenes)
 */
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { config } from '../src/config'
import {
  analyzeImageStructured,
  analyzePhraseStructured,
  buildImageDocument,
  buildPhraseDocument,
  embedText,
} from '../src/services/geminiService'

const DELAY_MS = 1500 // paid tier gemini-3.5-flash; withRetry absorbe algún 429
const db = new Database(config.paths.db)

const args = process.argv.slice(2)
const doPhrases = args.length === 0 || args.includes('--phrases')
const doImages = args.length === 0 || args.includes('--images')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function revectorizePhrases() {
  const phrases = db.prepare(`SELECT id, text FROM phrases`).all() as any[]
  const update = db.prepare(`
    UPDATE phrases SET descripcion_mood = @descripcion_mood, nivel_energia = @nivel_energia,
      paleta = @paleta, embedding = @embedding WHERE id = @id
  `)
  console.log(`\n=== FRASES: ${phrases.length} ===`)
  let ok = 0
  const errors: string[] = []
  for (const [i, p] of phrases.entries()) {
    try {
      const analysis = await analyzePhraseStructured(p.text)
      const embedding = await embedText(buildPhraseDocument(analysis))
      update.run({
        id: p.id,
        descripcion_mood: analysis.mood,
        nivel_energia: analysis.nivelEnergia,
        paleta: JSON.stringify(analysis.paletaIdeal),
        embedding: Buffer.from(embedding.buffer),
      })
      ok++
      if ((i + 1) % 20 === 0 || i + 1 === phrases.length) console.log(`  frases ${i + 1}/${phrases.length}`)
      await sleep(DELAY_MS)
    } catch (err: any) {
      errors.push(`${p.id}: ${err.message}`)
      console.log(`  ✗ frase ${p.id}: ${err.message}`)
    }
  }
  console.log(`FRASES listas: ${ok}/${phrases.length}  errores: ${errors.length}`)
}

async function revectorizeImages() {
  const files = new Set(
    fs.existsSync(config.paths.images)
      ? fs.readdirSync(config.paths.images)
      : []
  )
  const images = (db.prepare(`SELECT filename FROM images WHERE analysis_json IS NOT NULL`).all() as any[])
    .filter((r) => files.has(r.filename))
  const upsert = db.prepare(`
    INSERT INTO images (filename, tags, analysis_json, embedding, analyzed_at)
    VALUES (@filename, @tags, @analysis_json, @embedding, @analyzed_at)
    ON CONFLICT(filename) DO UPDATE SET
      tags = @tags, analysis_json = @analysis_json, embedding = @embedding, analyzed_at = @analyzed_at
  `)
  console.log(`\n=== IMÁGENES: ${images.length} (con archivo en disco) ===`)
  let ok = 0
  const errors: string[] = []
  for (const [i, img] of images.entries()) {
    try {
      const analysis = await analyzeImageStructured(path.join(config.paths.images, img.filename), 'free')
      const embedding = await embedText(buildImageDocument(analysis))
      const tags = [analysis.emocionDominante, analysis.composicion, ...analysis.paletaColores].slice(0, 8)
      upsert.run({
        filename: img.filename,
        tags: JSON.stringify(tags),
        analysis_json: JSON.stringify(analysis),
        embedding: Buffer.from(embedding.buffer),
        analyzed_at: new Date().toISOString(),
      })
      ok++
      if ((i + 1) % 20 === 0 || i + 1 === images.length) console.log(`  imágenes ${i + 1}/${images.length}`)
      await sleep(DELAY_MS)
    } catch (err: any) {
      errors.push(`${img.filename}: ${err.message}`)
      console.log(`  ✗ img ${img.filename}: ${err.message}`)
    }
  }
  console.log(`IMÁGENES listas: ${ok}/${images.length}  errores: ${errors.length}`)
}

async function run() {
  const t0 = Date.now()
  if (doPhrases) await revectorizePhrases()
  if (doImages) await revectorizeImages()
  console.log(`\n═══ RE-VECTORIZACIÓN COMPLETA en ${((Date.now() - t0) / 60000).toFixed(1)} min ═══`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
