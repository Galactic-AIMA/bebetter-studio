import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import { analyzeImage } from './geminiService'
import db from '../db'

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

      if (downloaded > 0) analyzeNewImages()

      resolve({ newImages: downloaded, totalChecked, status: 'success' })
    })
  })
}

function analyzeNewImages() {
  const dir = config.paths.images
  if (!fs.existsSync(dir)) return

  const analyzedSet = new Set(
    (db.prepare(`SELECT filename FROM images WHERE tags IS NOT NULL AND tags != '[]'`).all() as any[])
      .map((r: any) => r.filename)
  )

  const unanalyzed = fs.readdirSync(dir).filter(
    (f) => SUPPORTED.includes(path.extname(f).toLowerCase()) && !analyzedSet.has(f)
  )

  ;(async () => {
    for (const filename of unanalyzed) {
      try {
        const tags = await analyzeImage(path.join(dir, filename))
        db.prepare(`
          INSERT INTO images (filename, tags, analyzed_at)
          VALUES (@filename, @tags, @analyzed_at)
          ON CONFLICT(filename) DO UPDATE SET tags = @tags, analyzed_at = @analyzed_at
        `).run({ filename, tags: JSON.stringify(tags), analyzed_at: new Date().toISOString() })
        await new Promise((r) => setTimeout(r, 6000))
      } catch { /* silencioso */ }
    }
  })()
}
