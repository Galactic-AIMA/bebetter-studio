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

// GET /api/audio/file/:filename — sirve una pista de audio (para preview en el UI)
router.get('/file/:filename', (req, res) => {
  const safe = path.basename(req.params.filename) // evita path traversal (../)
  if (!AUDIO_EXTENSIONS.has(path.extname(safe).toLowerCase())) {
    return res.status(400).json({ error: 'Extensión de audio no permitida' })
  }
  const filePath = path.join(path.resolve(config.paths.audio), safe)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Pista no encontrada' })
  res.sendFile(filePath)
})

export default router
