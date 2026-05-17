import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { config } from '../config'
import { analyzeImage, extractMoodKeywords } from '../services/geminiService'
import db from '../db'

const router = Router()

const SUPPORTED = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif']

function getImageFiles(): string[] {
  const dir = config.paths.images
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => SUPPORTED.includes(path.extname(f).toLowerCase()))
}

// POST /api/images/analyze-all — analiza todas las imágenes sin tags
router.post('/analyze-all', async (_req, res) => {
  const files = getImageFiles()

  const analyzedSet = new Set(
    (db.prepare(`SELECT filename FROM images WHERE tags IS NOT NULL AND tags != '[]'`).all() as any[])
      .map((r) => r.filename)
  )

  const upsert = db.prepare(`
    INSERT INTO images (filename, tags, analyzed_at)
    VALUES (@filename, @tags, @analyzed_at)
    ON CONFLICT(filename) DO UPDATE SET tags = @tags, analyzed_at = @analyzed_at
  `)

  let processed = 0
  let skipped = 0
  const errors: string[] = []

  for (const filename of files) {
    if (analyzedSet.has(filename)) { skipped++; continue }
    try {
      const imagePath = path.join(config.paths.images, filename)
      const tags = await analyzeImage(imagePath)
      upsert.run({ filename, tags: JSON.stringify(tags), analyzed_at: new Date().toISOString() })
      processed++
      // 6s entre peticiones para respetar el límite de 10 RPM de gemini-2.5-flash
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
    const tags = await analyzeImage(imagePath)
    db.prepare(`
      INSERT INTO images (filename, tags, analyzed_at)
      VALUES (@filename, @tags, @analyzed_at)
      ON CONFLICT(filename) DO UPDATE SET tags = @tags, analyzed_at = @analyzed_at
    `).run({ filename, tags: JSON.stringify(tags), analyzed_at: new Date().toISOString() })
    res.json({ filename, tags })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/images/recommend — recibe phrase, devuelve imageIds ordenados por compatibilidad
router.post('/recommend', async (req, res) => {
  const { phrase } = req.body
  if (!phrase || typeof phrase !== 'string') return res.status(400).json({ error: 'phrase required' })

  try {
    const keywords = await extractMoodKeywords(phrase)
    const rows = db.prepare(`SELECT filename, tags FROM images WHERE tags IS NOT NULL AND tags != '[]'`).all() as any[]

    const scores = rows
      .map((row) => {
        const imageTags: string[] = JSON.parse(row.tags)
        const matches = keywords.filter((k) => imageTags.includes(k)).length
        const score = keywords.length > 0 ? matches / keywords.length : 0
        return { imageId: row.filename, score, matches }
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)

    res.json({ keywords, recommendations: scores })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
