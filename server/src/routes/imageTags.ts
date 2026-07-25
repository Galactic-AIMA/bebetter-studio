import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { config } from '../config'
import {
  analyzeImageStructured,
  analyzePhraseStructured,
  buildImageDocument,
  buildPhraseDocument,
  embedText,
  ImageAnalysis,
} from '../services/geminiService'
import { cosine, rerankScore } from '../utils/matching'
import db from '../db'

const router = Router()

const SUPPORTED = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif']

function getImageFiles(): string[] {
  const dir = config.paths.images
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => SUPPORTED.includes(path.extname(f).toLowerCase()))
}

// Cache en memoria de embeddings de imágenes
let embeddingCache: Map<string, { embedding: Float32Array; analysis: ImageAnalysis }> | null = null

function loadEmbeddingCache(): Map<string, { embedding: Float32Array; analysis: ImageAnalysis }> {
  const rows = db.prepare(`
    SELECT filename, analysis_json, embedding FROM images
    WHERE analysis_json IS NOT NULL AND embedding IS NOT NULL
  `).all() as any[]

  const cache = new Map<string, { embedding: Float32Array; analysis: ImageAnalysis }>()
  for (const row of rows) {
    try {
      const analysis = JSON.parse(row.analysis_json) as ImageAnalysis
      const embedding = new Float32Array((row.embedding as Buffer).buffer)
      cache.set(row.filename, { embedding, analysis })
    } catch (_) { /* registro corrupto, ignorar */ }
  }
  return cache
}

function getCache(): Map<string, { embedding: Float32Array; analysis: ImageAnalysis }> {
  if (!embeddingCache) embeddingCache = loadEmbeddingCache()
  return embeddingCache
}

function invalidateCache() {
  embeddingCache = null
}

const upsertImage = () => db.prepare(`
  INSERT INTO images (filename, tags, analysis_json, embedding, analyzed_at)
  VALUES (@filename, @tags, @analysis_json, @embedding, @analyzed_at)
  ON CONFLICT(filename) DO UPDATE SET
    tags = @tags,
    analysis_json = @analysis_json,
    embedding = @embedding,
    analyzed_at = @analyzed_at
`)

// POST /api/images/analyze-all — analiza imágenes y genera su embedding conceptual
// Body opcional: { limit: number } para probar con pocas; { force: true } para
// re-analizar TODAS (necesario tras cambiar el prompt/documento de embedding);
// { only: string[] } para restringir a filenames concretos (validación de subset)
router.post('/analyze-all', async (req, res) => {
  const limit: number | undefined = req.body?.limit ? parseInt(req.body.limit) : undefined
  const force: boolean = req.body?.force === true
  const only: string[] | undefined = Array.isArray(req.body?.only) ? req.body.only : undefined
  let files = getImageFiles()
  if (only) files = files.filter((f) => only.includes(f))

  const analyzedSet = new Set(
    (db.prepare(`SELECT filename FROM images WHERE analysis_json IS NOT NULL`).all() as any[])
      .map((r) => r.filename)
  )

  let processed = 0
  let skipped = 0
  const errors: string[] = []

  for (const filename of files) {
    if (limit && processed >= limit) break
    if (!force && analyzedSet.has(filename)) { skipped++; continue }
    try {
      const imagePath = path.join(config.paths.images, filename)
      const analysis = await analyzeImageStructured(imagePath)
      const embedding = await embedText(buildImageDocument(analysis))
      const tags = [analysis.emocionDominante, analysis.composicion, ...analysis.paletaColores].slice(0, 8)

      upsertImage().run({
        filename,
        tags: JSON.stringify(tags),
        analysis_json: JSON.stringify(analysis),
        embedding: Buffer.from(embedding.buffer),
        analyzed_at: new Date().toISOString(),
      })
      processed++
      invalidateCache()
      await new Promise((r) => setTimeout(r, 6000))
    } catch (err: any) {
      errors.push(`${filename}: ${err.message}`)
    }
  }

  res.json({ processed, skipped, errors })
})

// POST /api/images/analyze/:filename — analiza una imagen específica
router.post('/analyze/:filename', async (req, res) => {
  const filename = decodeURIComponent(req.params.filename)
  const imagePath = path.join(config.paths.images, filename)
  if (!fs.existsSync(imagePath)) return res.status(404).json({ error: 'Image not found' })

  try {
    const analysis = await analyzeImageStructured(imagePath)
    const embedding = await embedText(buildImageDocument(analysis))
    const tags = [analysis.emocionDominante, analysis.composicion, ...analysis.paletaColores].slice(0, 8)

    upsertImage().run({
      filename,
      tags: JSON.stringify(tags),
      analysis_json: JSON.stringify(analysis),
      embedding: Buffer.from(embedding.buffer),
      analyzed_at: new Date().toISOString(),
    })
    invalidateCache()
    res.json({ filename, analysis, tags })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

const TOP_N = 20

// POST /api/images/recommend — matching semántico con embeddings pre-computados
// Body: { phraseId?: string, phrase?: string, topN?: number }
router.post('/recommend', async (req, res) => {
  const { phraseId, phrase, topN } = req.body
  if (!phraseId && !phrase) return res.status(400).json({ error: 'phraseId or phrase required' })
  const limit = Math.min(topN ?? TOP_N, 200)

  try {
    let phraseEmbedding: Float32Array | null = null
    let descripcionMood = ''
    let phraseEnergia: number | null = null
    let phrasePaleta: string[] | null = null

    // Usar embedding + señales pre-computadas si existen
    if (phraseId) {
      const row = db.prepare(
        `SELECT embedding, descripcion_mood, nivel_energia, paleta FROM phrases WHERE id = ?`
      ).get(phraseId) as any
      if (row?.embedding) {
        phraseEmbedding = new Float32Array((row.embedding as Buffer).buffer)
        descripcionMood = row.descripcion_mood ?? ''
        phraseEnergia = row.nivel_energia ?? null
        phrasePaleta = row.paleta ? JSON.parse(row.paleta) : null
      }
    }

    // Fallback: analizar y vectorizar en tiempo real (mismo builder que los
    // vectores guardados → coherencia del espacio de embeddings)
    if (!phraseEmbedding) {
      const text = phrase || phraseId!
      const analysis = await analyzePhraseStructured(text)
      descripcionMood = analysis.mood
      phraseEnergia = analysis.nivelEnergia
      phrasePaleta = analysis.paletaIdeal
      phraseEmbedding = await embedText(buildPhraseDocument(analysis))
    }

    const cache = getCache()
    if (cache.size === 0) return res.json({ descripcionMood, recommendations: [] })

    const scores: { imageId: string; score: number }[] = []
    for (const [filename, { embedding: imgEmbedding, analysis }] of cache) {
      const cos = cosine(phraseEmbedding, imgEmbedding)
      const score = rerankScore(cos, {
        energiaA: phraseEnergia,
        energiaB: analysis?.nivelEnergia,
        paletaA: phrasePaleta,
        paletaB: analysis?.paletaColores,
      })
      scores.push({ imageId: filename, score })
    }

    scores.sort((a, b) => b.score - a.score)
    res.json({ descripcionMood, recommendations: scores.slice(0, limit) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
