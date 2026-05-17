import fs from 'fs'
import path from 'path'
import db from '../db'

const DATA = path.join(__dirname, '../../../data')

// ── 1. phrases.json + phrases-metadata.json ──────────────────────────────────

const phrasesPath = path.join(DATA, 'phrases.json')
const metaPath    = path.join(DATA, 'phrases-metadata.json')

if (fs.existsSync(phrasesPath)) {
  const phrases: any[] = JSON.parse(fs.readFileSync(phrasesPath, 'utf-8'))
  const meta: Record<string, any> = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    : {}

  const insert = db.prepare(`
    INSERT OR IGNORE INTO phrases
      (id, text, category, author, usage_count, mood_keywords, analyzed_at, sort_order)
    VALUES
      (@id, @text, @category, @author, @usage_count, @mood_keywords, @analyzed_at, @sort_order)
  `)

  db.transaction((rows: any[]) => {
    rows.forEach((p, idx) => {
      const m = meta[p.id]
      insert.run({
        id:            p.id,
        text:          p.text,
        category:      p.category ?? null,
        author:        p.author ?? null,
        usage_count:   p.usageCount ?? 0,
        mood_keywords: m?.keywords?.length ? JSON.stringify(m.keywords) : null,
        analyzed_at:   m?.analyzedAt ?? null,
        sort_order:    idx,
      })
    })
  })(phrases)

  console.log(`Phrases: ${phrases.length} registros migrados`)
} else {
  console.log('phrases.json no encontrado, saltando')
}

// ── 2. images-metadata.json + images-usage.json ──────────────────────────────

const imgMetaPath  = path.join(DATA, 'images-metadata.json')
const imgUsagePath = path.join(DATA, 'images-usage.json')

const imgMeta: Record<string, any> = fs.existsSync(imgMetaPath)
  ? JSON.parse(fs.readFileSync(imgMetaPath, 'utf-8'))
  : {}
const imgUsage: Record<string, number> = fs.existsSync(imgUsagePath)
  ? JSON.parse(fs.readFileSync(imgUsagePath, 'utf-8'))
  : {}

const allFilenames = new Set([...Object.keys(imgMeta), ...Object.keys(imgUsage)])

if (allFilenames.size > 0) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO images (filename, tags, analyzed_at, usage_count)
    VALUES (@filename, @tags, @analyzed_at, @usage_count)
  `)

  db.transaction((filenames: string[]) => {
    filenames.forEach((filename) => {
      const m = imgMeta[filename]
      insert.run({
        filename,
        tags:        m?.tags?.length ? JSON.stringify(m.tags) : null,
        analyzed_at: m?.analyzedAt ?? null,
        usage_count: imgUsage[filename] ?? 0,
      })
    })
  })([...allFilenames])

  console.log(`Images: ${allFilenames.size} registros migrados`)
} else {
  console.log('Sin metadata de imágenes, saltando')
}

// ── 3. videos.json ────────────────────────────────────────────────────────────

const videosPath = path.join(DATA, 'videos.json')

if (fs.existsSync(videosPath)) {
  const videos: any[] = JSON.parse(fs.readFileSync(videosPath, 'utf-8'))

  if (videos.length > 0) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO videos
        (id, filename, title, description, tags, local_path, public_url,
         s3_url, drive_url, phrase_id, viral, font, resolution,
         effect, config_extra, created_at)
      VALUES
        (@id, @filename, @title, @description, @tags, @local_path, @public_url,
         @s3_url, @drive_url, @phrase_id, @viral, @font, @resolution,
         @effect, @config_extra, @created_at)
    `)

    db.transaction((rows: any[]) => {
      rows.forEach((v) => {
        const c = v.config ?? {}
        insert.run({
          id:           v.id,
          filename:     v.filename,
          title:        v.title ?? null,
          description:  v.description ?? null,
          tags:         v.tags?.length ? JSON.stringify(v.tags) : null,
          local_path:   v.localPath ?? null,
          public_url:   v.publicUrl ?? null,
          s3_url:       v.s3Url ?? null,
          drive_url:    v.driveUrl ?? null,
          phrase_id:    v.phraseId ?? null,
          viral:        v.viral ? 1 : 0,
          font:         c.text?.font ?? null,
          resolution:   c.resolution ? `${c.resolution.width}x${c.resolution.height}` : null,
          effect:       c.textEffect ?? null,
          config_extra: JSON.stringify(c),
          created_at:   v.createdAt ?? new Date().toISOString(),
        })
      })
    })(videos)

    console.log(`Videos: ${videos.length} registros migrados`)
  } else {
    console.log('Videos: historial vacío, saltando')
  }
} else {
  console.log('videos.json no encontrado, saltando')
}

// ── 4. images-output.json ────────────────────────────────────────────────────

const imagesOutputPath = path.join(DATA, 'images-output.json')

if (fs.existsSync(imagesOutputPath)) {
  const records: any[] = JSON.parse(fs.readFileSync(imagesOutputPath, 'utf-8'))

  if (records.length > 0) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO images_output
        (id, filename, local_path, public_url, drive_url, phrase_id,
         variant, viral, font, resolution, config_extra, created_at)
      VALUES
        (@id, @filename, @local_path, @public_url, @drive_url, @phrase_id,
         @variant, @viral, @font, @resolution, @config_extra, @created_at)
    `)

    db.transaction((rows: any[]) => {
      rows.forEach((r) => {
        const c = r.config ?? {}
        insert.run({
          id:           r.id,
          filename:     r.filename,
          local_path:   r.localPath ?? null,
          public_url:   r.publicUrl ?? null,
          drive_url:    r.driveUrl ?? null,
          phrase_id:    r.phraseId ?? null,
          variant:      r.variant ?? 'combined',
          viral:        r.viral ? 1 : 0,
          font:         c.text?.font ?? null,
          resolution:   c.resolution ? `${c.resolution.width}x${c.resolution.height}` : null,
          config_extra: JSON.stringify(c),
          created_at:   r.createdAt ?? new Date().toISOString(),
        })
      })
    })(records)

    console.log(`Images output: ${records.length} registros migrados`)
  } else {
    console.log('Images output: historial vacío, saltando')
  }
} else {
  console.log('images-output.json no encontrado, saltando')
}

// ── 5. pinterest-sync.json ───────────────────────────────────────────────────

const pinterestPath = path.join(DATA, 'pinterest-sync.json')

if (fs.existsSync(pinterestPath)) {
  const data: any = JSON.parse(fs.readFileSync(pinterestPath, 'utf-8'))
  const pinIds: string[] = data.downloadedPinIds ?? []

  const insertPin = db.prepare(`INSERT OR IGNORE INTO pinterest_pins (pin_id) VALUES (@pin_id)`)
  const insertLog = db.prepare(`
    INSERT INTO pinterest_sync_log (timestamp, new_images, total_checked, status, error)
    VALUES (@timestamp, @new_images, @total_checked, @status, @error)
  `)

  db.transaction(() => {
    pinIds.forEach((pin_id) => insertPin.run({ pin_id }))
    if (data.lastSync) {
      const s = data.lastSync
      insertLog.run({
        timestamp:     s.timestamp,
        new_images:    s.newImages ?? 0,
        total_checked: s.totalChecked ?? 0,
        status:        s.status ?? 'success',
        error:         s.error ?? null,
      })
    }
  })()

  console.log(`Pinterest: ${pinIds.length} pin IDs + lastSync migrados`)
} else {
  console.log('pinterest-sync.json no encontrado, saltando')
}

console.log('\n✓ Migración completada.')
