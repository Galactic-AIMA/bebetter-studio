import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import { analyzeImage } from './geminiService'

const ARCHIVE_PATH = path.join(__dirname, '../../../data/gallery-dl-archive.txt')
const METADATA_PATH = path.join(__dirname, '../../../data/images-metadata.json')
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

  const metadata: Record<string, { tags: string[]; analyzedAt: string }> = fs.existsSync(METADATA_PATH)
    ? (() => { try { return JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8')) } catch { return {} } })()
    : {}

  const unanalyzed = fs.readdirSync(dir).filter(
    (f) => SUPPORTED.includes(path.extname(f).toLowerCase()) && !metadata[f]?.tags?.length
  )

  ;(async () => {
    for (const filename of unanalyzed) {
      try {
        const tags = await analyzeImage(path.join(dir, filename))
        metadata[filename] = { tags, analyzedAt: new Date().toISOString() }
        fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2))
        await new Promise((r) => setTimeout(r, 6000))
      } catch { /* silencioso */ }
    }
  })()
}
