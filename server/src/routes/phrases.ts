import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import {
  analyzePhraseStructured,
  classifyPersona,
  buildPhraseDocument,
  embedText,
  ImageAnalysis,
} from '../services/geminiService'
import { cosine, rerankScore } from '../utils/matching'
import db from '../db'
import { EN_NORMA_SQL } from '../utils/norma'

const router = Router()

// GET /api/phrases   —  ?includeArchived=1 para ver también las retiradas
router.get('/', async (req, res) => {
  const incluirArchivadas = req.query.includeArchived === '1'
  const rows = (await db.prepare(
    `SELECT * FROM phrases ${incluirArchivadas ? '' : 'WHERE archived = 0'}
     ORDER BY sort_order ASC, created_at DESC`
  ).all()) as any[]
  const phrases = rows.map((p) => ({
    id: p.id,
    text: p.text,
    category: p.category ?? undefined,
    author: p.author ?? undefined,
    usageCount: p.usage_count,
    moodKeywords: p.mood_keywords ? JSON.parse(p.mood_keywords) : undefined,
    analyzedAt: p.analyzed_at ?? undefined,
    createdAt: p.created_at ?? undefined,
    archived: p.archived === 1 || undefined,
    // Las dos columnas de norma viajan al cliente para que el banco pueda
    // distinguir de un vistazo qué frase entra en la rotación y cuál no. NO se
    // ocultan aquí: hay 57 fuera de norma y esconderlas sin darle a David una
    // forma de verlas convertiria la reconversión por tandas en un trabajo a ciegas.
    estructura: p.estructura ?? undefined,
    persona: p.persona ?? undefined,
  }))
  res.json(phrases)
})

