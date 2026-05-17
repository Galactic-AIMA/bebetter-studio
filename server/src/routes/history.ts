import { Router } from 'express'
import { rowToVideoRecord, rowToImageRecord } from '../utils/recordMappers'
import db from '../db'

const router = Router()

// GET /api/history — videos e imágenes mezclados ordenados por fecha
router.get('/', (_req, res) => {
  const videos = (db.prepare(`SELECT * FROM videos`).all() as any[])
    .map((r) => ({ ...rowToVideoRecord(r), kind: 'video' as const }))
  const images = (db.prepare(`SELECT * FROM images_output`).all() as any[])
    .map((r) => ({ ...rowToImageRecord(r), kind: 'image' as const }))
  const merged = [...videos, ...images].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  res.json(merged)
})

// PATCH /api/history/videos/:id/viral
router.patch('/videos/:id/viral', (req, res) => {
  const row = db.prepare(`SELECT viral FROM videos WHERE id = ?`).get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Video not found' })

  const newViral = typeof req.body.viral === 'boolean'
    ? (req.body.viral ? 1 : 0)
    : (row.viral ? 0 : 1)
  db.prepare(`UPDATE videos SET viral = ? WHERE id = ?`).run(newViral, req.params.id)

  res.json({ success: true, viral: newViral === 1 })
})

// PATCH /api/history/images/:id/viral
router.patch('/images/:id/viral', (req, res) => {
  const row = db.prepare(`SELECT viral FROM images_output WHERE id = ?`).get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Image not found' })

  const newViral = typeof req.body.viral === 'boolean'
    ? (req.body.viral ? 1 : 0)
    : (row.viral ? 0 : 1)
  db.prepare(`UPDATE images_output SET viral = ? WHERE id = ?`).run(newViral, req.params.id)

  res.json({ success: true, viral: newViral === 1 })
})

export default router
