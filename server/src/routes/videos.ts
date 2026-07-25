import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import { generateVideo, extractThumbnail } from '../services/videoGenerator'
import { enqueue } from '../services/queueService'
import { uploadVideoToS3, uploadThumbnailToS3 } from '../services/s3Service'
import { uploadToDrive } from '../services/driveService'
import { sendToWebhook, sendToApprovalWebhook } from '../services/webhookService'
import { appendQueueRows, QueueRow } from '../services/sheetsService'
import { generateCopies } from '../services/geminiService'
import { pickAudioForPhrase } from '../services/audioMatching'
import { bumpAudioUsage } from '../services/audioMetadata'
import { GenerateVideoRequest } from '../types'
import { config } from '../config'
import { GenerateVideoSchema } from '../schemas'
import { rowToVideoRecord } from '../utils/recordMappers'
import { logInfo, logError } from '../services/logService'
import db from '../db'

const router = Router()

/**
 * Asegura que el video esté en R2 (sube si falta) y genera la miniatura del
 * segundo 5 (best-effort). Compartido por /publish (carril express) y /queue
 * (envío a aprobación). Si el MP4 local ya no existe (cleanup >24h) omite la
 * miniatura sin romper.
 */
async function ensureR2AndThumbnail(row: any): Promise<{ s3Url: string; thumbnailUrl?: string }> {
  let s3Url = row.s3_url
  if (!s3Url) {
    s3Url = await uploadVideoToS3(row.local_path, row.filename)
    db.prepare(`UPDATE videos SET s3_url = ? WHERE id = ?`).run(s3Url, row.id)
  }

  let thumbnailUrl: string | undefined
  try {
    if (row.local_path && fs.existsSync(row.local_path)) {
      const thumb = await extractThumbnail(row.local_path, path.parse(row.filename).name)
      thumbnailUrl = await uploadThumbnailToS3(thumb.localPath, thumb.filename)
      logInfo('publish', `Miniatura generada: ${thumb.filename}`)
    } else {
      logInfo('publish', `Sin miniatura: archivo local no disponible (${row.filename})`)
    }
  } catch (err: any) {
    logError('publish', `Error generando miniatura (${row.filename})`, err.message)
  }

  return { s3Url, thumbnailUrl }
}

