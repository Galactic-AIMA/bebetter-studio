import { Router } from 'express'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import db from '../db'
import path from 'path'
import { generateCarouselScript, generateCarouselCaption, SlideRole, CarouselFuente } from '../services/geminiService'
import { generateSlideImage, carouselDir, slideFilename } from '../services/carouselService'
import { uploadCarouselSlideToS3 } from '../services/s3Service'
import { publishCarousel, normalizeAltText } from '../services/instagramService'
import {
  appendCarouselQueueRows,
  readCarouselQueueRows,
  readCarouselCadence,
  writeCarouselCadence,
  CarouselQueueRow,
} from '../services/sheetsService'
import { nextCarouselSlots } from '../utils/schedule'
import { logInfo, logError } from '../services/logService'

const router = Router()

interface StoredSlide {
  n: number
  rol: SlideRole
  texto: string
  simbolo?: string // escena visual concreta de la slide (varía entre slides)
  publicUrl?: string // presente cuando la slide ya se generó
}

function rowToCarousel(row: any) {
  return {
    id: row.id,
    tema: row.tema,
    tipo: row.tipo,
    aspect: row.aspect,
    fuente: (row.fuente_json ? JSON.parse(row.fuente_json) : undefined) as CarouselFuente | undefined,
    slides: JSON.parse(row.slides_json || '[]') as StoredSlide[],
    status: row.status,
    createdAt: row.created_at,
  }
}

// Título corto y legible de un carrusel: el texto de la PORTADA (el titular).
// El campo `tema` suele ser el material fuente entero (un capítulo, el resumen de
// un video…), que no sirve como identificador en la cola ni en el aviso de
// Telegram. Cae al `tema` recortado si el carrusel ya no está en la DB.
function tituloCorto(slides: StoredSlide[], fallback: string): string {
  const portada = slides.find((s) => s.rol === 'portada') ?? slides[0]
  const t = (portada?.texto ?? '').trim()
  return (t || fallback).slice(0, 300)
}

function tituloDeCarousel(carouselId: string, fallback: string): string {
  const row = db.prepare(`SELECT slides_json FROM carousels WHERE id = ?`).get(carouselId) as any
  if (!row) return fallback.slice(0, 300)
  try {
    return tituloCorto(JSON.parse(row.slides_json || '[]') as StoredSlide[], fallback)
  } catch {
    return fallback.slice(0, 300)
  }
}

// Normaliza la atribución; devuelve undefined si viene vacía.
function cleanFuente(raw: any): CarouselFuente | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const f: CarouselFuente = {
    autor: String(raw.autor ?? '').trim() || undefined,
    obra: String(raw.obra ?? '').trim() || undefined,
    referencia: String(raw.referencia ?? '').trim() || undefined,
  }
  return f.autor || f.obra || f.referencia ? f : undefined
}

