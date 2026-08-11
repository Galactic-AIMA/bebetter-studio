import db from '../db'

/**
 * Metadata de las pistas de audio (tabla audio_tracks). Guarda las etiquetas de
 * energía/mood que produce el tagging por IA (confirmadas por David) y el
 * usage_count para el desempate por variedad en el matching.
 */

export interface AudioMeta {
  filename: string
  energia: number | null
  moodCategory: string | null
  textura: string | null
  descripcion: string | null
  usageCount: number
  analyzedAt: string | null
}

interface Row {
  filename: string
  energia: number | null
  mood_category: string | null
  textura: string | null
  descripcion: string | null
  usage_count: number
  analyzed_at: string | null
}

const toMeta = (r: Row): AudioMeta => ({
  filename: r.filename,
  energia: r.energia,
  moodCategory: r.mood_category,
  textura: r.textura,
  descripcion: r.descripcion,
  usageCount: r.usage_count,
  analyzedAt: r.analyzed_at,
})

/** Todas las filas de audio_tracks, indexadas por filename. */
export function getAllAudioMeta(): Map<string, AudioMeta> {
  const rows = db.prepare(`SELECT * FROM audio_tracks`).all() as Row[]
  return new Map(rows.map((r) => [r.filename, toMeta(r)]))
}

export function getAudioMeta(filename: string): AudioMeta | null {
  const r = db.prepare(`SELECT * FROM audio_tracks WHERE filename = ?`).get(filename) as Row | undefined
  return r ? toMeta(r) : null
}

/** Inserta/actualiza las etiquetas (mantiene usage_count si ya existía). */
export function upsertAudioMeta(
  filename: string,
  energia: number,
  moodCategory: string,
  descripcion: string,
  textura?: string
): void {
  db.prepare(
    `INSERT INTO audio_tracks (filename, energia, mood_category, textura, descripcion, analyzed_at)
     VALUES (@filename, @energia, @mood_category, @textura, @descripcion, @analyzed_at)
     ON CONFLICT(filename) DO UPDATE SET
       energia = excluded.energia,
       mood_category = excluded.mood_category,
       -- sin textura en la petición se conserva la que ya estaba: es el eje que
       -- gobierna la rotación y no debe perderse al reetiquetar solo el mood.
       textura = COALESCE(excluded.textura, audio_tracks.textura),
       descripcion = excluded.descripcion,
       analyzed_at = excluded.analyzed_at`
  ).run({
    filename,
    energia,
    mood_category: moodCategory,
    textura: textura ?? null,
    descripcion,
    analyzed_at: new Date().toISOString(),
  })
}

/**
 * Las últimas `n` pistas que sonaron (y sus texturas), de la más reciente a la más
 * antigua. Sale del historial de vídeos (`videos.config_extra.audioTrack`), que es
 * donde queda constancia de lo que realmente se produjo.
 *
 * Sirve para que la rotación no arranque en frío: sin esto, el primer reel de un
 * lote puede repetir lo que sonó en el último que se generó ayer.
 */
export function getRecentAudio(n: number): { tracks: string[]; textures: string[] } {
  const rows = db.prepare(
    `SELECT config_extra FROM videos
     WHERE config_extra IS NOT NULL ORDER BY created_at DESC LIMIT ?`
  ).all(n * 4) as { config_extra: string }[] // *4: muchos vídeos no llevan audio

  const texturas = new Map(
    (db.prepare(`SELECT filename, textura FROM audio_tracks`).all() as
      { filename: string; textura: string | null }[]).map((t) => [t.filename, t.textura])
  )

  const tracks: string[] = []
  const textures: string[] = []
  for (const r of rows) {
    if (tracks.length >= n) break
    let track: string | undefined
    try { track = JSON.parse(r.config_extra)?.audioTrack } catch { /* JSON roto */ }
    if (!track || !texturas.has(track)) continue // pista borrada o vídeo sin audio
    tracks.push(track)
    const tex = texturas.get(track)
    if (tex) textures.push(tex)
  }
  return { tracks, textures }
}

/** +1 al usage_count (best-effort; crea la fila si no existía). */
export function bumpAudioUsage(filename: string): void {
  const exists = db.prepare(`SELECT 1 FROM audio_tracks WHERE filename = ?`).get(filename)
  if (exists) {
    db.prepare(`UPDATE audio_tracks SET usage_count = usage_count + 1 WHERE filename = ?`).run(filename)
  } else {
    db.prepare(`INSERT INTO audio_tracks (filename, usage_count) VALUES (?, 1)`).run(filename)
  }
}
