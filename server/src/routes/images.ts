import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import { ImageItem } from '../types'
import { loadMetadata } from './imageTags'

const IMAGES_USAGE_PATH = path.join(__dirname, '../../../data/images-usage.json')

function loadUsage(): Record<string, number> {
  if (!fs.existsSync(IMAGES_USAGE_PATH)) return {}
  return JSON.parse(fs.readFileSync(IMAGES_USAGE_PATH, 'utf-8'))
}

const router = Router()

const SUPPORTED = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif']

// .jfif y otros no están en la base MIME por defecto de Express
const MIME_OVERRIDES: Record<string, string> = {
  '.jfif': 'image/jpeg',
  '.tif':  'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
}

// GET /api/images — listar imágenes del banco local
router.get('/', (_req, res) => {
  try {
    const dir = config.paths.images
    if (!fs.existsSync(dir)) return res.json([])

    const files = fs.readdirSync(dir).filter((f) =>
      SUPPORTED.includes(path.extname(f).toLowerCase())
    )

    const usage = loadUsage()
    const metadata = loadMetadata()
    const images: ImageItem[] = files.map((filename) => ({
      id: filename,
      filename,
      path: path.join(dir, filename),
      url: `/api/images/file/${encodeURIComponent(filename)}`,
      usageCount: usage[filename] ?? 0,
      tags: metadata[filename]?.tags,
      analyzedAt: metadata[filename]?.analyzedAt,
    }))

    res.json(images)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/images/random — imagen aleatoria
router.get('/random', (_req, res) => {
  try {
    const dir = config.paths.images
    const files = fs.readdirSync(dir).filter((f) =>
      SUPPORTED.includes(path.extname(f).toLowerCase())
    )
    if (!files.length) return res.status(404).json({ error: 'No images found' })

    const metadata = loadMetadata()
    // Preferir imágenes ya analizadas para que el matching de frases funcione
    const analyzed = files.filter((f) => (metadata[f]?.tags?.length ?? 0) > 0)
    const pool = analyzed.length > 0 ? analyzed : files
    const filename = pool[Math.floor(Math.random() * pool.length)]

    res.json({
      id: filename,
      filename,
      path: path.join(dir, filename),
      url: `/api/images/file/${encodeURIComponent(filename)}`,
      tags: metadata[filename]?.tags,
      analyzedAt: metadata[filename]?.analyzedAt,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/images/file/:filename — servir imagen con content-type correcto
router.get('/file/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename)
  const filepath = path.join(config.paths.images, filename)
  if (!fs.existsSync(filepath)) return res.status(404).end()

  const ext = path.extname(filename).toLowerCase()
  const mime = MIME_OVERRIDES[ext]
  if (mime) res.setHeader('Content-Type', mime)

  res.sendFile(filepath)
})

export default router
