import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { Phrase } from '../types'
import { config } from '../config'
import { extractMoodKeywords } from '../services/geminiService'

const router = Router()

const PHRASES_META_PATH = path.join(__dirname, '../../../data/phrases-metadata.json')

interface PhraseMeta { keywords: string[]; analyzedAt: string }

function loadPhrasesMetadata(): Record<string, PhraseMeta> {
  if (!fs.existsSync(PHRASES_META_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(PHRASES_META_PATH, 'utf-8')) } catch { return {} }
}

function savePhrasesMetadata(data: Record<string, PhraseMeta>) {
  fs.writeFileSync(PHRASES_META_PATH, JSON.stringify(data, null, 2))
}

function loadPhrases(): Phrase[] {
  if (!fs.existsSync(config.paths.phrases)) return []
  return JSON.parse(fs.readFileSync(config.paths.phrases, 'utf-8'))
}

function savePhrases(phrases: Phrase[]) {
  fs.writeFileSync(config.paths.phrases, JSON.stringify(phrases, null, 2))
}

// GET /api/phrases
router.get('/', (_req, res) => {
  const phrases = loadPhrases()
  const metadata = loadPhrasesMetadata()
  const enriched = phrases.map((p) => ({
    ...p,
    moodKeywords: metadata[p.id]?.keywords,
  }))
  res.json(enriched)
})

// POST /api/phrases/analyze-all — extrae mood keywords de todas las frases sin analizar
router.post('/analyze-all', async (_req, res) => {
  const phrases = loadPhrases()
  const metadata = loadPhrasesMetadata()
  let processed = 0
  let skipped = 0
  const errors: string[] = []

  for (const phrase of phrases) {
    if (metadata[phrase.id]?.keywords?.length > 0) { skipped++; continue }
    try {
      const keywords = await extractMoodKeywords(phrase.text)
      metadata[phrase.id] = { keywords, analyzedAt: new Date().toISOString() }
      savePhrasesMetadata(metadata)
      processed++
      // 6s entre peticiones para respetar el límite de 10 RPM de gemini-2.5-flash
      await new Promise((r) => setTimeout(r, 6000))
    } catch (err: any) {
      errors.push(`${phrase.id}: ${err.message}`)
    }
  }

  res.json({ processed, skipped, errors })
})

// GET /api/phrases/random
router.get('/random', (_req, res) => {
  const phrases = loadPhrases()
  if (!phrases.length) return res.status(404).json({ error: 'No phrases found' })
  const metadata = loadPhrasesMetadata()
  // Preferir frases ya analizadas para que el matching de imágenes funcione
  const analyzed = phrases.filter((p) => (metadata[p.id]?.keywords?.length ?? 0) > 0)
  const pool = analyzed.length > 0 ? analyzed : phrases
  const phrase = pool[Math.floor(Math.random() * pool.length)]
  res.json({ ...phrase, moodKeywords: metadata[phrase.id]?.keywords })
})

// POST /api/phrases
router.post('/', (req, res) => {
  const { text, category, author } = req.body
  if (!text) return res.status(400).json({ error: 'text is required' })

  const phrases = loadPhrases()
  const newPhrase: Phrase = { id: uuidv4(), text, category, author }
  phrases.unshift(newPhrase)
  savePhrases(phrases)

  res.status(201).json(newPhrase)
})

// POST /api/phrases/bulk — importar múltiples frases a la vez
router.post('/bulk', (req, res) => {
  const { phrases: input } = req.body as { phrases: { text: string; author?: string }[] }
  if (!Array.isArray(input) || !input.length)
    return res.status(400).json({ error: 'phrases array is required' })

  const phrases = loadPhrases()
  const newPhrases: Phrase[] = input
    .filter(({ text }) => text?.trim().length > 0)
    .map(({ text, author }) => ({ id: uuidv4(), text: text.trim(), ...(author ? { author } : {}) }))

  phrases.unshift(...newPhrases)
  savePhrases(phrases)

  res.status(201).json(newPhrases)
})

// PUT /api/phrases/reorder — reordena todas las frases según el array de IDs recibido
router.put('/reorder', (req, res) => {
  const { ids } = req.body as { ids: string[] }
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array is required' })

  const phrases = loadPhrases()
  const map = new Map(phrases.map((p) => [p.id, p]))
  const reordered = ids.map((id) => map.get(id)).filter(Boolean) as Phrase[]
  // Añadir al final las que no vengan en ids (por si acaso)
  const reorderedIds = new Set(ids)
  phrases.filter((p) => !reorderedIds.has(p.id)).forEach((p) => reordered.push(p))

  savePhrases(reordered)
  res.json({ ok: true })
})

// PUT /api/phrases/:id
router.put('/:id', (req, res) => {
  const phrases = loadPhrases()
  const idx = phrases.findIndex((p) => p.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Phrase not found' })

  phrases[idx] = { ...phrases[idx], ...req.body, id: req.params.id }
  savePhrases(phrases)

  res.json(phrases[idx])
})

// DELETE /api/phrases/:id
router.delete('/:id', (req, res) => {
  const phrases = loadPhrases()
  const filtered = phrases.filter((p) => p.id !== req.params.id)
  if (filtered.length === phrases.length)
    return res.status(404).json({ error: 'Phrase not found' })

  savePhrases(filtered)
  res.json({ success: true })
})

export default router