// POST /api/carousels/script — propone el guion editable (NO gasta créditos de KIE).
// Body: { tema: string, tipo?: 'narrativo'|'serie', nSlides?: number }
router.post('/script', async (req, res) => {
  const { tema, tipo, nSlides, fuente, conHistoria } = req.body ?? {}
  if (!tema || typeof tema !== 'string' || tema.trim().length < 3) {
    return res.status(400).json({ error: 'tema requerido (mín. 3 caracteres)' })
  }
  try {
    const slides = await generateCarouselScript(
      tema.trim(),
      tipo === 'serie' ? 'serie' : 'narrativo',
      typeof nSlides === 'number' ? nSlides : 6,
      { fuente: cleanFuente(fuente), conHistoria: conHistoria !== false }
    )
    res.json({ slides })
  } catch (err: any) {
    logError('carousel', 'Error generando guion', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/carousels — crea el registro (draft) con el guion aprobado/editado.
// Aún NO genera imágenes. Body: { tema, tipo?, aspect?, slides: [{n,rol,texto}] }
router.post('/', (req, res) => {
  const { tema, tipo, aspect, slides, fuente } = req.body ?? {}
  if (!tema || !Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: 'tema y slides requeridos' })
  }
  const clean: StoredSlide[] = slides
    .map((s: any, i: number) => ({
      n: typeof s.n === 'number' ? s.n : i + 1,
      rol: (['portada', 'desarrollo', 'historia', 'cta'].includes(s.rol) ? s.rol : 'desarrollo') as SlideRole,
      texto: String(s.texto ?? '').trim(),
      simbolo: String(s.simbolo ?? '').trim(),
    }))
    .filter((s: StoredSlide) => s.texto)
    .sort((a: StoredSlide, b: StoredSlide) => a.n - b.n)

  if (!clean.length) return res.status(400).json({ error: 'Ninguna slide con texto' })

  const id = uuidv4()
  const f = cleanFuente(fuente)
  db.prepare(`
    INSERT INTO carousels (id, tema, tipo, aspect, slides_json, fuente_json, status, created_at)
    VALUES (@id, @tema, @tipo, @aspect, @slides_json, @fuente_json, 'draft', @created_at)
  `).run({
    id,
    tema: String(tema).trim(),
    tipo: tipo === 'serie' ? 'serie' : 'narrativo',
    aspect: aspect === '1:1' ? '1:1' : '4:5',
    slides_json: JSON.stringify(clean),
    fuente_json: f ? JSON.stringify(f) : null,
    created_at: new Date().toISOString(),
  })

  logInfo('carousel', `Carrusel creado: "${tema}" (${clean.length} slides)`)
  res.json(rowToCarousel(db.prepare(`SELECT * FROM carousels WHERE id = ?`).get(id)))
})

// POST /api/carousels/:id/slides/:n — genera (o regenera) la slide n con KIE.
// La portada (n=1) se genera sin referencia; las demás usan la portada como
// image_input para mantener coherencia → hay que generar la portada primero.
router.post('/:id/slides/:n', async (req, res) => {
  const row = db.prepare(`SELECT * FROM carousels WHERE id = ?`).get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Carrusel no encontrado' })

  const carousel = rowToCarousel(row)
  const n = parseInt(req.params.n, 10)
  const slide = carousel.slides.find((s) => s.n === n)
  if (!slide) return res.status(404).json({ error: `Slide ${n} no existe` })

  const isCover = n === carousel.slides[0].n
  if (!isCover && !row.cover_kie_url) {
    return res.status(409).json({ error: 'Genera la portada (slide 1) primero, se usa como referencia' })
  }

  try {
    const generated = await generateSlideImage(
      carousel.id,
      { n: slide.n, rol: slide.rol, texto: slide.texto, simbolo: slide.simbolo },
      isCover ? undefined : row.cover_kie_url,
      carousel.fuente
    )

    // Actualiza la slide con su URL local + marca de tiempo para cache-busting
    const updated = carousel.slides.map((s) =>
      s.n === n ? { ...s, publicUrl: `${generated.publicUrl}?t=${Date.now()}` } : s
    )
    const allDone = updated.every((s) => s.publicUrl)
    db.prepare(`
      UPDATE carousels
      SET slides_json = @slides, status = @status
          ${isCover ? ', cover_kie_url = @cover' : ''}
      WHERE id = @id
    `).run({
      id: carousel.id,
      slides: JSON.stringify(updated),
      status: allDone ? 'done' : 'partial',
      ...(isCover ? { cover: generated.kieUrl } : {}),
    })

    logInfo('carousel', `Slide ${n} generada (${carousel.tema})`)
    res.json({ n, url: updated.find((s) => s.n === n)!.publicUrl })
  } catch (err: any) {
    logError('carousel', `Error generando slide ${n}`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/carousels/:id/queue — sube las slides a R2, genera el caption y
// escribe una fila `approved` en la cola de carruseles (pestaña propia del Sheet).
// El scheduler de n8n la drena en la cadencia de carruseles (más larga que la de
// videos) y publica el carrusel nativo en Instagram.
// SIN gate de Telegram por ahora: los carruseles se generan y revisan a mano en
// la app, así que encolar == aprobar. El gate se añadirá cuando haya generación
// por lotes. Idempotente en R2: re-subir sobrescribe la misma key.
// Validación + preparación compartida por los dos carriles (cola y publicar ya):
// comprueba que el carrusel esté completo, sube las slides a R2 EN ORDEN y genera
// el caption. Lanza un error con `status` si algo no cuadra.
class PrepError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function prepararParaPublicar(carousel: ReturnType<typeof rowToCarousel>) {
  const pendientes = carousel.slides.filter((s) => !s.publicUrl)
  if (pendientes.length) {
    throw new PrepError(
      `Faltan ${pendientes.length} slide(s) por generar (#${pendientes.map((s) => s.n).join(', #')})`,
      409
    )
  }
  if (carousel.slides.length < 2) {
    throw new PrepError('Un carrusel de Instagram necesita al menos 2 slides', 400)
  }
  if (carousel.slides.length > 10) {
    throw new PrepError(`Instagram admite máximo 10 slides (este tiene ${carousel.slides.length})`, 400)
  }

  const ordered = [...carousel.slides].sort((a, b) => a.n - b.n)
  const imageUrls: string[] = []
  for (const s of ordered) {
    const local = path.join(carouselDir(carousel.id), slideFilename(s.n))
    if (!fs.existsSync(local)) {
      throw new PrepError(`Falta el archivo de la slide #${s.n} en disco`, 409)
    }
    imageUrls.push(await uploadCarouselSlideToS3(local, carousel.id, slideFilename(s.n)))
  }

  const caption = await generateCarouselCaption(carousel.tema, ordered, carousel.fuente)

  // Alt text por slide: el propio texto de la slide. Estas imágenes son texto
  // incrustado, así que sin alt un lector de pantalla no lee NADA; además cuenta
  // como señal de búsqueda desde que Google indexa cuentas profesionales de IG.
  const altTexts = ordered.map((s) => normalizeAltText(s.texto))

  return { ordered, imageUrls, caption, altTexts }
}

router.post('/:id/queue', async (req, res) => {
  const row = db.prepare(`SELECT * FROM carousels WHERE id = ?`).get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Carrusel no encontrado' })
  const carousel = rowToCarousel(row)

  try {
    const { imageUrls, caption, altTexts } = await prepararParaPublicar(carousel)

    // Fila `approved` en la cola: el scheduler la publicará en su franja.
    const queueRow: CarouselQueueRow = {
      id: uuidv4(),
      carouselId: carousel.id,
      tema: tituloCorto(carousel.slides, carousel.tema),
      referencia: carousel.fuente?.referencia,
      imageUrls: JSON.stringify(imageUrls),
      altTexts: JSON.stringify(altTexts.map((a) => a ?? '')),
      captionIG: caption,
      status: 'approved',
      createdAt: new Date().toISOString(),
      attempts: 0,
    }
    await appendCarouselQueueRows([queueRow])

    db.prepare(`UPDATE carousels SET status = 'queued' WHERE id = ?`).run(carousel.id)
    logInfo('carousel', `Carrusel encolado: ${carousel.fuente?.referencia || carousel.tema.slice(0, 40)}`)
    res.json({ success: true, queueId: queueRow.id, imageUrls, caption })
  } catch (err: any) {
    logError('carousel', 'Error encolando carrusel', err.message)
    res.status(err instanceof PrepError ? err.status : 500).json({ error: err.message })
  }
})

// POST /api/carousels/:id/publish — carril EXPRESS: publica el carrusel en
// Instagram AHORA desde la app (no espera a la cadencia). Deja igualmente la
// fila en el Sheet como `published`, para que la cola siga siendo el registro
// de lo que salió publicado.
router.post('/:id/publish', async (req, res) => {
  const row = db.prepare(`SELECT * FROM carousels WHERE id = ?`).get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Carrusel no encontrado' })
  const carousel = rowToCarousel(row)

  try {
    const { imageUrls, caption, altTexts } = await prepararParaPublicar(carousel)

    const mediaId = await publishCarousel(imageUrls, caption, altTexts)
    const publishedAt = new Date().toISOString()

    // Registro en la cola (ya publicado): el Sheet mantiene el histórico.
    await appendCarouselQueueRows([
      {
        id: uuidv4(),
        carouselId: carousel.id,
        tema: tituloCorto(carousel.slides, carousel.tema),
        referencia: carousel.fuente?.referencia,
        imageUrls: JSON.stringify(imageUrls),
        altTexts: JSON.stringify(altTexts.map((a) => a ?? '')),
        captionIG: caption,
        status: 'published',
        createdAt: publishedAt,
        publishedAt,
        attempts: 1,
      },
    ])

    db.prepare(`UPDATE carousels SET status = 'published' WHERE id = ?`).run(carousel.id)
    logInfo('carousel', `Carrusel publicado en IG: ${carousel.fuente?.referencia || carousel.tema.slice(0, 40)}`)
    res.json({ success: true, mediaId, caption })
  } catch (err: any) {
    logError('carousel', 'Error publicando carrusel en Instagram', err.message)
    res.status(err instanceof PrepError ? err.status : 500).json({ error: err.message })
  }
})

// GET /api/carousels/queue/upcoming — proyección de la cola de carruseles:
// empareja los `approved` (más antiguo primero) con las próximas franjas de la
// cadencia de carruseles. Mismo principio que GET /api/cadence/schedule pero con
// cadencia semanal (días + horas) en vez de diaria.
router.get('/queue/upcoming', async (_req, res) => {
  try {
    const [rows, cadence] = await Promise.all([readCarouselQueueRows(), readCarouselCadence()])
    const pendientes = rows
      .filter((r) => r.status === 'approved' && !r.publishedAt)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))

    const slots = nextCarouselSlots(cadence, pendientes.length)
    res.json({
      days: cadence.days,
      times: cadence.times,
      timezone: cadence.timezone,
      count: pendientes.length,
      items: pendientes.map((r, i) => ({
        id: r.id,
        carouselId: r.carouselId,
        tema: tituloDeCarousel(r.carouselId, r.tema),
        referencia: r.referencia,
        firstImage: (() => {
          try {
            return JSON.parse(r.imageUrls)[0]
          } catch {
            return undefined
          }
        })(),
        createdAt: r.createdAt,
        etaIso: slots[i]?.toISOString(),
      })),
    })
  } catch (err: any) {
    logError('carousel', 'Error proyectando la cola de carruseles', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/carousels/cadence — persiste la cadencia semanal de carruseles.
// Body: { days: number[] (ISO 1=lunes…7=domingo), times: string[] ('HH:00') }
// Misma filosofía que la cadencia de videos (horas en punto, franja diurna),
// pero con días de la semana: los carruseles salen 2-3 veces por semana.
const CAROUSEL_MIN_HOUR = 6
const CAROUSEL_MAX_HOUR = 22
const CAROUSEL_MAX_TIMES = 3

router.post('/cadence', async (req, res) => {
  try {
    const rawDays = Array.isArray(req.body?.days) ? req.body.days : []
    const days: number[] = [...new Set<number>(rawDays.map((d: any) => Number(d)))]
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      .sort((a, b) => a - b)
    if (!days.length) throw new Error('Elige al menos un día de la semana')

    const rawTimes = Array.isArray(req.body?.times) ? req.body.times : []
    if (!rawTimes.length) throw new Error('Envía al menos una hora')
    if (rawTimes.length > CAROUSEL_MAX_TIMES) {
      throw new Error(`Máximo ${CAROUSEL_MAX_TIMES} publicaciones por día`)
    }
    const hours = new Set<number>()
    for (const raw of rawTimes) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw).trim())
      if (!m) throw new Error(`Hora inválida: "${raw}" (usa formato HH:MM)`)
      if (Number(m[2]) !== 0) throw new Error(`Solo horas en punto: "${raw}"`)
      const h = Number(m[1])
      if (h < CAROUSEL_MIN_HOUR || h > CAROUSEL_MAX_HOUR) {
        throw new Error(`"${raw}" fuera de la franja diurna (${CAROUSEL_MIN_HOUR}:00–${CAROUSEL_MAX_HOUR}:00)`)
      }
      hours.add(h)
    }
    const times = [...hours].sort((a, b) => a - b).map((h) => String(h).padStart(2, '0') + ':00')

    await writeCarouselCadence(days, times)
    logInfo('carousel', `Cadencia de carruseles actualizada: días ${days.join(',')} · ${times.join(', ')}`)
    res.json({ success: true, days, times })
  } catch (err: any) {
    // Errores de validación → 400; fallos del Sheet → 500
    const isValidation = !/sheet|google|token|network/i.test(err.message)
    if (!isValidation) logError('carousel', 'Guardar cadencia de carruseles falló', err.message)
    res.status(isValidation ? 400 : 500).json({ error: err.message })
  }
})

// GET /api/carousels — lista (más recientes primero)
router.get('/', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM carousels ORDER BY created_at DESC`).all() as any[]
  res.json(rows.map(rowToCarousel))
})

// GET /api/carousels/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM carousels WHERE id = ?`).get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Carrusel no encontrado' })
  res.json(rowToCarousel(row))
})

// DELETE /api/carousels/:id — borra la fila y las imágenes en disco
router.delete('/:id', (req, res) => {
  const row = db.prepare(`SELECT id FROM carousels WHERE id = ?`).get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Carrusel no encontrado' })

  const dir = carouselDir(req.params.id)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  db.prepare(`DELETE FROM carousels WHERE id = ?`).run(req.params.id)

  res.json({ success: true })
})

export default router
