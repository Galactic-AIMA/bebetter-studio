import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { config } from '../config'
import { analyzeImage, extractMoodKeywords } from '../services/geminiService'

const router = Router()

const METADATA_PATH = path.join(__dirname, '../../../data/images-metadata.json')
const SUPPORTED = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif']

interface ImageMeta {
  tags: string[]
  analyzedAt: string
}

function loadMetadata(): Record<string, ImageMeta> {
  if (!fs.existsSync(METADATA_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8')) } catch { return {} }
}

function saveMetadata(data: Record<string, ImageMeta>) {
  fs.writeFileSync(METADATA_PATH, JSON.stringify(data, null, 2))
}

function getImageFiles(): string[] {
  const dir = config.paths.images
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => SUPPORTED.includes(path.extname(f).toLowerCase()))
}

// POST /api/images/analyze-all — analiza todas las imágenes sin tags
router.post('/analyze-all', async (_req, res) => {
  const files = getImageFiles()
  const metadata = loadMetadata()
  let processed = 0
  let skipped = 0
  const errors: string[] = []

  for (const filename of files) {
    if (metadata[filename]?.tags?.length > 0) { skipped++; continue }
    try {
      const imagePath = path.join(config.paths.images, filename)
      const tags = await analyzeImage(imagePath)
      metadata[filename] = { tags, analyzedAt: new Date().toISOString() }
      saveMetadata(metadata)
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
    const metadata = loadMetadata()
    metadata[filename] = { tags, analyzedAt: new Date().toISOString() }
    saveMetadata(metadata)
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
    const metadata = loadMetadata()

    const scores = Object.entries(metadata)
      .map(([imageId, meta]) => {
        const matches = keywords.filter((k) => meta.tags.includes(k)).length
        const score = keywords.length > 0 ? matches / keywords.length : 0
        return { imageId, score, matches }
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)

    res.json({ keywords, recommendations: scores })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export { loadMetadata }
export default router
