/**
 * Esquema de Postgres — Fase 2 (2026-08-19).
 *
 * Traducción del esquema de SQLite (11 tablas, 1 vista, 4 índices). El criterio de
 * toda esta migración es **mismo comportamiento, otro motor**: se cambia lo que
 * obliga el dialecto y nada más, para que si algo falla se sepa que fue el motor.
 *
 * Traducciones y por qué:
 *
 *   BLOB → BYTEA        los embeddings. `pg` los devuelve como Buffer, igual que
 *                       `better-sqlite3`, así que el código que los lee no cambia.
 *   REAL → DOUBLE PRECISION
 *   INTEGER PRIMARY KEY (autoincremental) → GENERATED ALWAYS AS IDENTITY
 *   datetime('now') → to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
 *
 * ⚠️ **Las fechas siguen siendo TEXT, a propósito.** Lo natural en Postgres sería
 * `timestamptz`, pero el cambio no sería inocente: la app escribe ISO de JavaScript
 * (`2026-08-19T10:00:00.000Z`) en unos sitios y el formato de SQLite
 * (`2026-08-19 10:00:00`) en otros, y compara y ordena esas columnas como CADENAS en
 * decenas de consultas. Convertirlas aquí mezclaría dos cambios y rompería
 * comparaciones lejos de donde se vería. Normalizar a `timestamptz` es una limpieza
 * posterior y con su propia verificación.
 *
 * ⚠️ Los booleanos siguen siendo INTEGER (`archived`, `viral`) por lo mismo: la app
 * consulta `archived = 0` y guarda 1/0. Un BOOLEAN de verdad rompería esas
 * comparaciones sin avisar.
 */

export const ESQUEMA_PG = `
CREATE TABLE IF NOT EXISTS phrases (
  id               TEXT PRIMARY KEY,
  text             TEXT NOT NULL,
  category         TEXT,
  author           TEXT,
  usage_count      INTEGER DEFAULT 0,
  mood_keywords    TEXT,
  analyzed_at      TEXT,
  sort_order       INTEGER,
  created_at       TEXT DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  descripcion_mood TEXT,
  embedding        BYTEA,
  -- DOUBLE y no INTEGER, aunque en SQLite estuviera declarada INTEGER: el tipado
  -- laxo de SQLite dejó entrar decimales y hay 22 frases con 2,5 · 3,5 · 6,8…
  -- Redondearlas al migrar cambiaría en silencio la energía de 22 frases, y el
  -- decimal SÍ se usa (el re-rank de imágenes calcula |a-b|/10 y los rangos de la
  -- analítica agrupan bien). Postgres es estricto, así que aquí se declara lo que
  -- la columna era de verdad.
  nivel_energia    DOUBLE PRECISION,
  paleta           TEXT,
  mood_category    TEXT,
  archived         INTEGER NOT NULL DEFAULT 0,
  estructura       TEXT,
  persona          TEXT,
  embedding_texto  BYTEA
);

CREATE TABLE IF NOT EXISTS images (
  filename      TEXT PRIMARY KEY,
  tags          TEXT,
  analyzed_at   TEXT,
  usage_count   INTEGER DEFAULT 0,
  analysis_json TEXT,
  embedding     BYTEA,
  origen        TEXT,
  modelo        TEXT
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
  created_at   TEXT DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  estado       TEXT,
  queue_id     TEXT
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
  created_at   TEXT DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS pinterest_pins (
  pin_id        TEXT PRIMARY KEY,
  downloaded_at TEXT DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS pinterest_sync_log (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp     TEXT,
  new_images    INTEGER,
  total_checked INTEGER,
  status        TEXT,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS audio_tracks (
  filename      TEXT PRIMARY KEY,
  energia       INTEGER,
  mood_category TEXT,
  descripcion   TEXT,
  usage_count   INTEGER DEFAULT 0,
  analyzed_at   TEXT,
  textura       TEXT,
  offset_seg    DOUBLE PRECISION,
  merged_into   TEXT,
  duracion_seg  DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS audio_sources (
  source_url       TEXT PRIMARY KEY,
  filename         TEXT NOT NULL,
  source_phrase    TEXT,
  source_embedding BYTEA,
  audio_asset_id   TEXT,
  audio_title      TEXT,
  audio_artist     TEXT,
  start_ms         INTEGER,
  harvested_at     TEXT DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS carousels (
  id            TEXT PRIMARY KEY,
  tema          TEXT NOT NULL,
  tipo          TEXT,
  aspect        TEXT,
  slides_json   TEXT,
  cover_kie_url TEXT,
  status        TEXT DEFAULT 'draft',
  created_at    TEXT DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  fuente_json   TEXT
);

CREATE TABLE IF NOT EXISTS publications (
  media_id          TEXT PRIMARY KEY,
  platform          TEXT NOT NULL DEFAULT 'instagram',
  permalink         TEXT,
  media_type        TEXT,
  published_at      TEXT NOT NULL,
  video_id          TEXT,
  carousel_id       TEXT,
  queue_id          TEXT,
  caption           TEXT,
  match_source      TEXT,
  created_at        TEXT DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  phrase_id         TEXT,
  image_filename    TEXT,
  image_match_score DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS media_insights (
  media_id     TEXT NOT NULL,
  captured_at  TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (media_id, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_publications_video    ON publications(video_id);
CREATE INDEX IF NOT EXISTS idx_publications_carousel ON publications(carousel_id);
CREATE INDEX IF NOT EXISTS idx_audio_sources_file    ON audio_sources(filename);
CREATE INDEX IF NOT EXISTS idx_audio_sources_asset   ON audio_sources(audio_asset_id);
`

