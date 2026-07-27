import db from '../db'
import { PublishedMedia } from './instagramService'
import { readQueueRows, readCarouselQueueRows } from './sheetsService'

/**
 * Publicaciones reales ↔ piezas generadas.
 *
 * El "por qué" de la analítica sale de cruzar el rendimiento de un post con la
 * receta que lo produjo (frase, mood, imagen, audio, estilo). Ese cruce necesita
 * un puente: el `media_id` de Instagram guardado junto a la pieza. Hasta ahora se
 * perdía — `[Pub]` y `[SchedCarrusel]` lo conocen al publicar y no lo devuelven a
 * la app —, así que aquí se reconstruye y se persiste.
 *
 * Regla de oro de la reconciliación: **ante la duda, no vincular**. Un cruce
 * equivocado envenena todo el análisis posterior y no deja rastro de que estaba
 * mal; una publicación sin vincular se ve y se arregla a mano.
 */

export interface Publication {
  mediaId: string
  platform: string
  permalink?: string
  mediaType?: string
  publishedAt: string
  videoId?: string
  carouselId?: string
  queueId?: string
  /** Frase de la publicación cuando no hay pieza en la DB (receta parcial) */
  phraseId?: string
  caption?: string
  /** 'app' | 'sheet' | 'caption' | 'semantic' | 'vision' | 'vision-phrase' | null (sin vincular) */
  matchSource?: string
}

/** Inserta o actualiza una publicación. No pisa un vínculo existente con uno vacío. */
export function recordPublication(p: Publication): void {
  db.prepare(
    `INSERT INTO publications
       (media_id, platform, permalink, media_type, published_at, video_id, carousel_id, queue_id, phrase_id, caption, match_source)
     VALUES
       (@mediaId, @platform, @permalink, @mediaType, @publishedAt, @videoId, @carouselId, @queueId, @phraseId, @caption, @matchSource)
     ON CONFLICT(media_id) DO UPDATE SET
       permalink    = COALESCE(excluded.permalink, permalink),
       media_type   = COALESCE(excluded.media_type, media_type),
       video_id     = COALESCE(excluded.video_id, video_id),
       carousel_id  = COALESCE(excluded.carousel_id, carousel_id),
       queue_id     = COALESCE(excluded.queue_id, queue_id),
       phrase_id    = COALESCE(excluded.phrase_id, phrase_id),
       caption      = COALESCE(excluded.caption, caption),
       match_source = COALESCE(excluded.match_source, match_source)`
  ).run({
    mediaId: p.mediaId,
    platform: p.platform ?? 'instagram',
    permalink: p.permalink ?? null,
    mediaType: p.mediaType ?? null,
    publishedAt: p.publishedAt,
    videoId: p.videoId ?? null,
    carouselId: p.carouselId ?? null,
    queueId: p.queueId ?? null,
    phraseId: p.phraseId ?? null,
    caption: p.caption ?? null,
    matchSource: p.matchSource ?? null,
  })
}

export function getPublicationsByCarousel(carouselId: string): Publication[] {
  return db
    .prepare(`SELECT * FROM publications WHERE carousel_id = ?`)
    .all(carouselId)
    .map(rowToPublication)
}

function rowToPublication(r: any): Publication {
  return {
    mediaId: r.media_id,
    platform: r.platform,
    permalink: r.permalink ?? undefined,
    mediaType: r.media_type ?? undefined,
    publishedAt: r.published_at,
    videoId: r.video_id ?? undefined,
    carouselId: r.carousel_id ?? undefined,
    queueId: r.queue_id ?? undefined,
    phraseId: r.phrase_id ?? undefined,
    caption: r.caption ?? undefined,
    matchSource: r.match_source ?? undefined,
  }
}

