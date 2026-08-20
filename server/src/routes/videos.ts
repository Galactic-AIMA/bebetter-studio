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
import { generarFondoParaFrase } from '../services/aiImageService'
import { duracionSegunAudio } from '../utils/duracionReel'
import { bumpAudioUsage } from '../services/audioMetadata'
import { GenerateVideoRequest } from '../types'
import { config } from '../config'
import { GenerateVideoSchema } from '../schemas'
import { rowToVideoRecord } from '../utils/recordMappers'
import { logInfo, logError } from '../services/logService'
import db from '../db'
import { reconciliarRechazos } from '../services/queueReconcile'

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
    await db.prepare(`UPDATE videos SET s3_url = ? WHERE id = ?`).run(s3Url, row.id)
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
router.get('/', async (_req, res) => {
  const rows = (await db.prepare(`SELECT * FROM videos ORDER BY created_at DESC`).all()) as any[]
  res.json(rows.map(rowToVideoRecord))
})

// Suma el contador de uso (frase + imagen + audio) de un video. Se llama al
// PUBLICAR o ENCOLAR, NO al generar: así regenerar/descartar un video no infla
// el conteo y la rotación prioriza lo que realmente decidiste sacar.
async function bumpUsageForVideo(row: any) {
  if (row.phrase_id) {
    await db.prepare(`UPDATE phrases SET usage_count = usage_count + 1 WHERE id = ?`).run(row.phrase_id)
  }
  const cfg = row.config_extra ? JSON.parse(row.config_extra) : {}
  if (cfg.imageId) {
    await db.prepare(
      `INSERT INTO images (filename, usage_count) VALUES (@f, 1)
       -- Cualificado con la tabla: sin eso Postgres lo ve ambiguo frente a
       -- 'excluded.usage_count' y falla con 42702.
       ON CONFLICT(filename) DO UPDATE SET usage_count = images.usage_count + 1`
    ).run({ f: cfg.imageId })
  }
  if (cfg.audioTrack && cfg.audioTrack !== 'auto') await bumpAudioUsage(cfg.audioTrack)
}