/**
 * La vista de cobertura de receta.
 *
 * Es lo ÚNICO que cambia de verdad respecto a SQLite, y por un solo motivo:
 * `json_extract(x, '$.imageId')` no existe en Postgres. Aquí se escribe con el
 * operador nativo, y con una guarda que SQLite no necesitaba —
 * `json_extract` devuelve NULL ante un JSON roto, mientras que `::json` en Postgres
 * LANZA. Un `config_extra` mal formado tumbaría la analítica entera, así que se
 * comprueba antes con un LIKE barato en vez de arriesgarse.
 */
export const VISTA_PG = `
DROP VIEW IF EXISTS v_publication_recipe;
CREATE VIEW v_publication_recipe AS
SELECT
  p.*,
  COALESCE(
    p.image_filename,
    CASE WHEN v.config_extra LIKE '{%' THEN v.config_extra::json ->> 'imageId' END
  ) AS imagen_archivo,
  CASE WHEN p.phrase_id IS NOT NULL OR v.phrase_id IS NOT NULL OR p.carousel_id IS NOT NULL
       THEN 1 ELSE 0 END AS has_phrase,
  CASE WHEN p.image_filename IS NOT NULL
            OR (v.config_extra LIKE '{%' AND v.config_extra::json ->> 'imageId' IS NOT NULL)
            OR p.carousel_id IS NOT NULL
       THEN 1 ELSE 0 END AS has_image,
  CASE WHEN p.video_id IS NOT NULL OR p.carousel_id IS NOT NULL
       THEN 1 ELSE 0 END AS has_audio,
  CASE WHEN v.style IS NOT NULL OR v.font IS NOT NULL OR p.carousel_id IS NOT NULL
       THEN 1 ELSE 0 END AS has_render,
  (
    CASE WHEN p.phrase_id IS NOT NULL OR v.phrase_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN p.image_filename IS NOT NULL
              OR (v.config_extra LIKE '{%' AND v.config_extra::json ->> 'imageId' IS NOT NULL)
              OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN p.video_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN v.style IS NOT NULL OR v.font IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END
  ) AS recipe_blocks,
  CASE
    WHEN (
      CASE WHEN p.phrase_id IS NOT NULL OR v.phrase_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN p.image_filename IS NOT NULL
                OR (v.config_extra LIKE '{%' AND v.config_extra::json ->> 'imageId' IS NOT NULL)
                OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN p.video_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN v.style IS NOT NULL OR v.font IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END
    ) = 4 THEN 'full'
    WHEN (
      CASE WHEN p.phrase_id IS NOT NULL OR v.phrase_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN p.image_filename IS NOT NULL
                OR (v.config_extra LIKE '{%' AND v.config_extra::json ->> 'imageId' IS NOT NULL)
                OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN p.video_id IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN v.style IS NOT NULL OR v.font IS NOT NULL OR p.carousel_id IS NOT NULL THEN 1 ELSE 0 END
    ) > 0 THEN 'partial'
    ELSE 'none'
  END AS recipe_status
FROM publications p
LEFT JOIN videos v ON v.id = p.video_id;
`
