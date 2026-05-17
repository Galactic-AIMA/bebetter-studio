import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { extractMoodKeywords } from '../services/geminiService'
import db from '../db'

const router = Router()

// GET /api/phrases
router.get('/', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM phrases ORDER BY sort_order ASC, created_at DESC`).all() as any[]
  const phrases = rows.map((p) => ({
    id: p.id,
    text: p.text,
    category: p.category ?? undefined,
    author: p.author ?? undefined,
    usageCount: p.usage_count,
    moodKeywords: p.mood_keywords ? JSON.parse(p.mood_keywords) : undefined,
    analyzedAt: p.analyzed_at ?? undefined,
  }))
  res.json(phrases)
})

// POST /api/phrases/analyze-all — extrae mood keywords de todas las frases sin analizar
router.post('/analyze-all', async (_req, res) => {
  const rows = db.prepare(
    `SELECT id, text FROM phrases WHERE mood_keywords IS NULL OR mood_keywords = '[]'`
  ).all() as any[]

  let processed = 0
  let skipped = 0
  const errors: string[] = []

  for (const phrase of rows) {
    try {
      const keywords = await extractMoodKeywords(phrase.text)
      db.prepare(
        `UPDATE phrases SET mood_keywords = @kw, analyzed_at = @at WHERE id = @id`
      ).run({ kw: JSON.stringify(keywords), at: new Date().toISOString(), id: phrase.id })
      processed++
      // 6s entre peticiones para respetar el límite de 10 RPM de gemini-2.5-flash
      await new Promise((r) => setTimeout(r, 6000))
    } catch (err: any) {
      errors.push(`${phrase.id}: ${err.message}`)
    }
  }

  skipped = (db.prepare(`SELECT COUNT(*) as n FROM phrases`).get() as any).n - processed - errors.length

  res.json({ processed, skipped, errors })
})

// GET /api/phrases/random
router.get('/random', (_req, res) => {
  // Preferir frases ya analizadas para que el matching de imágenes funcione
  const analyzed = db.prepare(
    `SELECT * FROM phrases WHERE mood_keywords IS NOT NULL AND mood_keywords != '[]' ORDER BY RANDOM() LIMIT 1`
  ).get() as any
  const row = analyzed ?? db.prepare(`SELECT * FROM phrases ORDER BY RANDOM() LIMIT 1`).get() as any

  if (!row) return res.status(404).json({ error: 'No phrases found' })

  res.json({
    id: row.id,
    text: row.text,
    category: row.category ?? undefined,
    author: row.author ?? undefined,
    usageCount: row.usage_count,
    moodKeywords: row.mood_keywords ? JSON.parse(row.mood_keywords) : undefined,
  })
})

// POST /api/phrases
router.post('/', (req, res) => {
  const { text, category, author } = req.body
  if (!text) return res.status(400).json({ error: 'text is required' })

  const id = uuidv4()
  // Nuevas frases aparecen primero (sort_order menor que el mínimo actual)
  const minRow = db.prepare(`SELECT MIN(sort_order) as m FROM phrases`).get() as any
  const sortOrder = (minRow?.m ?? 0) - 1

  db.prepare(
    `INSERT INTO phrases (id, text, category, author, sort_order) VALUES (@id, @text, @category, @author, @sort_order)`
  ).run({ id, text, category: category ?? null, author: author ?? null, sort_order: sortOrder })

  res.status(201).json({ id, text, category, author, usageCount: 0 })
})

// POST /api/phrases/bulk — importar múltiples frases a la vez
router.post('/bulk', (req, res) => {
  const { phrases: input } = req.body as { phrases: { text: string; author?: string }[] }
  if (!Array.isArray(input) || !input.length)
    return res.status(400).json({ error: 'phrases array is required' })

  const newPhrases = input
    .filter(({ text }) => text?.trim().length > 0)
    .map(({ text, author }) => ({ id: uuidv4(), text: text.trim(), author: author ?? null }))

  if (!newPhrases.length) return res.status(400).json({ error: 'No valid phrases' })

  const minRow = db.prepare(`SELECT MIN(sort_order) as m FROM phrases`).get() as any
  const baseOrder = (minRow?.m ?? 0) - newPhrases.length

  const insert = db.prepare(
    `INSERT INTO phrases (id, text, author, sort_order) VALUES (@id, @text, @author, @sort_order)`
  )

  db.transaction(() => {
    newPhrases.forEach((p, idx) => insert.run({ ...p, sort_order: baseOrder + idx }))
  })()

  res.status(201).json(newPhrases.map((p) => ({ ...p, usageCount: 0 })))
})

// PUT /api/phrases/reorder — reordena todas las frases según el array de IDs recibido
router.put('/reorder', (req, res) => {
  const { ids } = req.body as { ids: string[] }
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array is required' })

  const updateOrder = db.prepare(`UPDATE phrases SET sort_order = @order WHERE id = @id`)
  db.transaction(() => {
    ids.forEach((id, idx) => updateOrder.run({ order: idx, id }))
  })()

  res.json({ ok: true })
})

// PUT /api/phrases/:id
router.put('/:id', (req, res) => {
  const { text, category, author } = req.body
  const result = db.prepare(
    `UPDATE phrases SET text = @text, category = @category, author = @author WHERE id = @id`
  ).run({ text, category: category ?? null, author: author ?? null, id: req.params.id })

  if (result.changes === 0) return res.status(404).json({ error: 'Phrase not found' })

  const updated = db.prepare(`SELECT * FROM phrases WHERE id = ?`).get(req.params.id) as any
  res.json({
    id: updated.id,
    text: updated.text,
    category: updated.category ?? undefined,
    author: updated.author ?? undefined,
    usageCount: updated.usage_count,
  })
})

// DELETE /api/phrases/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare(`DELETE FROM phrases WHERE id = ?`).run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'Phrase not found' })
  res.json({ success: true })
})

export default router
