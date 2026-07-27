import axios from 'axios'
import db from '../db'
import { readConfigMap } from './sheetsService'
import { logInfo, logError } from './logService'

/**
 * Recolector de insights de @bebetter.path (Instagram Login, `graph.instagram.com`).
 *
 * Guarda **snapshots fechados** en `media_insights`, no un valor único: las
 * métricas crecen con el tiempo, y la API solo conserva 90 días. Con la serie se
 * puede medir la velocidad de las primeras 24 h, que es lo que permite comparar
 * una pieza de ayer con una de hace dos meses sin que gane siempre la vieja.
 *
 * El token sale del Sheet (`config.ig_access_token`), igual que en
 * `instagramService` — lo rota semanalmente el workflow `[IGToken]`.
 */

const IG_API = 'https://graph.instagram.com/v21.0'

async function getToken(): Promise<string> {
  const cfg = await readConfigMap()
  const token = cfg.get('ig_access_token')
  if (!token) throw new Error('No hay ig_access_token en la pestaña `config` del Sheet')
  return token
}

/**
 * Métricas por tipo de media.
 *
 * Meta deprecó en v21 (enero 2025) `impressions` para no-Reels, `profile_views`,
 * `website_clicks` y `video_views`, consolidando en `views` — este set usa el
 * vocabulario nuevo. Aun así la disponibilidad varía por cuenta y por antigüedad
 * del post, por eso `fetchMediaInsights` va descartando las que Meta rechace en
 * vez de darse por vencido.
 */
const METRICS_BY_TYPE: Record<string, string[]> = {
  // `follows` y `profile_visits` NO existen para reels — verificado contra la API:
  // "does not support the follows metric for this media product type". Solo el
  // feed (imagen/carrusel) los expone.
  REELS: ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate'],
  VIDEO: ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions', 'ig_reels_avg_watch_time', 'reels_skip_rate'],
  CAROUSEL_ALBUM: ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions', 'follows', 'profile_visits'],
  IMAGE: ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions', 'follows', 'profile_visits'],
}

/** Nombres de métrica que Meta menciona en su mensaje de error. */
function metricsInError(msg: string, candidatas: string[]): string[] {
  const lower = msg.toLowerCase()
  return candidatas.filter((m) => lower.includes(m.toLowerCase()))
}

/**
 * Pide los insights de un post. Si Meta rechaza alguna métrica (varían por tipo,
 * antigüedad y tipo de cuenta), la descarta y reintenta: preferimos datos
 * parciales a ninguno.
 */
export async function fetchMediaInsights(
  mediaId: string,
  mediaType = 'IMAGE',
  token?: string
): Promise<Record<string, number>> {
  const tk = token ?? (await getToken())
  let metrics = METRICS_BY_TYPE[mediaType] ?? METRICS_BY_TYPE.IMAGE

  for (let intento = 0; intento < 4 && metrics.length; intento++) {
    try {
      const { data } = await axios.get(`${IG_API}/${mediaId}/insights`, {
        params: { metric: metrics.join(','), access_token: tk },
        timeout: 30_000,
      })
      const out: Record<string, number> = {}
      for (const m of data?.data ?? []) {
        const valor = m?.values?.[0]?.value ?? m?.total_value?.value
        if (typeof valor === 'number') out[m.name] = valor
      }
      return out
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err.message ?? ''
      const culpables = metricsInError(msg, metrics)
      if (!culpables.length) throw new Error(`insights de ${mediaId}: ${msg}`)
      metrics = metrics.filter((m) => !culpables.includes(m))
    }
  }

  return {}
}

export function saveSnapshot(mediaId: string, metrics: Record<string, number>, capturedAt?: string): void {
  db.prepare(
    `INSERT INTO media_insights (media_id, captured_at, metrics_json)
     VALUES (?, ?, ?)
     ON CONFLICT(media_id, captured_at) DO UPDATE SET metrics_json = excluded.metrics_json`
  ).run(mediaId, capturedAt ?? new Date().toISOString().slice(0, 10), JSON.stringify(metrics))
}

export interface CollectResult {
  total: number
  ok: number
  fallidas: { mediaId: string; error: string }[]
}

/**
 * Recoge insights de todas las publicaciones conocidas.
 *
 * La granularidad del snapshot es **diaria** (la PK usa la fecha, no la hora):
 * correrlo dos veces el mismo día actualiza la fila en vez de inflar la serie.
 */
