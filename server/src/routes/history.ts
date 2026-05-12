import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { VideoRecord, ImageRecord } from '../types'

const router = Router()

const VIDEOS_PATH = path.join(__dirname, '../../../data/videos.json')
const IMAGES_PATH = path.join(__dirname, '../../../data/images-output.json')

function loadVideos(): VideoRecord[] {
  if (!fs.existsSync(VIDEOS_PATH)) return []
  return JSON.parse(fs.readFileSync(VIDEOS_PATH, 'utf-8'))
}

function loadImages(): ImageRecord[] {
  if (!fs.existsSync(IMAGES_PATH)) return []
  return JSON.parse(fs.readFileSync(IMAGES_PATH, 'utf-8'))
}

// GET /api/history — videos e imágenes mezclados ordenados por fecha
router.get('/', (_req, res) => {
  const videos = loadVideos().map((v) => ({ ...v, kind: 'video' as const }))
  const images = loadImages().map((i) => ({ ...i, kind: 'image' as const }))
  const merged = [...videos, ...images].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  res.json(merged)
})

// PATCH /api/history/videos/:id/viral
router.patch('/videos/:id/viral', (req, res) => {
  if (!fs.existsSync(VIDEOS_PATH)) return res.status(404).json({ error: 'Not found' })
  const videos: VideoRecord[] = JSON.parse(fs.readFileSync(VIDEOS_PATH, 'utf-8'))
  const video = videos.find((v) => v.id === req.params.id)
  if (!video) return res.status(404).json({ error: 'Video not found' })
  video.viral = typeof req.body.viral === 'boolean' ? req.body.viral : !video.viral
  fs.writeFileSync(VIDEOS_PATH, JSON.stringify(videos, null, 2))
  res.json({ success: true, viral: video.viral })
})

// PATCH /api/history/images/:id/viral
router.patch('/images/:id/viral', (req, res) => {
  if (!fs.existsSync(IMAGES_PATH)) return res.status(404).json({ error: 'Not found' })
  const images: ImageRecord[] = JSON.parse(fs.readFileSync(IMAGES_PATH, 'utf-8'))
  const image = images.find((i) => i.id === req.params.id)
  if (!image) return res.status(404).json({ error: 'Image not found' })
  image.viral = typeof req.body.viral === 'boolean' ? req.body.viral : !image.viral
  fs.writeFileSync(IMAGES_PATH, JSON.stringify(images, null, 2))
  res.json({ success: true, viral: image.viral })
})

export default router