/**
 * Trae a la DB los `mediaId` que n8n haya escrito en las colas del Sheet.
 *
 * `[Pub]` y `[SchedCarrusel]` publican cuando la app no está corriendo, así que
 * no pueden llamarla: dejan el media id en la fila `published` y la app lo
 * recoge de ahí. Evita tocar los 58 nodos de `[Pub]` con un webhook de vuelta.
 *
 * Devuelve cuántos vínculos nuevos se registraron.
 */
export async function syncPublicationsFromSheet(): Promise<number> {
  const [queue, carouselQueue] = await Promise.all([
    readQueueRows().catch(() => []),
    readCarouselQueueRows().catch(() => []),
  ])

  const videosByUrl = new Map<string, string>()
  for (const v of db.prepare(`SELECT id, s3_url FROM videos WHERE s3_url IS NOT NULL`).all() as any[]) {
    videosByUrl.set(v.s3_url, v.id)
  }

  let n = 0

  for (const r of queue) {
    if (!r.mediaId || r.status !== 'published') continue
    recordPublication({
      mediaId: r.mediaId,
      platform: 'instagram',
      permalink: r.permalink,
      publishedAt: r.publishedAt ?? r.createdAt,
      videoId: videosByUrl.get(r.videoUrl),
      queueId: r.id,
      caption: r.captionIG,
      matchSource: 'sheet',
    })
    n++
  }

  for (const r of carouselQueue) {
    if (!r.mediaId || r.status !== 'published') continue
    recordPublication({
      mediaId: r.mediaId,
      platform: 'instagram',
      mediaType: 'CAROUSEL_ALBUM',
      permalink: r.permalink,
      publishedAt: r.publishedAt ?? r.createdAt,
      carouselId: r.carouselId,
      queueId: r.id,
      caption: r.captionIG,
      matchSource: 'sheet',
    })
    n++
  }

  return n
}

// ---------------------------------------------------------------------------
// Reconciliación
// ---------------------------------------------------------------------------

/** Normaliza texto para comparar: sin acentos, sin puntuación, minúsculas. */
function norm(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Similitud por solapamiento de palabras significativas (Jaccard sobre palabras
 * de 4+ letras). Suficiente y predecible para comparar un caption con la frase
 * que lo originó: el caption lleva la frase dentro, más hashtags y relleno.
 */
export function textOverlap(a: string, b: string): number {
  const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length >= 4))
  const A = words(a)
  const B = words(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / Math.min(A.size, B.size)
}

export interface ReconcileCandidate {
  media: PublishedMedia
  videoId?: string
  carouselId?: string
  queueId?: string
  /** Frase identificada aunque no haya pieza en la DB (receta parcial) */
  phraseId?: string
  matchSource?: string
  /** 0–1; sube con el solapamiento de texto y la cercanía temporal */
  confidence: number
  /** Por qué se decidió así (para el informe del script) */
  reason: string
}

export interface ReconcileReport {
  matched: ReconcileCandidate[]
  /** Publicado en IG pero sin pieza en la DB — típicamente anterior al historial */
  orphanMedia: ReconcileCandidate[]
  /** Piezas de la DB marcadas como publicadas que no aparecen en IG */
  unpublishedPieces: { kind: 'video' | 'carousel'; id: string; label: string; publishedAt?: string }[]
}

const CONFIDENT = 0.6

/**
 * Cruza lo que hay publicado en Instagram con las piezas de la DB.
 *
 * Estrategia, de más fuerte a más débil:
 *  1. **Cola de carruseles** (`ColaCarruseles`): la fila `published` guarda el
 *     `carouselId` y la fecha real → vínculo directo, sin adivinar.
 *  2. **Cola de reels**: la fila guarda `videoUrl`, que es exactamente `videos.s3_url`
 *     → vínculo directo. La fecha acota qué post de IG le corresponde.
 *  3. **Caption ↔ frase**: para lo anterior a la cola. Solo vincula por encima del
 *     umbral de confianza; el resto se reporta como huérfano.
 */
