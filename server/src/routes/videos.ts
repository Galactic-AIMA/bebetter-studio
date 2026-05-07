import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import { generateVideo } from '../services/videoGenerator'
import { enqueue } from '../services/queueService'
import { uploadVideoToS3 } from '../services/s3Service'
import { uploadToDrive } from '../services/driveService'
import { sendToWebhook } from '../services/webhookService'
import { GenerateVideoRequest, VideoRecord, Phrase } from '../types'
import { config } from '../config'
import { GenerateVideoSchema } from '../schemas'

const router = Router()

const DB_PATH = path.join(__dirname, '../../../data/videos.json')
const PHRASES_PATH = path.join(__dirname, '../../../data/phrases.json')
const IMAGES_USAGE_PATH = path.join(__dirname, '../../../data/images-usage.json')

function loadVideos(): VideoRecord[] {
  if (!fs.existsSync(DB_PATH)) return []
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))
}

function saveVideos(videos: VideoRecord[]) {
  fs.writeFileSync(DB_PATH, JSON.stringify(videos, null, 2))
}

function incrementPhraseUsage(phraseId: string) {
  if (!fs.existsSync(PHRASES_PATH)) return
  const phrases: Phrase[] = JSON.parse(fs.readFileSync(PHRASES_PATH, 'utf-8'))
  const phrase = phrases.find((p) => p.id === phraseId)
  if (phrase) {
    phrase.usageCount = (phrase.usageCount ?? 0) + 1
    fs.writeFileSync(PHRASES_PATH, JSON.stringify(phrases, null, 2))
  }
}

function incrementImageUsage(imageId: string) {
  const usage: Record<string, number> = fs.existsSync(IMAGES_USAGE_PATH)
    ? JSON.parse(fs.readFileSync(IMAGES_USAGE_PATH, 'utf-8'))
    : {}
  usage[imageId] = (usage[imageId] ?? 0) + 1
  fs.writeFileSync(IMAGES_USAGE_PATH, JSON.stringify(usage, null, 2))
}

// GET /api/videos — listar todos los videos generados
router.get('/', (_req, res) => {
  res.json(loadVideos())
})

// POST /api/videos/generate — generar un video nuevo
router.post('/generate', async (req, res) => {
  const parsed = GenerateVideoSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, details: parsed.error.issues })

  try {
    const { config: vidConfig, phraseId } = parsed.data

    const id = uuidv4()
    const phraseText = vidConfig.text.content || ''
    const dotIndex = phraseText.indexOf('.')
    const rawTitle = dotIndex !== -1 ? phraseText.slice(0, dotIndex) : phraseText
    const base = rawTitle.replace(/[\\/:*?"<>|]/g, '').trim() || 'video'
    let outputName = base
    let counter = 2
    while (fs.existsSync(path.join(config.paths.output, 'videos', `${outputName}.mp4`))) {
      outputName = `${base} (${counter++})`
    }

    const { filename, localPath, publicUrl } = await enqueue(() => generateVideo(vidConfig as any, outputName))

    const record: VideoRecord = {
      id,
      filename,
      title: base,
      description: '',
      tags: [],
      localPath,
      publicUrl,
      phraseId: phraseId ?? undefined,
      createdAt: new Date().toISOString(),
      config: vidConfig,
    }

    const videos = loadVideos()
    videos.unshift(record)
    saveVideos(videos)

    res.json({ success: true, video: record })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/videos/:id/upload-s3 — subir video a S3
router.post('/:id/upload-s3', async (req, res) => {
  try {
    const videos = loadVideos()
    const video = videos.find((v) => v.id === req.params.id)
    if (!video) return res.status(404).json({ error: 'Video not found' })

    const s3Url = await uploadVideoToS3(video.localPath, video.filename)
    video.s3Url = s3Url

    saveVideos(videos)
    res.json({ success: true, s3Url })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/videos/:id/upload-drive — subir video a Google Drive
router.post('/:id/upload-drive', async (req, res) => {
  try {
    const videos = loadVideos()
    const video = videos.find((v) => v.id === req.params.id)
    if (!video) return res.status(404).json({ error: 'Video not found' })

    const driveUrl = await uploadToDrive(video.localPath, video.filename)
    video.driveUrl = driveUrl

    saveVideos(videos)

    // Incrementar contadores solo al subir a Drive
    if (video.phraseId) incrementPhraseUsage(video.phraseId)
    if (video.config.imageId) incrementImageUsage(video.config.imageId)

    res.json({ success: true, driveUrl })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/videos/:id/publish — enviar webhook a n8n
router.post('/:id/publish', async (req, res) => {
  try {
    const { env = 'test' } = req.body
    const videos = loadVideos()
    const video = videos.find((v) => v.id === req.params.id)
    if (!video) return res.status(404).json({ error: 'Video not found' })

    if (!video.s3Url) {
      const s3Url = await uploadVideoToS3(video.localPath, video.filename)
      video.s3Url = s3Url
      saveVideos(videos)
    }

    await sendToWebhook(
      {
        videoUrl: video.s3Url,
        phrase: video.config.text.content,
        filename: video.filename,
        createdAt: video.createdAt,
      },
      env
    )

    res.json({ success: true, sentTo: env, videoUrl: video.s3Url })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/videos/:id — eliminar video
router.delete('/:id', (req, res) => {
  const videos = loadVideos()
  const idx = videos.findIndex((v) => v.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Video not found' })

  const [video] = videos.splice(idx, 1)
  if (fs.existsSync(video.localPath)) fs.unlinkSync(video.localPath)
  saveVideos(videos)

  res.json({ success: true })
})

export default router