// GET /api/phrases/random
router.get('/random', async (_req, res) => {
  // Solo frases EN NORMA (ver `utils/norma.ts`): las de un golpe o en segunda
  // persona no se publican, así que tampoco se proponen.
  // Preferir frases ya vectorizadas para que el matching de imágenes funcione
  const analyzed = (await db.prepare(
    `SELECT * FROM phrases WHERE embedding IS NOT NULL AND archived = 0 AND ${EN_NORMA_SQL} ORDER BY RANDOM() LIMIT 1`
  ).get()) as any
  const row = analyzed ?? (await db.prepare(`SELECT * FROM phrases WHERE archived = 0 AND ${EN_NORMA_SQL} ORDER BY RANDOM() LIMIT 1`).get()) as any

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
router.post('/', async (req, res) => {
  const { text, category, author } = req.body
  if (!text) return res.status(400).json({ error: 'text is required' })

  const id = uuidv4()
  // Nuevas frases aparecen primero (sort_order menor que el mínimo actual)
  const minRow = (await db.prepare(`SELECT MIN(sort_order) as m FROM phrases`).get()) as any
  const sortOrder = (minRow?.m ?? 0) - 1

  await db.prepare(
    `INSERT INTO phrases (id, text, category, author, sort_order) VALUES (@id, @text, @category, @author, @sort_order)`
  ).run({ id, text, category: category ?? null, author: author ?? null, sort_order: sortOrder })

  res.status(201).json({ id, text, category, author, usageCount: 0 })
})

// POST /api/phrases/bulk — importar múltiples frases a la vez
router.post('/bulk', async (req, res) => {
  const { phrases: input } = req.body as { phrases: { text: string; author?: string }[] }
  if (!Array.isArray(input) || !input.length)
    return res.status(400).json({ error: 'phrases array is required' })

  const newPhrases = input
    .filter(({ text }) => text?.trim().length > 0)
    .map(({ text, author }) => ({ id: uuidv4(), text: text.trim(), author: author ?? null }))

  if (!newPhrases.length) return res.status(400).json({ error: 'No valid phrases' })

  const minRow = (await db.prepare(`SELECT MIN(sort_order) as m FROM phrases`).get()) as any
  const baseOrder = (minRow?.m ?? 0) - newPhrases.length

  const insert = db.prepare(
    `INSERT INTO phrases (id, text, author, sort_order) VALUES (@id, @text, @author, @sort_order)`
  )

  await db.transaction(async () => {
    // `for` y no `forEach`: con `await` dentro, `forEach` lanzaría todas a la vez y
    // el COMMIT llegaría antes de que ninguna hubiera terminado.
    for (const [idx, p] of newPhrases.entries()) {
      await insert.run({ ...p, sort_order: baseOrder + idx })
    }
  })

  res.status(201).json(newPhrases.map((p) => ({ ...p, usageCount: 0 })))
})

// PUT /api/phrases/reorder — reordena todas las frases según el array de IDs recibido
router.put('/reorder', async (req, res) => {
  const { ids } = req.body as { ids: string[] }
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array is required' })

  const updateOrder = db.prepare(`UPDATE phrases SET sort_order = @order WHERE id = @id`)
  await db.transaction(async () => {
    for (const [idx, id] of ids.entries()) await updateOrder.run({ order: idx, id })
  })

  res.json({ ok: true })
})

// PUT /api/phrases/:id
router.put('/:id', async (req, res) => {
  const { text, category, author } = req.body
  const result = (await db.prepare(
    `UPDATE phrases SET text = @text, category = @category, author = @author WHERE id = @id`
  ).run({ text, category: category ?? null, author: author ?? null, id: req.params.id }))

  if (result.changes === 0) return res.status(404).json({ error: 'Phrase not found' })

  const updated = (await db.prepare(`SELECT * FROM phrases WHERE id = ?`).get(req.params.id)) as any
  res.json({
    id: updated.id,
    text: updated.text,
    category: updated.category ?? undefined,
    author: updated.author ?? undefined,
    usageCount: updated.usage_count,
  })
})

// DELETE /api/phrases/:id
router.delete('/:id', async (req, res) => {
  const result = (await db.prepare(`DELETE FROM phrases WHERE id = ?`).run(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Phrase not found' })
  res.json({ success: true })
})

// POST /api/phrases/recommend — top frases compatibles con una imagen (por embedding)
router.post('/recommend', async (req, res) => {
  const { imageFilename, topN } = req.body
  if (!imageFilename) return res.status(400).json({ error: 'imageFilename required' })
  const limit = Math.min(topN ?? 20, 200)

  const imgRow = (await db.prepare(
    `SELECT embedding, analysis_json FROM images WHERE filename = ?`
  ).get(imageFilename)) as any
  if (!imgRow?.embedding) return res.json({ recommendations: [] })

  const imgEmbedding = new Float32Array((imgRow.embedding as Buffer).buffer)
  let imgAnalysis: ImageAnalysis | null = null
  try { imgAnalysis = imgRow.analysis_json ? JSON.parse(imgRow.analysis_json) : null } catch (_) { /* ignore */ }

  const phrases = (await db.prepare(
    `SELECT id, embedding, nivel_energia, paleta FROM phrases WHERE embedding IS NOT NULL AND archived = 0 AND ${EN_NORMA_SQL}`
  ).all()) as any[]

  const scores = phrases
    .map((p) => {
      const cos = cosine(imgEmbedding, new Float32Array((p.embedding as Buffer).buffer))
      const score = rerankScore(cos, {
        energiaA: imgAnalysis?.nivelEnergia,
        energiaB: p.nivel_energia ?? null,
        paletaA: imgAnalysis?.paletaColores,
        paletaB: p.paleta ? JSON.parse(p.paleta) : null,
      })
      return { phraseId: p.id, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  res.json({ recommendations: scores })
})

// POST /api/phrases/embed-texto — rellena SOLO `embedding_texto` (2026-08-18).
// Body opcional: { force: true } re-vectoriza todas.
//
// Existe aparte de `embed-all` porque es una operación mucho más barata: no llama
// a `analyzePhraseStructured` ni reclasifica la persona, solo vectoriza el texto.
// Meterlo en `embed-all` habría obligado a re-analizar las 118 frases —y a pisar
// mood, energía y paleta— para conseguir un vector que no depende del análisis.
router.post('/embed-texto', async (req, res) => {
  const force: boolean = req.body?.force === true
  const rows = (await db.prepare(
    `SELECT id, text FROM phrases${force ? '' : ' WHERE embedding_texto IS NULL'}`
  ).all()) as { id: string; text: string }[]

  const update = db.prepare(`UPDATE phrases SET embedding_texto = ? WHERE id = ?`)
  let processed = 0
  const errors: string[] = []
  for (const p of rows) {
    try {
      const v = await embedText(p.text, 'SEMANTIC_SIMILARITY')
      await update.run(Buffer.from(v.buffer, v.byteOffset, v.byteLength), p.id)
      processed++
    } catch (e: any) {
      errors.push(`${p.id}: ${e.message}`)
    }
  }
  res.json({ total: rows.length, processed, errors })
})

// POST /api/phrases/embed-all — genera análisis conceptual + embedding de frases
// Body opcional: { force: true } re-vectoriza TODAS (necesario tras cambiar el
// documento de embedding); { only: string[] } restringe a ids concretos (subset).
router.post('/embed-all', async (req, res) => {
  const force: boolean = req.body?.force === true
  const only: string[] | undefined = Array.isArray(req.body?.only) ? req.body.only : undefined

  let query = `SELECT id, text FROM phrases`
  if (only) {
    const placeholders = only.map(() => '?').join(',')
    query += ` WHERE id IN (${placeholders})`
  } else if (!force) {
    // `embedding_texto` va en la lista a propósito (2026-08-19). Es el vector del
    // TEXTO CRUDO, y es el único que compara el emparejador de audio contra la frase
    // de origen de un corte. Una frase que consiguió su `embedding` antes de que esa
    // columna existiera se quedaba fuera del emparejamiento PARA SIEMPRE: entraba al
    // pool, salía elegida y se publicaba sin música, sin que nada lo dijera. Apareció
    // una así, del 2026-05-17.
    query += ` WHERE embedding IS NULL OR descripcion_mood IS NULL OR embedding_texto IS NULL`
  }
  const phrases = (only ? (await db.prepare(query).all(...only)) : (await db.prepare(query).all())) as any[]

  const update = db.prepare(`
    UPDATE phrases SET descripcion_mood = @descripcion_mood, nivel_energia = @nivel_energia,
      paleta = @paleta, mood_category = @mood_category, embedding = @embedding,
      embedding_texto = @embedding_texto WHERE id = @id
  `)
  const updPersona = db.prepare(`UPDATE phrases SET persona = ? WHERE id = ? AND persona IS NULL`)

  let processed = 0
  const errors: string[] = []

  for (const phrase of phrases) {
    try {
      const analysis = await analyzePhraseStructured(phrase.text)
      const embedding = await embedText(buildPhraseDocument(analysis))
      // Segundo vector, del TEXTO CRUDO. No es un duplicado del anterior: aquel
      // vectoriza las `metaforasVisuales` para buscar imagen de fondo, y este la
      // frase tal cual, que es lo único comparable con la frase de origen de un
      // corte de audio (`audio_tracks.source_phrase`). Usar el primero para el
      // audio repetiría el error que jubiló a la energía: comparar por un eje
      // medido para otra cosa.
      const embeddingTexto = await embedText(phrase.text, 'SEMANTIC_SIMILARITY')

      // La persona gramatical se marca aquí porque vectorizar es el paso por el
      // que pasa TODA frase antes de poder ser elegida: si no se hiciera, una
      // frase nueva entraría con `persona = NULL` y quedaría fuera del pool sin
      // que nadie se enterara. Solo se escribe si está vacía, para no pisar lo
      // que se decidió a mano en `scripts/persona-manual.json`.
      try {
        const [p] = await classifyPersona([phrase.text])
        await updPersona.run(p.persona, phrase.id)
      } catch (e: any) {
        errors.push(`${phrase.id}: persona no clasificada (${e.message})`)
      }
      await update.run({
        id: phrase.id,
        descripcion_mood: analysis.mood,
        nivel_energia: analysis.nivelEnergia,
        paleta: JSON.stringify(analysis.paletaIdeal),
        mood_category: analysis.moodCategory,
        embedding: Buffer.from(embedding.buffer),
        embedding_texto: Buffer.from(embeddingTexto.buffer, embeddingTexto.byteOffset, embeddingTexto.byteLength),
      })
      processed++
      await new Promise((r) => setTimeout(r, 100))
    } catch (err: any) {
      errors.push(`${phrase.id}: ${err.message}`)
    }
  }

  // La `estructura` NO se clasifica aquí: es semántica y Gemini falló en el 15%
  // de 139 al intentarlo (por eso existe la clasificación a mano). Se marca
  // aparte, y mientras tanto la frase se queda fuera del pool. Se informa para
  // que el agujero sea visible en vez de silencioso.
  const sinEstructura = ((await db.prepare(
    `SELECT COUNT(*) n FROM phrases WHERE archived = 0 AND estructura IS NULL`
  ).get()) as any).n as number

  res.json({ processed, total: phrases.length, errors, sinEstructura })
})

export default router