export async function reconcile(media: PublishedMedia[]): Promise<ReconcileReport> {
  const matched: ReconcileCandidate[] = []
  const orphanMedia: ReconcileCandidate[] = []

  const [queue, carouselQueue] = await Promise.all([
    readQueueRows().catch(() => []),
    readCarouselQueueRows().catch(() => []),
  ])

  const publishedQueue = queue.filter((r) => r.status === 'published' && r.publishedAt)
  const publishedCarousels = carouselQueue.filter((r) => r.status === 'published' && r.publishedAt)

  // videos.s3_url → videos.id, para resolver la fila de la cola a una pieza real.
  const videosByUrl = new Map<string, string>()
  for (const v of db.prepare(`SELECT id, s3_url FROM videos WHERE s3_url IS NOT NULL`).all() as any[]) {
    videosByUrl.set(v.s3_url, v.id)
  }

  // Frase de cada video, para el emparejamiento por caption.
  const phraseByVideo = new Map<string, string>()
  for (const r of db
    .prepare(`SELECT v.id, p.text FROM videos v JOIN phrases p ON p.id = v.phrase_id`)
    .all() as any[]) {
    phraseByVideo.set(r.id, r.text)
  }

  // Texto de la portada de cada carrusel (slide 1), que es lo que lleva el caption.
  const coverByCarousel = new Map<string, string>()
  for (const c of db.prepare(`SELECT id, slides_json FROM carousels`).all() as any[]) {
    try {
      const slides = JSON.parse(c.slides_json ?? '[]')
      const portada = slides.find((s: any) => s.rol === 'portada') ?? slides[0]
      if (portada?.texto) coverByCarousel.set(c.id, portada.texto)
    } catch {
      /* slides_json corrupto: se ignora, el carrusel quedará sin vincular */
    }
  }

  const usedVideos = new Set<string>()
  const usedCarousels = new Set<string>()

  for (const m of media) {
    const ts = m.timestamp ? Date.parse(m.timestamp) : NaN
    const esCarrusel = m.mediaType === 'CAROUSEL_ALBUM'

    // --- 1/2. Vía cola del Sheet: fecha cercana (±6 h) al publishedAt de la fila.
    const cerca = <T extends { publishedAt?: string }>(rows: T[]): T | undefined => {
      if (Number.isNaN(ts)) return undefined
      let best: T | undefined
      let bestDiff = 6 * 60 * 60 * 1000
      for (const r of rows) {
        const d = Math.abs(Date.parse(r.publishedAt!) - ts)
        if (!Number.isNaN(d) && d < bestDiff) {
          best = r
          bestDiff = d
        }
      }
      return best
    }

    if (esCarrusel) {
      const fila = cerca(publishedCarousels)
      if (fila?.carouselId && !usedCarousels.has(fila.carouselId)) {
        usedCarousels.add(fila.carouselId)
        matched.push({
          media: m,
          carouselId: fila.carouselId,
          queueId: fila.id,
          matchSource: 'sheet',
          confidence: 1,
          reason: `fila published de ColaCarruseles (${fila.publishedAt})`,
        })
        continue
      }
    } else {
      const fila = cerca(publishedQueue)
      const videoId = fila ? videosByUrl.get(fila.videoUrl) : undefined
      if (videoId && !usedVideos.has(videoId)) {
        usedVideos.add(videoId)
        matched.push({
          media: m,
          videoId,
          queueId: fila!.id,
          matchSource: 'sheet',
          confidence: 1,
          reason: `fila published de la Cola → videos.s3_url (${fila!.publishedAt})`,
        })
        continue
      }
    }

    // --- 3. Vía caption ↔ texto de la pieza.
    const caption = m.caption ?? ''
    let best: { id: string; kind: 'video' | 'carousel'; score: number } | undefined

    if (caption) {
      const pool: [string, string, 'video' | 'carousel'][] = esCarrusel
        ? [...coverByCarousel].map(([id, t]) => [id, t, 'carousel'])
        : [...phraseByVideo].map(([id, t]) => [id, t, 'video'])

      for (const [id, texto, kind] of pool) {
        if (kind === 'video' && usedVideos.has(id)) continue
        if (kind === 'carousel' && usedCarousels.has(id)) continue
        const score = textOverlap(caption, texto)
        if (!best || score > best.score) best = { id, kind, score }
      }
    }

    if (best && best.score >= CONFIDENT) {
      if (best.kind === 'video') usedVideos.add(best.id)
      else usedCarousels.add(best.id)
      matched.push({
        media: m,
        videoId: best.kind === 'video' ? best.id : undefined,
        carouselId: best.kind === 'carousel' ? best.id : undefined,
        matchSource: 'caption',
        confidence: best.score,
        reason: `caption ↔ texto de la pieza (solapamiento ${(best.score * 100).toFixed(0)}%)`,
      })
    } else {
      orphanMedia.push({
        media: m,
        confidence: best?.score ?? 0,
        reason: best
          ? `mejor candidato solo al ${(best.score * 100).toFixed(0)}% — por debajo del umbral, NO se vincula`
          : 'sin candidato en la DB (probablemente anterior al historial)',
      })
    }
  }

  // Piezas que la cola da por publicadas pero que no aparecen en Instagram.
  const vistosVideos = new Set(matched.map((m) => m.videoId).filter(Boolean) as string[])
  const vistosCarruseles = new Set(matched.map((m) => m.carouselId).filter(Boolean) as string[])
  const unpublishedPieces: ReconcileReport['unpublishedPieces'] = []

  for (const fila of publishedQueue) {
    const videoId = videosByUrl.get(fila.videoUrl)
    if (videoId && !vistosVideos.has(videoId)) {
      unpublishedPieces.push({
        kind: 'video',
        id: videoId,
        label: (fila.phrase ?? '').slice(0, 60),
        publishedAt: fila.publishedAt,
      })
    }
  }
  for (const fila of publishedCarousels) {
    if (fila.carouselId && !vistosCarruseles.has(fila.carouselId)) {
      unpublishedPieces.push({
        kind: 'carousel',
        id: fila.carouselId,
        label: (fila.tema ?? '').split('\n')[0].slice(0, 60),
        publishedAt: fila.publishedAt,
      })
    }
  }

  return { matched, orphanMedia, unpublishedPieces }
}

