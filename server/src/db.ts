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
]) {
  try { db.exec(sql) } catch (_) { /* columna ya existe */ }
}

export default db
