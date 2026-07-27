import Database from 'better-sqlite3'
import path from 'path'

const DB_FILE = path.join(__dirname, '../../data/bebetter.db')

const db = new Database(DB_FILE)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS phrases (
    id            TEXT PRIMARY KEY,
    text          TEXT NOT NULL,
    category      TEXT,
    author        TEXT,
    usage_count   INTEGER DEFAULT 0,
    mood_keywords TEXT,
    analyzed_at   TEXT,
    sort_order    INTEGER,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS images (
    filename    TEXT PRIMARY KEY,
    tags        TEXT,
    analyzed_at TEXT,
    usage_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS videos (
    id           TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    title        TEXT,
    description  TEXT,
    tags         TEXT,
    local_path   TEXT,
    public_url   TEXT,
    s3_url       TEXT,
    drive_url    TEXT,
    phrase_id    TEXT,
    viral        INTEGER DEFAULT 0,
    font         TEXT,
    style        TEXT,
    resolution   TEXT,
    mode         TEXT,
    effect       TEXT,
    config_extra TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS images_output (
    id           TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    local_path   TEXT,
    public_url   TEXT,
    drive_url    TEXT,
    phrase_id    TEXT,
    variant      TEXT,
    viral        INTEGER DEFAULT 0,
    font         TEXT,
    style        TEXT,
    resolution   TEXT,
    config_extra TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audio_tracks (
    filename      TEXT PRIMARY KEY,
    energia       INTEGER,
    mood_category TEXT,
    descripcion   TEXT,
    usage_count   INTEGER DEFAULT 0,
    analyzed_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS carousels (
    id            TEXT PRIMARY KEY,
    tema          TEXT NOT NULL,
    tipo          TEXT,
    aspect        TEXT,
    slides_json   TEXT,
    cover_kie_url TEXT,
    status        TEXT DEFAULT 'draft',
    created_at    TEXT DEFAULT (datetime('now'))
  );

  -- Publicaciones reales en redes. Es el eslabón que une una pieza generada
  -- (video/carrusel) con su rendimiento: sin el media_id no se puede pedir
  -- insights ni saber qué receta produjo qué resultado.
  -- video_id/carousel_id son nullable a propósito: hay publicaciones anteriores
  -- al historial que no tienen pieza en la DB (se detectan y se dejan sin vincular).
  CREATE TABLE IF NOT EXISTS publications (
    media_id     TEXT PRIMARY KEY,
    platform     TEXT NOT NULL DEFAULT 'instagram',
    permalink    TEXT,
    media_type   TEXT,
    published_at TEXT NOT NULL,
    video_id     TEXT,
    carousel_id  TEXT,
    queue_id     TEXT,
    caption      TEXT,
    match_source TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_publications_video    ON publications(video_id);
  CREATE INDEX IF NOT EXISTS idx_publications_carousel ON publications(carousel_id);

  -- Snapshots de rendimiento. Fechados a propósito: los números crecen con el
  -- tiempo y la API solo conserva 90 días, así que guardando series (a) el
  -- histórico propio es ilimitado y (b) se puede medir la VELOCIDAD (cuánto pegó
  -- en las primeras 24 h), que compara piezas de distinta antigüedad sin castigar
  -- a las recientes. metrics_json va crudo: si Meta cambia el vocabulario de
  -- métricas —ya lo hizo en v21— se reinterpreta sin perder lo recogido.
  CREATE TABLE IF NOT EXISTS media_insights (
    media_id    TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    PRIMARY KEY (media_id, captured_at)
  );

  CREATE TABLE IF NOT EXISTS pinterest_pins (
    pin_id        TEXT PRIMARY KEY,
    downloaded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pinterest_sync_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp     TEXT,
    new_images    INTEGER,
    total_checked INTEGER,
    status        TEXT,
    error         TEXT
  );
`)

// Columnas de análisis estructurado y embeddings (idempotente)
for (const sql of [
  `ALTER TABLE images ADD COLUMN analysis_json TEXT`,
  `ALTER TABLE images ADD COLUMN embedding BLOB`,
  `ALTER TABLE phrases ADD COLUMN descripcion_mood TEXT`,
  `ALTER TABLE phrases ADD COLUMN embedding BLOB`,
  // Re-rank estructurado del matching conceptual (2026-07-24)
  `ALTER TABLE phrases ADD COLUMN nivel_energia INTEGER`,
  `ALTER TABLE phrases ADD COLUMN paleta TEXT`,
  // Categoría de mood para el emparejamiento de audio (2026-07-25)
  `ALTER TABLE phrases ADD COLUMN mood_category TEXT`,
  // Origen de la imagen: null/'banco' = subida/Pinterest, 'ia' = generada con IA (2026-07-25)
  `ALTER TABLE images ADD COLUMN origen TEXT`,
  // Atribución + marca de serie del carrusel ({autor,obra,referencia}) (2026-07-26)
  `ALTER TABLE carousels ADD COLUMN fuente_json TEXT`,
  // Frase de una publicación cuya pieza no está en la DB (contenido anterior al
  // historial): sin video_id, pero con la frase ya se tiene media receta —
  // mood, energía y paleta salen de `phrases` (2026-07-26)
  `ALTER TABLE publications ADD COLUMN phrase_id TEXT`,
  // Imagen de fondo IDENTIFICADA en la miniatura (no la que dice el historial:
  // estas publicaciones no tienen pieza en la DB). Se guarda con su score para
  // poder revisar o rehacer la identificación con otro umbral (2026-07-27).
  `ALTER TABLE publications ADD COLUMN image_filename TEXT`,
  `ALTER TABLE publications ADD COLUMN image_match_score REAL`,
]) {
  try { db.exec(sql) } catch (_) { /* columna ya existe */ }
}

// Cobertura de la receta de cada publicación, DERIVADA por bloques.
//
// Antes esto era un binario (`hay pieza en la DB` = completa) y mentía por los
// dos lados: una publicación con pieza pero sin audio se contaba como completa,
// y una a la que se le había reconocido la imagen se veía igual que una que solo
// tenía la frase. Ahora cada bloque se comprueba por separado y `recipe_status`
// sale de cuántos hay.
//
// `audio` se considera conocido en cuanto hay pieza en la DB: si la config del
// render está y no menciona pista, es que el vídeo se generó SIN música (el audio
// de fondo no existió hasta el 23-jul-2026) — verificado con ffprobe sobre un
// vídeo de junio en R2: un solo stream, h264, sin audio. Eso es un valor real,
// no un hueco, y además permite comparar "con música" contra "sin música".
//
// En carruseles, `audio` y `render` NO APLICAN (no llevan música y el "render" es
// el prompt de marca, que ya vive en slides_json) → cuentan como cubiertos, para
// no marcarlos incompletos por algo que nunca van a tener.
db.exec(`DROP VIEW IF EXISTS v_publication_recipe`)
db.exec(`
  CREATE VIEW v_publication_recipe AS
  SELECT
    p.*,
    CASE WHEN p.phrase_id IS NOT NULL OR v.phrase_id IS NOT NULL OR p.carousel_id IS NOT NULL
         THEN 1 ELSE 0 END AS has_phrase,
    CASE WHEN p.image_filename IS NOT NULL
              OR json_extract(v.config_extra, '$.imageId') IS NOT NULL
              OR p.carousel_id IS NOT NULL
         THEN 1 ELSE 0 END AS has_image,
    CASE WHEN p.video_id IS NOT NULL OR p.carousel_id IS NOT NULL
         THEN 1 ELSE 0 END AS has_audio,
    CASE WHEN v.style IS NOT NULL OR v.font IS NOT NULL OR p.carousel_id IS NOT NULL
         THEN 1 ELSE 0 END AS has_render,
    (
      CASE WHEN p.phrase_id IS NOT NULL OR v.phrase_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN p.image_filename IS NOT NULL OR json_extract(v.config_extra, '$.imageId') IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN p.video_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN v.style IS NOT NULL OR v.font IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END
    ) AS recipe_blocks,
    CASE
      WHEN (
        CASE WHEN p.phrase_id IS NOT NULL OR v.phrase_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN p.image_filename IS NOT NULL OR json_extract(v.config_extra, '$.imageId') IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN p.video_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN v.style IS NOT NULL OR v.font IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END
      ) = 4 THEN 'full'
      WHEN (
        CASE WHEN p.phrase_id IS NOT NULL OR v.phrase_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN p.image_filename IS NOT NULL OR json_extract(v.config_extra, '$.imageId') IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN p.video_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN v.style IS NOT NULL OR v.font IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END
      ) > 0 THEN 'partial'
      ELSE 'none'
    END AS recipe_status
  FROM publications p
  LEFT JOIN videos v ON v.id = p.video_id
`)

export default db