/** Float32Array respetando el byteOffset del BLOB (los slices de SQLite no siempre empiezan en 0). */
function toF32(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

/** Umbral de coseno para aceptar un vínculo semántico. */
const SEMANTIC_MIN = 0.72

/**
 * Segundo pase sobre los huérfanos, por **significado** en vez de por palabras.
 *
 * Hace falta porque el caption de Instagram no es la frase: lo escribe Gemini a
 * partir de ella (hook + problema + verdad + acción), así que comparte el sentido
 * pero pocas palabras — el solapamiento léxico se queda en 25-50% y no distingue
 * un acierto de una coincidencia temática.
 *
 * Como las 127 frases ya están vectorizadas (`phrases.embedding`), basta con
 * embeber el caption y buscar la frase más cercana. Cuesta una llamada de
 * embedding por huérfano.
 *
 * Desempate cuando varias piezas comparten frase: la generada **antes** de la
 * publicación y más cercana en el tiempo.
 */
export async function refineWithEmbeddings(
  orphans: ReconcileCandidate[],
  embed: (text: string) => Promise<Float32Array>,
  cosine: (a: Float32Array, b: Float32Array) => number,
  usedVideoIds: Set<string> = new Set()
): Promise<{ rescued: ReconcileCandidate[]; stillOrphan: ReconcileCandidate[] }> {
  const frases = (
    db.prepare(`SELECT id, text, embedding FROM phrases WHERE embedding IS NOT NULL`).all() as any[]
  ).map((p) => ({ id: p.id as string, text: p.text as string, vec: toF32(p.embedding as Buffer) }))

  const videosByPhrase = new Map<string, { id: string; createdAt: string }[]>()
  for (const v of db
    .prepare(`SELECT id, phrase_id, created_at FROM videos WHERE phrase_id IS NOT NULL ORDER BY created_at`)
    .all() as any[]) {
    const arr = videosByPhrase.get(v.phrase_id) ?? []
    arr.push({ id: v.id, createdAt: v.created_at })
    videosByPhrase.set(v.phrase_id, arr)
  }

  const rescued: ReconcileCandidate[] = []
  const stillOrphan: ReconcileCandidate[] = []

  for (const o of orphans) {
    const caption = (o.media.caption ?? '').trim()
    // Un carrusel viejo o un post sin caption no tienen por dónde agarrarse.
    if (!caption || o.media.mediaType === 'CAROUSEL_ALBUM') {
      stillOrphan.push(o)
      continue
    }

    let vec: Float32Array
    try {
      vec = await embed(caption)
    } catch {
      stillOrphan.push({ ...o, reason: `${o.reason}; el embedding del caption falló` })
      continue
    }

    let best: { phraseId: string; text: string; score: number } | undefined
    for (const f of frases) {
      const score = cosine(vec, f.vec)
      if (!best || score > best.score) best = { phraseId: f.id, text: f.text, score }
    }

    const ts = o.media.timestamp ? Date.parse(o.media.timestamp) : NaN
    const candidatos = best ? (videosByPhrase.get(best.phraseId) ?? []) : []
    const elegido = candidatos
      .filter((v) => !usedVideoIds.has(v.id))
      // El video tuvo que existir antes de publicarse (con 1 día de margen por husos/desfases).
      .filter((v) => Number.isNaN(ts) || Date.parse(v.createdAt) <= ts + 24 * 60 * 60 * 1000)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]

    if (best && best.score >= SEMANTIC_MIN && elegido) {
      usedVideoIds.add(elegido.id)
      rescued.push({
        ...o,
        videoId: elegido.id,
        matchSource: 'semantic',
        confidence: best.score,
        reason: `caption ↔ frase por embedding (coseno ${best.score.toFixed(2)}): "${best.text.slice(0, 50)}…"`,
      })
    } else {
      stillOrphan.push({
        ...o,
        confidence: best?.score ?? 0,
        reason: best
          ? elegido
            ? `mejor frase al coseno ${best.score.toFixed(2)}, bajo el umbral ${SEMANTIC_MIN} — NO se vincula`
            : `frase parecida (coseno ${best.score.toFixed(2)}) pero sin video suyo anterior a la publicación`
          : o.reason,
      })
    }
  }

  return { rescued, stillOrphan }
}

