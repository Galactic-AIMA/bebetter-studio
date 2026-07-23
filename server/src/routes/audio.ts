import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { config } from '../config'

const router = Router()

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'])

export interface AudioTrack {
  filename: string  // nombre del archivo (ej. "cinematic-hopeful.mp3")
  name: string      // nombre legible sin extensión (ej. "cinematic hopeful")
}

// GET /api/audio — lista las pistas de audio disponibles en data/audio
router.get('/', (_req, res) => {
  const dir = path.resolve(config.paths.audio)
  if (!fs.existsSync(dir)) return res.json([])

  const tracks: AudioTrack[] = fs
    .readdirSync(dir)
    .filter((f) => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => ({
      filename,
      name: path.basename(filename, path.extname(filename)).replace(/[-_]/g, ' '),
    }))

  res.json(tracks)
})

export default router
