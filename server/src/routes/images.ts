import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import { ImageItem } from '../types'
import db from '../db'
import { urlPublica, CLAVE_IMAGENES } from '../services/mediaStore'

const router = Router()

const SUPPORTED = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif']

// .jfif y otros no están en la base MIME por defecto de Express
const MIME_OVERRIDES: Record<string, string> = {
  '.jfif': 'image/jpeg',
  '.tif':  'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
}

/**
 * GET /api/images — listar el banco.
 *
 * La fuente de verdad es la BASE, no el disco (Fase 1, 2026-08-18). Antes esto era
 * un `readdirSync`, y eso ataba el listado a que el banco estuviera montado en la
 * máquina que sirve la app — justo lo que la migración a la nube viene a romper.
 * El cambio es seguro porque la correspondencia es exacta: 263 archivos, 263 filas,
 * cero huérfanos por ninguno de los dos lados (verificado antes de tocarlo).
 *
 * `path` se sigue devolviendo porque el editor lo reenvía tal cual al generar, pero
 * ya es solo una PISTA: quien resuelve de verdad es `mediaStore`, por nombre.
 */
router.get('/', async (_req, res) => {
  try {
    const rows = (await db.prepare(
      `SELECT filename, tags, analyzed_at, usage_count, origen FROM images ORDER BY filename`
    ).all()) as any[]

    const dir = path.resolve(config.paths.images)
    const images: ImageItem[] = rows
      .filter((r) => SUPPORTED.includes(path.extname(r.filename).toLowerCase()))
      .map((r) => ({
        id: r.filename,
        filename: r.filename,
        path: path.join(dir, r.filename),
        url: `/api/images/file/${encodeURIComponent(r.filename)}`,
        usageCount: r.usage_count ?? 0,
        tags: r.tags ? JSON.parse(r.tags) : undefined,
        analyzedAt: r.analyzed_at ?? undefined,
        origen: r.origen ?? undefined,
      }))

    res.json(images)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/images/random — imagen aleatoria (también desde la base)
router.get('/random', async (_req, res) => {
  try {
    // Preferir las ya analizadas: sin `tags` el matching de frases no puede opinar
    // sobre ellas, así que entrarían al azar de verdad.
    const analizadas = (await db.prepare(
      `SELECT filename, tags, analyzed_at FROM images WHERE tags IS NOT NULL AND tags != '[]'`
    ).all()) as any[]
    const todas = analizadas.length > 0
      ? analizadas
      : ((await db.prepare(`SELECT filename, tags, analyzed_at FROM images`).all()) as any[])
    if (todas.length === 0) return res.status(404).json({ error: 'No images found' })

    const row = todas[Math.floor(Math.random() * todas.length)]
    res.json({
      id: row.filename,
      filename: row.filename,
      path: path.join(path.resolve(config.paths.images), row.filename),
      url: `/api/images/file/${encodeURIComponent(row.filename)}`,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      analyzedAt: row.analyzed_at ?? undefined,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/images/file/:filename — servir una imagen.
 *
 * Si el banco está en disco (la máquina de David) se sirve desde ahí. Si no,
 * REDIRIGE a la URL pública de R2 en vez de hacer de proxy: el bucket ya es
 * público, así que descargar 1 MB al servidor para reenviarlo sería pagar tráfico y
 * latencia por nada, y el navegador se queda la imagen cacheada un año.
 */
router.get('/file/:filename', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename))
  if (!SUPPORTED.includes(path.extname(filename).toLowerCase())) return res.status(400).end()

  const filepath = path.join(path.resolve(config.paths.images), filename)
  if (fs.existsSync(filepath)) {
    const mime = MIME_OVERRIDES[path.extname(filename).toLowerCase()]
    if (mime) res.setHeader('Content-Type', mime)
    return res.sendFile(filepath)
  }

  if (config.aws.publicUrl) return res.redirect(302, urlPublica(CLAVE_IMAGENES, filename))
  res.status(404).end()
})

export default router
