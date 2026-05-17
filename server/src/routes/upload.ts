import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { config } from '../config'
import { analyzeImage } from '../services/geminiService'
import db from '../db'

const router = Router()

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = config.paths.images
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    const name = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`
    cb(null, name)
  },
})

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif']
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, allowed.includes(ext))
  },
  limits: { fileSize: 20 * 1024 * 1024 },  // 20 MB max
})

// POST /api/upload/image — subir imagen al banco local
router.post('/image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' })
  res.json({
    id: req.file.filename,
    filename: req.file.filename,
    url: `/api/images/file/${encodeURIComponent(req.file.filename)}`,
  })
  // Analizar en background sin bloquear la respuesta
  const filePath = req.file.path
  const filename = req.file.filename
  analyzeImage(filePath).then((tags) => {
    db.prepare(`
      INSERT INTO images (filename, tags, analyzed_at)
      VALUES (@filename, @tags, @analyzed_at)
      ON CONFLICT(filename) DO UPDATE SET tags = @tags, analyzed_at = @analyzed_at
    `).run({ filename, tags: JSON.stringify(tags), analyzed_at: new Date().toISOString() })
  }).catch(() => { /* silencioso — el usuario puede re-analizar manualmente */ })
})

export default router
