import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import { ImageItem } from '../types'
import db from '../db'

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

    const dbRows = new Map(
      (db.prepare(`SELECT filename, tags, analyzed_at, usage_count FROM images`).all() as any[])
        .map((r) => [r.filename, r])
    )

    const images: ImageItem[] = files.map((filename) => {
      const row = dbRows.get(filename)
      return {
        id: filename,
        filename,
        path: path.join(dir, filename),
        url: `/api/images/file/${encodeURIComponent(filename)}`,
        usageCount: row?.usage_count ?? 0,
        tags: row?.tags ? JSON.parse(row.tags) : undefined,
        analyzedAt: row?.analyzed_at ?? undefined,
      }
    })

    res.json(images)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/images/random — imagen aleatoria
router.get('/random', (_req, res) => {
  try {
    const dir = config.paths.images
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'No images found' })

    const files = fs.readdirSync(dir).filter((f) =>
      SUPPORTED.includes(path.extname(f).toLowerCase())
    )
    if (!files.length) return res.status(404).json({ error: 'No images found' })

    // Preferir imágenes ya analizadas para que el matching de frases funcione
    const analyzedSet = new Set(
      (db.prepare(`SELECT filename FROM images WHERE tags IS NOT NULL AND tags != '[]'`).all() as any[])
        .map((r) => r.filename)
    )
    const analyzed = files.filter((f) => analyzedSet.has(f))
    const pool = analyzed.length > 0 ? analyzed : files
    const filename = pool[Math.floor(Math.random() * pool.length)]

    const row = db.prepare(`SELECT tags, analyzed_at FROM images WHERE filename = ?`).get(filename) as any

    res.json({
      id: filename,
      filename,
      path: path.join(dir, filename),
      url: `/api/images/file/${encodeURIComponent(filename)}`,
      tags: row?.tags ? JSON.parse(row.tags) : undefined,
      analyzedAt: row?.analyzed_at ?? undefined,
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