export async function collectInsights(soloRecientes = false): Promise<CollectResult> {
  const token = await getToken()

  const desde = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const filas = db
    .prepare(
      soloRecientes
        ? `SELECT media_id, media_type FROM publications WHERE published_at >= ? ORDER BY published_at DESC`
        : `SELECT media_id, media_type FROM publications ORDER BY published_at DESC`
    )
    .all(...(soloRecientes ? [desde] : [])) as { media_id: string; media_type: string | null }[]

  const res: CollectResult = { total: filas.length, ok: 0, fallidas: [] }

  for (const f of filas) {
    try {
      const metrics = await fetchMediaInsights(f.media_id, f.media_type ?? 'IMAGE', token)
      if (Object.keys(metrics).length) {
        saveSnapshot(f.media_id, metrics)
        res.ok++
      } else {
        res.fallidas.push({ mediaId: f.media_id, error: 'sin métricas disponibles' })
      }
    } catch (err: any) {
      res.fallidas.push({ mediaId: f.media_id, error: err.message })
    }
  }

  if (res.fallidas.length) {
    logError('insights', `Insights recogidos con ${res.fallidas.length} fallos de ${res.total}`)
  } else {
    logInfo('insights', `Insights recogidos: ${res.ok}/${res.total} publicaciones`)
  }
  return res
}

// ---------------------------------------------------------------------------
// Cruce rendimiento ↔ receta
// ---------------------------------------------------------------------------

export interface PieceStats {
  mediaId: string
  permalink?: string
  publishedAt: string
  mediaType?: string
  recipeStatus: 'full' | 'partial' | 'none'
  /** Texto de la frase o de la portada del carrusel */
  texto?: string
  moodCategory?: string
  nivelEnergia?: number
  /** 'ia' | 'banco' — de dónde salió la imagen de fondo */
  imagenOrigen?: string
  estilo?: string
  efecto?: string
  audio?: string
  reach?: number
  likes?: number
  comments?: number
  saved?: number
  shares?: number
  views?: number
  /** Seguidores ganados con el post — solo feed, los reels no lo exponen */
  follows?: number
  /** Segundos de visionado medio (reels) */
  avgWatchTime?: number
  /** % que pasa de largo sin verlo (reels). Cuanto más bajo, mejor engancha */
  skipRate?: number
  /** views/reach: cuántas veces se vio por persona alcanzada. >1 = replays */
  viewsPerReach?: number
  /** saves/reach — proxy de "esto merece guardarse" */
  saveRate?: number
  /** shares/reach — el que más correlaciona con alcance nuevo */
  shareRate?: number
  engagementRate?: number
}

/** Último snapshot de cada publicación, ya cruzado con su receta. */
export function pieceStats(): PieceStats[] {
  const filas = db
    .prepare(
      `SELECT
         r.media_id, r.permalink, r.published_at, r.media_type, r.recipe_status,
         COALESCE(pv.text, pc.text) AS frase_video,
         COALESCE(pv.mood_category, pc.mood_category) AS mood,
         COALESCE(pv.nivel_energia, pc.nivel_energia) AS energia,
         v.style, v.effect, v.config_extra,
         c.slides_json,
         i.metrics_json
       FROM v_publication_recipe r
       LEFT JOIN videos    v  ON v.id = r.video_id
       LEFT JOIN carousels c  ON c.id = r.carousel_id
       LEFT JOIN phrases   pv ON pv.id = v.phrase_id
       LEFT JOIN phrases   pc ON pc.id = r.phrase_id
       LEFT JOIN (
         SELECT mi.* FROM media_insights mi
         JOIN (SELECT media_id, MAX(captured_at) AS m FROM media_insights GROUP BY media_id) u
           ON u.media_id = mi.media_id AND u.m = mi.captured_at
       ) i ON i.media_id = r.media_id
       ORDER BY r.published_at DESC`
    )
    .all() as any[]

  return filas.map((f) => {
    const m = f.metrics_json ? JSON.parse(f.metrics_json) : {}
    const reach = m.reach ?? 0

    let texto: string | undefined = f.frase_video ?? undefined
    if (!texto && f.slides_json) {
      try {
        const slides = JSON.parse(f.slides_json)
        texto = (slides.find((s: any) => s.rol === 'portada') ?? slides[0])?.texto
      } catch { /* ignorado */ }
    }

    let audio: string | undefined
    let imagenOrigen: string | undefined
    if (f.config_extra) {
      try {
        const extra = JSON.parse(f.config_extra)
        audio = extra.audioTrack
        if (extra.imageId) {
          const img = db.prepare(`SELECT origen FROM images WHERE filename = ?`).get(extra.imageId) as any
          imagenOrigen = img?.origen ?? 'banco'
        }
      } catch { /* ignorado */ }
    }

    const interacciones = (m.likes ?? 0) + (m.comments ?? 0) + (m.saved ?? 0) + (m.shares ?? 0)

    return {
      mediaId: f.media_id,
      permalink: f.permalink ?? undefined,
      publishedAt: f.published_at,
      mediaType: f.media_type ?? undefined,
      recipeStatus: f.recipe_status,
      texto,
      moodCategory: f.mood ?? undefined,
      nivelEnergia: f.energia ?? undefined,
      imagenOrigen,
      estilo: f.style ?? undefined,
      efecto: f.effect ?? undefined,
      audio,
      reach: m.reach,
      likes: m.likes,
      comments: m.comments,
      saved: m.saved,
      shares: m.shares,
      views: m.views,
      follows: m.follows,
      // La API lo da en milisegundos.
      avgWatchTime: m.ig_reels_avg_watch_time != null ? m.ig_reels_avg_watch_time / 1000 : undefined,
      skipRate: m.reels_skip_rate != null ? m.reels_skip_rate / 100 : undefined,
      viewsPerReach: reach && m.views != null ? m.views / reach : undefined,
      saveRate: reach ? (m.saved ?? 0) / reach : undefined,
      shareRate: reach ? (m.shares ?? 0) / reach : undefined,
      engagementRate: reach ? interacciones / reach : undefined,
    }
  })
}

