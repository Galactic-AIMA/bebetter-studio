import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import { analyzeImage } from './geminiService'
import db from '../db'
import { subirMedia, existeEnR2, CLAVE_IMAGENES } from './mediaStore'

const ARCHIVE_PATH = path.join(__dirname, '../../../data/gallery-dl-archive.txt')
const SUPPORTED = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif']

export interface GalleryDlResult {
  newImages: number
  totalChecked: number
  status: 'success' | 'error'
  error?: string
}

export async function syncWithGalleryDl(): Promise<GalleryDlResult> {
  const { bin, boardUrl, limit } = config.galleryDl
  if (!boardUrl) throw new Error('PINTEREST_BOARD_URL no está configurada en .env')

  const args = [
    '--download-archive', ARCHIVE_PATH,
    '-D', config.paths.images,
    '--filename', '{filename}.{extension}',
  ]
  if (limit > 0) args.push('--range', `1-${limit}`)
  args.push(boardUrl)

  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        const msg = stderr?.trim() || err.message
        if (msg.includes('command not found') || msg.includes('is not recognized') || msg.includes('no se reconoce')) {
          return resolve({ newImages: 0, totalChecked: 0, status: 'error', error: `gallery-dl no encontrado en: ${bin}. Instala con: pip install gallery-dl` })
        }
        return resolve({ newImages: 0, totalChecked: 0, status: 'error', error: msg })
      }

      const lines = (stdout || '').split('\n')
      const downloaded = lines.filter((l) => l.startsWith('# ')).length
      const skipped = lines.filter((l) => l.includes('[skip]')).length
      const totalChecked = downloaded + skipped

      if (downloaded > 0) {
        analyzeNewImages()
        // Las imágenes recién bajadas de Pinterest también van a R2 (Fase 1), o el
        // render en la nube las elegiría sin poder abrirlas.
        subirNuevasAR2().catch(() => { /* best-effort; el script de subida las recoge */ })
      }

      resolve({ newImages: downloaded, totalChecked, status: 'success' })
    })
  })
}

/** Sube a R2 lo que haya en el banco local y no esté ya allí. */
async function subirNuevasAR2(): Promise<void> {
  const dir = config.paths.images
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) {
    if (!SUPPORTED.includes(path.extname(f).toLowerCase())) continue
    const local = path.join(dir, f)
    try {
      if (!(await existeEnR2(CLAVE_IMAGENES, f, fs.statSync(local).size))) {
        await subirMedia(CLAVE_IMAGENES, f, local)
      }
    } catch { /* la recoge `subir-banco-a-r2.ts` */ }
  }
}

async function analyzeNewImages() {
  const dir = config.paths.images
  if (!fs.existsSync(dir)) return

  const filas = (await db.prepare(`SELECT filename FROM images WHERE tags IS NOT NULL AND tags != '[]'`).all()) as any[]
  const analyzedSet = new Set(filas.map((r: any) => r.filename))

  const unanalyzed = fs.readdirSync(dir).filter(
    (f) => SUPPORTED.includes(path.extname(f).toLowerCase()) && !analyzedSet.has(f)
  )

  ;(async () => {
    for (const filename of unanalyzed) {
      try {
        const tags = await analyzeImage(path.join(dir, filename))
        await db.prepare(`
          INSERT INTO images (filename, tags, analyzed_at)
          VALUES (@filename, @tags, @analyzed_at)
          ON CONFLICT(filename) DO UPDATE SET tags = @tags, analyzed_at = @analyzed_at
        `).run({ filename, tags: JSON.stringify(tags), analyzed_at: new Date().toISOString() })
        await new Promise((r) => setTimeout(r, 6000))
      } catch { /* silencioso */ }
    }
  })()
}
