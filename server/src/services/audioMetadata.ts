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
  descripcion: string | null
  usageCount: number
  analyzedAt: string | null
}

interface Row {
  filename: string
  energia: number | null
  mood_category: string | null
  descripcion: string | null
  usage_count: number
  analyzed_at: string | null
}

const toMeta = (r: Row): AudioMeta => ({
  filename: r.filename,
  energia: r.energia,
  moodCategory: r.mood_category,
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
  descripcion: string
): void {
  db.prepare(
    `INSERT INTO audio_tracks (filename, energia, mood_category, descripcion, analyzed_at)
     VALUES (@filename, @energia, @mood_category, @descripcion, @analyzed_at)
     ON CONFLICT(filename) DO UPDATE SET
       energia = excluded.energia,
       mood_category = excluded.mood_category,
       descripcion = excluded.descripcion,
       analyzed_at = excluded.analyzed_at`
  ).run({
    filename,
    energia,
    mood_category: moodCategory,
    descripcion,
    analyzed_at: new Date().toISOString(),
  })
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