// POST /api/videos/generate — generar un video nuevo
router.post('/generate', async (req, res) => {
  const parsed = GenerateVideoSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, details: parsed.error.issues })

  try {
    const { config: vidConfig, phraseId, paraRevision } = parsed.data

    // Auto-pick de audio POR PROCEDENCIA si no se eligió pista (o se eligió "auto").
    if ((!vidConfig.audioTrack || vidConfig.audioTrack === 'auto') && phraseId) {
      const pick = await pickAudioForPhrase(phraseId)
      vidConfig.audioTrack = pick ? pick.filename : undefined
      if (pick) {
        // El AUDIO manda la duración cuando la pista se eligió sola (2026-08-18).
        // Solo en el carril automático: si David tecleó una duración en el editor y
        // eligió pista a mano, esa decisión se respeta — este `if` ya está dentro de
        // la rama "no eligió pista o pidió auto".
        const dur = duracionSegunAudio(pick.duracionSeg, vidConfig.duration)
        if (dur !== vidConfig.duration) {
          logInfo('generate', `Duración ${vidConfig.duration}s → ${dur}s (la del corte: ${pick.duracionSeg}s)`)
          vidConfig.duration = dur
        }
        logInfo('generate', `Audio auto: ${pick.filename} (coseno ${pick.score.toFixed(3)} con «${pick.sourcePhrase}»)`)
      } else {
        // Silencio explícito: desde el 18-ago solo suenan cortes cosechados con su
        // frase de origen, así que un banco sin cosechar deja los reels sin música.
        logInfo('generate', 'Audio auto: sin corte con procedencia para esta frase (¿frase sin embedding_texto o banco sin cosechar?)')
      }
    } else if (vidConfig.audioTrack === 'auto') {
      vidConfig.audioTrack = undefined // "auto" sin phraseId → sin audio
    }
    // El conteo de uso NO ocurre al generar (ver bumpUsageForVideo: solo al
    // publicar/encolar).

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
    await db.prepare(`
      INSERT INTO videos
        (id, filename, title, description, tags, local_path, public_url,
         phrase_id, viral, font, effect, resolution, config_extra, created_at, estado)
      VALUES
        (@id, @filename, @title, @description, @tags, @local_path, @public_url,
         @phrase_id, 0, @font, @effect, @resolution, @config_extra, @created_at, @estado)
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
      // Una pieza de lote entra a la cola de revisión; una del editor no tiene
      // estado, igual que siempre: se decide en el momento.
      estado:       paraRevision ? 'pendiente_revision' : null,
    })

    const record = rowToVideoRecord(
      (await db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id)) as any
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
    const row = (await db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id)) as any
    if (!row) return res.status(404).json({ error: 'Video not found' })

    const s3Url = await uploadVideoToS3(row.local_path, row.filename)
    await db.prepare(`UPDATE videos SET s3_url = ? WHERE id = ?`).run(s3Url, req.params.id)

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
    const row = (await db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id)) as any
    if (!row) return res.status(404).json({ error: 'Video not found' })

    const driveUrl = await uploadToDrive(row.local_path, row.filename)
    await db.prepare(`UPDATE videos SET drive_url = ? WHERE id = ?`).run(driveUrl, req.params.id)

    // El conteo de uso NO ocurre al subir a Drive (Drive es respaldo, no publicar).
    // Se cuenta al publicar/encolar (bumpUsageForVideo).

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
    const row = (await db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id)) as any
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

    await bumpUsageForVideo(row) // cuenta el uso al publicar (express)
    logInfo('publish', `Publicado a n8n (${env}): ${row.filename}`)
    res.json({ success: true, sentTo: env, videoUrl: s3Url })
  } catch (err: any) {
    logError('publish', `Error publicando a n8n (${req.body?.env ?? 'test'})`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/videos/:id/queue — enviar a aprobación (Fase 4): sube a R2 + escribe
// una fila `pending` en la cola (Google Sheet) y pinga a n8n para que mande el
// paquete a Telegram.
//
// ⚠️ Los copies los genera ESTA ruta, no n8n (ver `generateCopies` más abajo). Los
// nodos Gemini de `[Pub]` siguen existiendo pero desde el 2026-08-18 tienen un IF
// delante (`preApproved && trae el copy`) y no se ejecutan en este carril: antes
// corrían siempre y se tiraban dos llamadas pagadas por reel programado.
// El carril EXPRESS (`/publish`) sí sigue dependiendo de los Gemini de n8n.
router.post('/:id/queue', async (req, res) => {
  try {
    // Falla rápido si n8n no está configurado (evita generar copies y una fila huérfana)
    if (!config.webhooks.approval) {
      return res.status(500).json({ error: 'WEBHOOK_APPROVAL_URL no está configurado' })
    }

    const row = (await db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id)) as any
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

    // Encolar ES aprobar: es el momento en que se decide sacar la pieza, y por eso
    // es aquí donde se generan los copies y sube el contador. Una pieza de lote no
    // llega hasta que alguien la aprueba, así que un rechazo no quema la frase.
    //
    // Se guarda el `queue_id` porque es el único hilo que une esta pieza con lo
    // que David decida DESPUÉS en Telegram: si allí la descarta, n8n escribe
    // `rejected` en esa fila y `reconciliarRechazos()` devuelve el uso.
    await db.prepare(`UPDATE videos SET estado = 'aprobado', queue_id = ? WHERE id = ?`)
      .run(queueRow.id, row.id)
    await bumpUsageForVideo(row) // cuenta el uso al encolar (decisión de sacarlo)
    logInfo('publish', `Enviado a aprobación: ${row.filename}`)
    res.json({ success: true, queueId: queueRow.id })
  } catch (err: any) {
    logError('publish', `Error enviando a aprobación (${req.params.id})`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/videos/pendientes — la cola de revisión: lo que produjo un lote y
// todavía no ha mirado nadie. Ni ha gastado frase ni ha costado copies.
router.get('/pendientes', async (_req, res) => {
  const rows = (await db.prepare(
    `SELECT * FROM videos WHERE estado = 'pendiente_revision' ORDER BY created_at ASC`
  ).all()) as any[]
  res.json(rows.map(rowToVideoRecord))
})

/**
 * POST /api/videos/:id/rehacer — «otra imagen»: descarta esta pieza y rehace la
 * MISMA frase con un fondo nuevo.
 *
 * Es el botón del medio de la pantalla de revisión, y existe porque el caso más
 * común al revisar un lote no es «esta frase no vale» sino «esta frase sí, esta
 * imagen no». Sin él, rechazar devolvía la frase a la rotación y había que esperar
 * a que otro lote la volviera a sacar.
 *
 * Conserva TODO lo demás —texto, tipografía, corte de audio, duración— porque lo
 * que se está descartando es el fondo, no la receta. Y la pieza nueva vuelve a
 * nacer en `pendiente_revision`: sigue sin gastar frase ni copies.
 */
router.post('/:id/rehacer', async (req, res) => {
  try {
    const row = (await db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id)) as any
    if (!row) return res.status(404).json({ error: 'Video not found' })
    if (row.estado === 'aprobado') {
      return res.status(409).json({ error: 'Ya estaba aprobado: rehacerlo dejaría dos piezas de la misma frase en la cola' })
    }
    const cfg = row.config_extra ? JSON.parse(row.config_extra) : null
    if (!cfg?.text?.content) return res.status(400).json({ error: 'La pieza no guarda su receta; no se puede rehacer' })

    // Fondo nuevo. Se intenta con IA —es lo que manda desde el 18-ago— y si no hay
    // hueco se cae a una imagen del banco DISTINTA de la que se acaba de rechazar:
    // repetirla sería ignorar justo lo que David acaba de decir.
    const anterior: string | undefined = cfg.imageId
    const fondo = await generarFondoParaFrase(cfg.text.content, cfg.text?.position?.y ?? 25)
    if (fondo) {
      cfg.imagePath = fondo.localPath
      cfg.imageId = fondo.filename
    } else {
      const otra = (await db.prepare(
        `SELECT filename FROM images
         WHERE embedding IS NOT NULL AND filename <> ?
         ORDER BY usage_count ASC, RANDOM() LIMIT 1`
      ).get(anterior ?? '')) as any
      if (!otra) return res.status(503).json({ error: 'No se pudo generar fondo y no hay otra imagen en el banco' })
      cfg.imageId = otra.filename
      cfg.imagePath = path.join(path.resolve(config.paths.images), otra.filename)
    }

    const id = uuidv4()
    const base = (row.title || 'video').slice(0, 60)
    const { filename, localPath, publicUrl } = await enqueue(() =>
      generateVideo(cfg, `${base}_${id.slice(0, 8)}`)
    )

    let s3Url: string | null = null
    try {
      s3Url = await uploadVideoToS3(localPath, filename)
    } catch (e: any) {
      logError('s3', `Rehecho ${filename} no subió a R2`, e.message)
    }

    await db.prepare(`
      INSERT INTO videos
        (id, filename, title, description, tags, local_path, public_url, s3_url,
         phrase_id, viral, font, effect, resolution, config_extra, created_at, estado)
      VALUES
        (@id, @filename, @title, '', '[]', @local_path, @public_url, @s3_url,
         @phrase_id, 0, @font, NULL, @resolution, @config_extra, @created_at, 'pendiente_revision')
    `).run({
      id,
      filename,
      title: row.title,
      local_path: localPath,
      public_url: publicUrl,
      s3_url: s3Url,
      phrase_id: row.phrase_id,
      font: cfg.text.font,
      resolution: row.resolution,
      config_extra: JSON.stringify(cfg),
      created_at: new Date().toISOString(),
    })

    // La vieja se marca DESPUÉS de que la nueva exista: si el render falla, David se
    // queda con la pieza que tenía en vez de con ninguna.
    await db.prepare(`UPDATE videos SET estado = 'rechazado' WHERE id = ?`).run(row.id)
    logInfo('generate', `Rehecho con otro fondo: ${row.filename} → ${filename}`)

    res.json({
      success: true,
      video: rowToVideoRecord((await db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id)) as any),
    })
  } catch (err: any) {
    logError('generate', `Error rehaciendo ${req.params.id}`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/videos/:id/reject — descartar una pieza pendiente.
//
// No toca ningún contador, que es justamente el punto: la frase vuelve a la
// rotación intacta. `motivo` se guarda en el log para poder mirar después por qué
// se cae lo que se cae; los dos botones del diseño (otra imagen / frase mala) y
// sus consecuencias son de la Fase 5, aquí solo se marca el estado.
router.post('/:id/reject', async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id)) as any
  if (!row) return res.status(404).json({ error: 'Video not found' })
  if (row.estado === 'aprobado') {
    return res.status(409).json({ error: 'Ya estaba aprobado: rechazarlo no revertiría el contador ni la fila de la cola' })
  }

  await db.prepare(`UPDATE videos SET estado = 'rechazado' WHERE id = ?`).run(row.id)
  const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo : 'sin motivo'

  // `motivo: 'frase'` es el tercer botón de la revisión, y hace algo más que
  // descartar la pieza: ARCHIVA la frase. Sin eso, una frase mala volvería a salir
  // en el siguiente lote —el planificador ordena por `usage_count ASC` y rechazar no
  // lo toca— y David tendría que rechazarla una y otra vez.
  //
  // Se archiva y no se borra a propósito: si tiene publicaciones, sus insights
  // cuelgan de `publications.phrase_id` y borrarla rompería la analítica. Archivar
  // la saca del pool y la deja intacta para el histórico, que es la misma decisión
  // que se tomó el 29-jul al reescribir frases.
  let fraseArchivada = false
  if (motivo === 'frase' && row.phrase_id) {
    const r = await db.prepare(`UPDATE phrases SET archived = 1 WHERE id = ? AND archived = 0`).run(row.phrase_id)
    fraseArchivada = r.changes > 0
  }

  logInfo(
    'publish',
    `Rechazado ${row.filename} (${motivo})` +
      (fraseArchivada ? ' — y la frase archivada, fuera de la rotación' : ' — la frase sigue sin usar')
  )
  res.json({ success: true, fraseArchivada })
})

// POST /api/videos/reconciliar — devuelve el uso de lo descartado en Telegram.
// Lo llama también el cron cada 6 h; el endpoint existe para poder forzarlo.
router.post('/reconciliar', async (_req, res) => {
  try {
    res.json(await reconciliarRechazos())
  } catch (err: any) {
    logError('publish', 'Error reconciliando rechazos', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/videos/:id — eliminar video
router.delete('/:id', async (req, res) => {
  const row = (await db.prepare(`SELECT local_path FROM videos WHERE id = ?`).get(req.params.id)) as any
  if (!row) return res.status(404).json({ error: 'Video not found' })

  if (fs.existsSync(row.local_path)) fs.unlinkSync(row.local_path)
  await db.prepare(`DELETE FROM videos WHERE id = ?`).run(req.params.id)

  res.json({ success: true })
})

export default router
