import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import { generateImage } from '../services/imageGenerator'
import { enqueue } from '../services/queueService'
import { uploadToDrive } from '../services/driveService'
import { ImageConfig, ImageRecord, ImageVariant, Phrase } from '../types'
import { config } from '../config'
import { GenerateImageSchema } from '../schemas'

const router = Router()

const DB_PATH = path.join(__dirname, '../../../data/images-output.json')
const PHRASES_PATH = path.join(__dirname, '../../../data/phrases.json')
const IMAGES_USAGE_PATH = path.join(__dirname, '../../../data/images-usage.json')

function loadRecords(): ImageRecord[] {
  if (!fs.existsSync(DB_PATH)) return []
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))
}

function saveRecords(records: ImageRecord[]) {
  fs.writeFileSync(DB_PATH, JSON.stringify(records, null, 2))
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

interface GenerateImageRequest {
  config: ImageConfig
  phraseId?: string
  variant?: ImageVariant
}

// GET /api/images-output — listar imágenes generadas
router.get('/', (_req, res) => {
  res.json(loadRecords())
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

    const record: ImageRecord = {
      id: uuidv4(),
      filename: result.filename,
      localPath: result.localPath,
      publicUrl: result.publicUrl,
      variant: result.variant,
      phraseId: phraseId ?? undefined,
      createdAt: new Date().toISOString(),
      config: imgConfig,
    }

    const records = loadRecords()
    records.unshift(record)
    saveRecords(records)

    res.json({ success: true, image: record })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/images-output/:id/upload-drive
router.post('/:id/upload-drive', async (req, res) => {
  try {
    const records = loadRecords()
    const record = records.find((r) => r.id === req.params.id)
    if (!record) return res.status(404).json({ error: 'Image not found' })

    const driveUrl = await uploadToDrive(record.localPath, record.filename)
    record.driveUrl = driveUrl
    saveRecords(records)

    if (record.phraseId) incrementPhraseUsage(record.phraseId)
    if (record.config.imageId) incrementImageUsage(record.config.imageId)

    res.json({ success: true, driveUrl })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/images-output/:id
router.delete('/:id', (req, res) => {
  const records = loadRecords()
  const idx = records.findIndex((r) => r.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Image not found' })

  const [record] = records.splice(idx, 1)
  if (fs.existsSync(record.localPath)) fs.unlinkSync(record.localPath)
  saveRecords(records)

  res.json({ success: true })
})

export default router
