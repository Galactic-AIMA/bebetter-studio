import db from '../db'

/**
 * Procedencia de los cortes de audio (tabla `audio_sources`): de qué reel del
 * nicho salió cada uno y qué frase se leía en pantalla en él.
 *
 * La relación con `audio_tracks` es 1:N y eso NO es un detalle de normalización:
 * varios reels del nicho usan el mismo tema. Cada uno aporta una frase de origen
 * distinta para la MISMA pista, así que una pista muy reutilizada acaba con varias
 * frases y empareja mejor cuanto más se la ha visto funcionar.
 */

export interface AudioSource {
  sourceUrl: string
  filename: string
  sourcePhrase: string | null
  sourceEmbedding: Float32Array | null
  audioAssetId: string | null
  audioTitle: string | null
  audioArtist: string | null
  /** Segundo del tema por el que entra ESE reel (ms). */
  startMs: number | null
  harvestedAt: string | null
}

interface Row {
  source_url: string
  filename: string
  source_phrase: string | null
  source_embedding: Buffer | null
  audio_asset_id: string | null
  audio_title: string | null
  audio_artist: string | null
  start_ms: number | null
  harvested_at: string | null
}

/** BLOB → vector respetando el byteOffset (los slices de SQLite no empiezan en 0). */
function vec(b: Buffer | null): Float32Array | null {
  if (!b || b.byteLength === 0) return null
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

const toSource = (r: Row): AudioSource => ({
  sourceUrl: r.source_url,
  filename: r.filename,
  sourcePhrase: r.source_phrase,
  sourceEmbedding: vec(r.source_embedding),
  audioAssetId: r.audio_asset_id,
  audioTitle: r.audio_title,
  audioArtist: r.audio_artist,
  startMs: r.start_ms,
  harvestedAt: r.harvested_at,
})

/** Todas las procedencias, agrupadas por pista. */
export async function getSourcesByTrack(): Promise<Map<string, AudioSource[]>> {
  const rows = (await db.prepare(`SELECT * FROM audio_sources ORDER BY harvested_at ASC`).all()) as Row[]
  const out = new Map<string, AudioSource[]>()
  for (const r of rows) {
    const s = toSource(r)
    const lista = out.get(s.filename)
    if (lista) lista.push(s)
    else out.set(s.filename, [s])
  }
  return out
}

export async function getSource(sourceUrl: string): Promise<AudioSource | null> {
  const r = (await db.prepare(`SELECT * FROM audio_sources WHERE source_url = ?`).get(sourceUrl)) as Row | undefined
  return r ? toSource(r) : null
}

/**
 * Pista que ya se bajó para ese audio de Instagram, si la hay.
 *
 * Es lo que evita bajar cinco veces el mismo tema porque cinco reels lo usaron: se
 * reutiliza el mp3 y solo se añade la frase de origen nueva. El id del audio es la
 * clave correcta para esto — dos reels que comparten tema tienen URLs que no se
 * parecen en nada.
 */
export async function filenameDeAsset(audioAssetId: string): Promise<string | null> {
  const r = (await db.prepare(
    `SELECT filename FROM audio_sources WHERE audio_asset_id = ? LIMIT 1`
  ).get(audioAssetId)) as { filename: string } | undefined
  return r?.filename ?? null
}

/**
 * Alta/actualización de una procedencia (sin tocar la frase ni su vector).
 *
 * Crea también la fila de `audio_tracks` si falta, y eso NO es cosmético: el
 * matcher recorre `audio_tracks` y cruza contra las procedencias, así que un corte
 * cosechado que solo existiera aquí nunca llegaría a sonar. Lo mismo con
 * `getRecentAudio`, que necesita la fila para saber qué textura sonó. La pista nace
 * sin etiquetar —energía, mood y textura son informativos desde el 18-ago— y con
 * `usage_count` a 0.
 */
export async function upsertSource(s: {
  sourceUrl: string
  filename: string
  audioAssetId?: string | null
  audioTitle?: string | null
  audioArtist?: string | null
  startMs?: number | null
  /**
   * Frase LEÍDA por Gemini, pendiente de que David la revise. Se guarda para que
   * sobreviva a cerrar el panel: si solo viajara en la respuesta HTTP, una tanda de
   * 56 reels obligaría a reescribirlas todas a mano. Nunca pisa una frase ya
   * escrita — lo que distingue propuesta de confirmada es el VECTOR, no el texto.
   */
  proposedPhrase?: string | null
}): Promise<void> {
  await db.prepare(`INSERT INTO audio_tracks (filename) VALUES (?) ON CONFLICT (filename) DO NOTHING`).run(s.filename)
  await db.prepare(
    `INSERT INTO audio_sources (source_url, filename, audio_asset_id, audio_title, audio_artist, start_ms, source_phrase, harvested_at)
     VALUES (@source_url, @filename, @audio_asset_id, @audio_title, @audio_artist, @start_ms, @source_phrase, @harvested_at)
     ON CONFLICT(source_url) DO UPDATE SET
       filename = excluded.filename,
       -- Los metadatos de Instagram solo se pisan si vienen: una recosecha sin
       -- sesión no debe borrar el título que sí se consiguió la primera vez.
       audio_asset_id = COALESCE(excluded.audio_asset_id, audio_sources.audio_asset_id),
       audio_title    = COALESCE(excluded.audio_title, audio_sources.audio_title),
       audio_artist   = COALESCE(excluded.audio_artist, audio_sources.audio_artist),
       start_ms       = COALESCE(excluded.start_ms, audio_sources.start_ms),
       source_phrase  = COALESCE(audio_sources.source_phrase, excluded.source_phrase)`
  ).run({
    source_url: s.sourceUrl,
    filename: s.filename,
    audio_asset_id: s.audioAssetId ?? null,
    audio_title: s.audioTitle ?? null,
    audio_artist: s.audioArtist ?? null,
    start_ms: s.startMs ?? null,
    source_phrase: s.proposedPhrase?.trim() || null,
    harvested_at: new Date().toISOString(),
  })
}

/** Guarda la frase de origen ya vectorizada. Es lo que mete la fila en el pool. */
export async function setSourcePhrase(sourceUrl: string, frase: string, vector: Float32Array): Promise<void> {
  const r = await db.prepare(
    `UPDATE audio_sources SET source_phrase = ?, source_embedding = ? WHERE source_url = ?`
  ).run(frase, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength), sourceUrl)
  if (r.changes === 0) throw new Error(`No hay procedencia registrada para ${sourceUrl}`)
}

/** Borra una procedencia (un reel mal cosechado, sin tocar el archivo de audio). */
export async function deleteSource(sourceUrl: string): Promise<boolean> {
  return (await db.prepare(`DELETE FROM audio_sources WHERE source_url = ?`).run(sourceUrl)).changes > 0
}
