import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { config } from '../config'
import { analyzeImageStructured, extractMoodDescription, embedText, ImageAnalysis } from '../services/geminiService'
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

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
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

// POST /api/images/analyze-all — analiza todas las imágenes sin análisis estructurado
// Body opcional: { limit: number } para probar con pocas imágenes
router.post('/analyze-all', async (req, res) => {
  const limit: number | undefined = req.body?.limit ? parseInt(req.body.limit) : undefined
  const files = getImageFiles()

  const analyzedSet = new Set(
    (db.prepare(`SELECT filename FROM images WHERE analysis_json IS NOT NULL`).all() as any[])
      .map((r) => r.filename)
  )

  let processed = 0
  let skipped = 0
  const errors: string[] = []

  for (const filename of files) {
    if (limit && processed >= limit) break
    if (analyzedSet.has(filename)) { skipped++; continue }
    try {
      const imagePath = path.join(config.paths.images, filename)
      const analysis = await analyzeImageStructured(imagePath)
      const embedding = await embedText(analysis.descripcionMood)
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
    const embedding = await embedText(analysis.descripcionMood)
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

    // Usar embedding pre-computado si existe
    if (phraseId) {
      const row = db.prepare(`SELECT embedding, descripcion_mood FROM phrases WHERE id = ?`).get(phraseId) as any
      if (row?.embedding) {
        phraseEmbedding = new Float32Array((row.embedding as Buffer).buffer)
        descripcionMood = row.descripcion_mood ?? ''
      }
    }

    // Fallback: generar embedding en tiempo real
    if (!phraseEmbedding) {
      const text = phrase || phraseId!
      descripcionMood = await extractMoodDescription(text)
      phraseEmbedding = await embedText(descripcionMood)
    }

    const cache = getCache()
    if (cache.size === 0) return res.json({ descripcionMood, recommendations: [] })

    const scores: { imageId: string; score: number }[] = []
    for (const [filename, { embedding: imgEmbedding }] of cache) {
      scores.push({ imageId: filename, score: cosineSimilarity(phraseEmbedding, imgEmbedding) })
    }

    scores.sort((a, b) => b.score - a.score)
    res.json({ descripcionMood, recommendations: scores.slice(0, limit) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
