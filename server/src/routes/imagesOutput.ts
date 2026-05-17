import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import { generateImage } from '../services/imageGenerator'
import { enqueue } from '../services/queueService'
import { uploadToDrive } from '../services/driveService'
import { ImageConfig, ImageVariant } from '../types'
import { config } from '../config'
import { GenerateImageSchema } from '../schemas'
import { rowToImageRecord } from '../utils/recordMappers'
import db from '../db'

const router = Router()

// GET /api/images-output — listar imágenes generadas
router.get('/', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM images_output ORDER BY created_at DESC`).all() as any[]
  res.json(rows.map(rowToImageRecord))
})

// POST /api/images-output/generate
router.post('/generate', async (req, res) => {
  const parsed = GenerateImageSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, details: parsed.error.issues })

  try {
    const { config: imgConfig, phraseId, variant = 'combined' } = parsed.data

    const phraseText = imgConfig.text.content || ''
    const cleanText = phraseText.split('//')[0].trim()
    const dotIndex = cleanText.indexOf('.')
    const rawTitle = dotIndex !== -1 ? cleanText.slice(0, dotIndex) : cleanText
    const base = rawTitle.replace(/[\\/:*?"<>|]/g, '').trim() || 'imagen'

    const suffix = variant !== 'combined' ? `_${variant}` : ''
    let outputName = base
    let counter = 2
    while (fs.existsSync(path.join(config.paths.output, 'images', `${outputName}${suffix}.jpg`))) {
      outputName = `${base} (${counter++})`
    }

    const result = await enqueue(() => generateImage({
      imagePath: imgConfig.imagePath,
      text: imgConfig.text,
      resolution: imgConfig.resolution,
      outputName,
      variant,
      watermark: imgConfig.watermark,
      source: imgConfig.source,
    }))

    const id = uuidv4()
    const createdAt = new Date().toISOString()

    db.prepare(`
      INSERT INTO images_output
        (id, filename, local_path, public_url, phrase_id, variant,
         viral, font, resolution, config_extra, created_at)
      VALUES
        (@id, @filename, @local_path, @public_url, @phrase_id, @variant,
         0, @font, @resolution, @config_extra, @created_at)
    `).run({
      id,
      filename:     result.filename,
      local_path:   result.localPath,
      public_url:   result.publicUrl,
      phrase_id:    phraseId ?? null,
      variant:      result.variant,
      font:         imgConfig.text.font,
      resolution:   `${imgConfig.resolution.width}x${imgConfig.resolution.height}`,
      config_extra: JSON.stringify(imgConfig),
      created_at:   createdAt,
    })

    const record = rowToImageRecord(
      db.prepare(`SELECT * FROM images_output WHERE id = ?`).get(id) as any
    )

    res.json({ success: true, image: record })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/images-output/:id/upload-drive
router.post('/:id/upload-drive', async (req, res) => {
  try {
    const row = db.prepare(`SELECT * FROM images_output WHERE id = ?`).get(req.params.id) as any
    if (!row) return res.status(404).json({ error: 'Image not found' })

    const driveUrl = await uploadToDrive(row.local_path, row.filename)
    db.prepare(`UPDATE images_output SET drive_url = ? WHERE id = ?`).run(driveUrl, req.params.id)

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

    res.json({ success: true, driveUrl })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/images-output/:id
router.delete('/:id', (req, res) => {
  const row = db.prepare(`SELECT local_path FROM images_output WHERE id = ?`).get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Image not found' })

  if (fs.existsSync(row.local_path)) fs.unlinkSync(row.local_path)
  db.prepare(`DELETE FROM images_output WHERE id = ?`).run(req.params.id)

  res.json({ success: true })
})

export default router