// GET /api/videos — listar todos los videos generados
router.get('/', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM videos ORDER BY created_at DESC`).all() as any[]
  res.json(rows.map(rowToVideoRecord))
})

// POST /api/videos/generate — generar un video nuevo
router.post('/generate', async (req, res) => {
  const parsed = GenerateVideoSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, details: parsed.error.issues })

  try {
    const { config: vidConfig, phraseId } = parsed.data

    // Auto-pick de audio por mood si no se eligió pista (o se eligió "auto").
    if ((!vidConfig.audioTrack || vidConfig.audioTrack === 'auto') && phraseId) {
      const pick = pickAudioForPhrase(phraseId)
      vidConfig.audioTrack = pick ? pick.filename : undefined
      if (pick) logInfo('generate', `Audio auto: ${pick.filename} (score ${pick.score.toFixed(2)}, mood ${pick.moodCategory})`)
    } else if (vidConfig.audioTrack === 'auto') {
      vidConfig.audioTrack = undefined // "auto" sin phraseId → sin audio
    }
    if (vidConfig.audioTrack) bumpAudioUsage(vidConfig.audioTrack)

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

    const createdAt = new Date().toISOString()
    db.prepare(`
      INSERT INTO videos
        (id, filename, title, description, tags, local_path, public_url,
         phrase_id, viral, font, effect, resolution, config_extra, created_at)
      VALUES
        (@id, @filename, @title, @description, @tags, @local_path, @public_url,
         @phrase_id, 0, @font, @effect, @resolution, @config_extra, @created_at)
    `).run({
      id,
      filename,
      title:        base,
      description:  '',
      tags:         JSON.stringify([]),
      local_path:   localPath,
      public_url:   publicUrl,
      phrase_id:    phraseId ?? null,
      font:         vidConfig.text.font,
      effect:       vidConfig.textEffect ?? null,
      resolution:   `${vidConfig.resolution.width}x${vidConfig.resolution.height}`,
      config_extra: JSON.stringify(vidConfig),
      created_at:   createdAt,
    })

    const record = rowToVideoRecord(
      db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id) as any
    )

    logInfo('generate', `Video generado: ${filename}`)
    res.json({ success: true, video: record })
  } catch (err: any) {
    logError('generate', 'Error generando video', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/videos/:id/upload-s3 — subir video a S3
router.post('/:id/upload-s3', async (req, res) => {
  try {
    const row = db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id) as any
    if (!row) return res.status(404).json({ error: 'Video not found' })

    const s3Url = await uploadVideoToS3(row.local_path, row.filename)
    db.prepare(`UPDATE videos SET s3_url = ? WHERE id = ?`).run(s3Url, req.params.id)

    logInfo('s3', `Video subido a R2: ${row.filename}`)
    res.json({ success: true, s3Url })
  } catch (err: any) {
    logError('s3', 'Error subiendo a R2', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/videos/:id/upload-drive — subir video a Google Drive
router.post('/:id/upload-drive', async (req, res) => {
  try {
    const row = db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id) as any
    if (!row) return res.status(404).json({ error: 'Video not found' })

    const driveUrl = await uploadToDrive(row.local_path, row.filename)
    db.prepare(`UPDATE videos SET drive_url = ? WHERE id = ?`).run(driveUrl, req.params.id)

    // Incrementar contadores solo al subir a Drive
    if (row.phrase_id) {
      db.prepare(`UPDATE phrases SET usage_count = usage_count + 1 WHERE id = ?`).run(row.phrase_id)
    }
    const cfg = row.config_extra ? JSON.parse(row.config_extra) : {}
    if (cfg.imageId) {
      db.prepare(`
        INSERT INTO images (filename, usage_count) VALUES (@f, 1)
        ON CONFLICT(filename) DO UPDATE SET usage_count = usage_count + 1
      `).run({ f: cfg.imageId })
    }

    logInfo('drive', `Video subido a Drive: ${row.filename}`)
    res.json({ success: true, driveUrl })
  } catch (err: any) {
    logError('drive', 'Error subiendo video a Drive', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/videos/:id/publish — enviar webhook a n8n
router.post('/:id/publish', async (req, res) => {
  try {
    const { env = 'test' } = req.body
    const row = db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id) as any
    if (!row) return res.status(404).json({ error: 'Video not found' })

    const { s3Url, thumbnailUrl } = await ensureR2AndThumbnail(row)
    const cfg = row.config_extra ? JSON.parse(row.config_extra) : {}

    await sendToWebhook(
      {
        videoUrl: s3Url,
        phrase: cfg.text?.content ?? '',
        filename: row.filename,
        createdAt: row.created_at,
        thumbnailUrl,
      },
      env
    )

    logInfo('publish', `Publicado a n8n (${env}): ${row.filename}`)
    res.json({ success: true, sentTo: env, videoUrl: s3Url })
  } catch (err: any) {
    logError('publish', `Error publicando a n8n (${req.body?.env ?? 'test'})`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/videos/:id/queue — enviar a aprobación (Fase 4): sube a R2 + escribe
// una fila `pending` en la cola (Google Sheet). n8n genera copies y manda el
// paquete a Telegram; los copies quedan vacíos aquí.
router.post('/:id/queue', async (req, res) => {
  try {
    // Falla rápido si n8n no está configurado (evita generar copies y una fila huérfana)
    if (!config.webhooks.approval) {
      return res.status(500).json({ error: 'WEBHOOK_APPROVAL_URL no está configurado' })
    }

    const row = db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id) as any
    if (!row) return res.status(404).json({ error: 'Video not found' })

    const { s3Url, thumbnailUrl } = await ensureR2AndThumbnail(row)
    const cfg = row.config_extra ? JSON.parse(row.config_extra) : {}
    const phrase = cfg.text?.content ?? ''

    // Genera copies (IG + YT) aquí; se guardan en la cola. n8n solo manda a Telegram.
    const copies = await generateCopies(phrase)

    const queueRow: QueueRow = {
      id: uuidv4(),
      videoUrl: s3Url,
      thumbnailUrl,
      phrase,
      captionIG: copies.captionIG,
      ytMeta: copies.ytMeta,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    await appendQueueRows([queueRow])

    // Pinga a n8n para que envíe el paquete (video + caption + botones) a Telegram.
    await sendToApprovalWebhook({
      queueId: queueRow.id,
      videoUrl: s3Url,
      thumbnailUrl,
      phrase,
      captionIG: copies.captionIG,
    })

    logInfo('publish', `Enviado a aprobación: ${row.filename}`)
    res.json({ success: true, queueId: queueRow.id })
  } catch (err: any) {
    logError('publish', `Error enviando a aprobación (${req.params.id})`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/videos/:id — eliminar video
router.delete('/:id', (req, res) => {
  const row = db.prepare(`SELECT local_path FROM videos WHERE id = ?`).get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Video not found' })

  if (fs.existsSync(row.local_path)) fs.unlinkSync(row.local_path)
  db.prepare(`DELETE FROM videos WHERE id = ?`).run(req.params.id)

  res.json({ success: true })
})

export default router