/**
 * Tercer pase: leer la frase **en la propia miniatura**.
 *
 * Es el más fiable de todos para el contenido de bebetter, porque los reels
 * llevan la frase quemada en el video: la miniatura contiene el texto original,
 * no una reescritura. Rescata dos cosas distintas:
 *
 *  - Si la frase corresponde a un video de la DB → vínculo completo.
 *  - Si la frase existe en `phrases` pero no hay video (contenido anterior al
 *    historial) → se guarda `phrase_id`, que ya da **media receta**: mood,
 *    energía y paleta salen de la frase, aunque se pierda el estilo de render.
 *
 * `fetchImage` se inyecta para no atar el servicio a un cliente HTTP concreto.
 */
export async function refineWithVision(
  orphans: ReconcileCandidate[],
  fetchImage: (url: string) => Promise<Buffer>,
  ocr: (buf: Buffer) => Promise<string>,
  usedVideoIds: Set<string> = new Set()
): Promise<{ rescued: ReconcileCandidate[]; phraseOnly: ReconcileCandidate[]; stillOrphan: ReconcileCandidate[] }> {
  const frases = db.prepare(`SELECT id, text FROM phrases`).all() as { id: string; text: string }[]

  const videosByPhrase = new Map<string, { id: string; createdAt: string }[]>()
  for (const v of db
    .prepare(`SELECT id, phrase_id, created_at FROM videos WHERE phrase_id IS NOT NULL ORDER BY created_at`)
    .all() as any[]) {
    const arr = videosByPhrase.get(v.phrase_id) ?? []
    arr.push({ id: v.id, createdAt: v.created_at })
    videosByPhrase.set(v.phrase_id, arr)
  }

  const rescued: ReconcileCandidate[] = []
  const phraseOnly: ReconcileCandidate[] = []
  const stillOrphan: ReconcileCandidate[] = []

  for (const o of orphans) {
    const url = o.media.thumbnailUrl
    if (!url) {
      stillOrphan.push({ ...o, reason: `${o.reason}; sin miniatura para leer` })
      continue
    }

    let texto = ''
    try {
      texto = await ocr(await fetchImage(url))
    } catch (err: any) {
      stillOrphan.push({ ...o, reason: `${o.reason}; no se pudo leer la miniatura (${err.message})` })
      continue
    }

    if (!texto) {
      stillOrphan.push({ ...o, reason: `${o.reason}; la miniatura no tiene texto legible` })
      continue
    }

    // Aquí sí comparamos frase literal contra frase literal: el solapamiento
    // léxico es fiable y no hace falta gastar embeddings.
    let best: { id: string; text: string; score: number } | undefined
    for (const f of frases) {
      const score = textOverlap(texto, f.text)
      if (!best || score > best.score) best = { id: f.id, text: f.text, score }
    }

    if (!best || best.score < CONFIDENT) {
      stillOrphan.push({
        ...o,
        confidence: best?.score ?? 0,
        reason: `leído en la miniatura: "${texto.slice(0, 60)}" — sin frase equivalente en el banco`,
      })
      continue
    }

    const ts = o.media.timestamp ? Date.parse(o.media.timestamp) : NaN
    const elegido = (videosByPhrase.get(best.id) ?? [])
      .filter((v) => !usedVideoIds.has(v.id))
      .filter((v) => Number.isNaN(ts) || Date.parse(v.createdAt) <= ts + 24 * 60 * 60 * 1000)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]

    const base = {
      ...o,
      phraseId: best.id,
      confidence: best.score,
    }

    if (elegido) {
      usedVideoIds.add(elegido.id)
      rescued.push({
        ...base,
        videoId: elegido.id,
        matchSource: 'vision',
        reason: `frase leída en la miniatura ↔ video de la DB (solapamiento ${(best.score * 100).toFixed(0)}%)`,
      })
    } else {
      phraseOnly.push({
        ...base,
        matchSource: 'vision-phrase',
        reason: `frase recuperada de la miniatura ("${best.text.slice(0, 45)}…") pero sin video en la DB — receta parcial`,
      })
    }
  }

  return { rescued, phraseOnly, stillOrphan }
}

/** Persiste los vínculos de un informe de reconciliación. Devuelve cuántos guardó. */
export function persistReconcile(report: ReconcileReport, includeOrphans = true): number {
  const filas = [...report.matched, ...(includeOrphans ? report.orphanMedia : [])]
  const tx = db.transaction((items: ReconcileCandidate[]) => {
    for (const c of items) {
      recordPublication({
        mediaId: c.media.id,
        platform: 'instagram',
        permalink: c.media.permalink,
        mediaType: c.media.productType === 'REELS' ? 'REELS' : c.media.mediaType,
        publishedAt: c.media.timestamp ?? new Date().toISOString(),
        videoId: c.videoId,
        carouselId: c.carouselId,
        queueId: c.queueId,
        phraseId: c.phraseId,
        caption: c.media.caption,
        matchSource: c.matchSource,
      })
    }
  })
  tx(filas)
  return filas.length
}