export interface DimensionSummary {
  dimension: string
  valor: string
  n: number
  reachMedio: number
  saveRate: number
  shareRate: number
  engagementRate: number
}

/** Mínimo de piezas por grupo para que un agregado signifique algo. */
export const MIN_N = 5

/**
 * Agrega por dimensión de receta (mood, estilo, origen de imagen, formato…).
 *
 * Devuelve el **n** de cada grupo siempre: con pocas publicaciones la diferencia
 * entre grupos es ruido, y el consumidor debe poder callarse en vez de pintar un
 * ganador inventado. Por eso no se filtra aquí — se informa.
 */
/**
 * Agrupa la energía en tramos con nombre.
 *
 * Agrupar no es cosmético: la energía viene con decimales (3.5, 6.5, 7.5), así que
 * usarla en crudo parte 60 piezas en diez grupos de uno o dos y ninguno llega al
 * mínimo — todo sale "insuficiente" y la dimensión no dice nada.
 */
export function rangoEnergia(n?: number): string | undefined {
  if (n == null) return undefined
  if (n < 4) return 'baja (1-3)'
  if (n < 6.5) return 'media (4-6)'
  if (n < 8.5) return 'alta (7-8)'
  return 'máxima (9-10)'
}

export function summaryByDimension(stats: PieceStats[] = pieceStats()): DimensionSummary[] {
  const dims: [string, (s: PieceStats) => string | undefined][] = [
    ['mood', (s) => s.moodCategory],
    ['formato', (s) => (s.mediaType === 'CAROUSEL_ALBUM' ? 'carrusel' : 'reel')],
    ['imagen', (s) => s.imagenOrigen],
    ['estilo', (s) => s.estilo],
    ['efecto', (s) => s.efecto],
    ['energia', (s) => rangoEnergia(s.nivelEnergia)],
    ['hora', (s) => `${new Date(s.publishedAt).getHours()}h`],
  ]

  const out: DimensionSummary[] = []
  // Solo piezas con métricas: una sin snapshot no aporta, solo diluye la media.
  const conDatos = stats.filter((s) => s.reach != null)

  for (const [dimension, get] of dims) {
    const grupos = new Map<string, PieceStats[]>()
    for (const s of conDatos) {
      const v = get(s)
      if (!v) continue
      const arr = grupos.get(v) ?? []
      arr.push(s)
      grupos.set(v, arr)
    }
    for (const [valor, items] of grupos) {
      const media = (f: (s: PieceStats) => number | undefined) =>
        items.reduce((a, s) => a + (f(s) ?? 0), 0) / items.length
      out.push({
        dimension,
        valor,
        n: items.length,
        reachMedio: Math.round(media((s) => s.reach)),
        saveRate: media((s) => s.saveRate),
        shareRate: media((s) => s.shareRate),
        engagementRate: media((s) => s.engagementRate),
      })
    }
  }

  return out.sort((a, b) => a.dimension.localeCompare(b.dimension) || b.n - a.n)
}
