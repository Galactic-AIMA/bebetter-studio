import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { config } from '../config'
import { getAllAudioMeta, upsertAudioMeta } from '../services/audioMetadata'
import { analyzeAudioStructured, MOOD_CATEGORIES } from '../services/geminiService'

const router = Router()

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'])

export interface AudioTrack {
  filename: string  // nombre del archivo (ej. "cinematic-hopeful.mp3")
  name: string      // nombre legible sin extensión (ej. "cinematic hopeful")
  energia?: number | null
  moodCategory?: string | null
  descripcion?: string | null
  analyzed?: boolean
}

/** Lista los archivos de audio en data/audio (ordenados). */
function listAudioFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
}

// GET /api/audio — lista las pistas con su metadata (energía/mood si ya se analizó)
router.get('/', (_req, res) => {
  const dir = path.resolve(config.paths.audio)
  const meta = getAllAudioMeta()
  const tracks: AudioTrack[] = listAudioFiles(dir).map((filename) => {
    const m = meta.get(filename)
    return {
      filename,
      name: path.basename(filename, path.extname(filename)).replace(/[-_]/g, ' '),
      energia: m?.energia ?? null,
      moodCategory: m?.moodCategory ?? null,
      descripcion: m?.descripcion ?? null,
      analyzed: !!(m && m.energia !== null && m.moodCategory),
    }
  })
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

// Extrae ~40s de muestra (mp3 mono 64k) a un temporal para acotar tokens de
// Gemini. Si FFmpeg falla, cae a leer el archivo completo.
function sampleAudio(src: string): Promise<{ buffer: Buffer; ext: string }> {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `bb-audio-${Date.now()}.mp3`)
    execFile('ffmpeg', ['-y', '-t', '40', '-i', src, '-ac', '1', '-b:a', '64k', tmp], (err) => {
      if (err || !fs.existsSync(tmp)) {
        resolve({ buffer: fs.readFileSync(src), ext: path.extname(src) })
        return
      }
      const buffer = fs.readFileSync(tmp)
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      resolve({ buffer, ext: '.mp3' })
    })
  })
}

// POST /api/audio/analyze  { filenames?: string[] }  → propuestas (NO persiste;
// David las confirma con PUT /:filename/tags). Sin filenames, analiza las que
// aún no tienen mood.
router.post('/analyze', async (req, res) => {
  const dir = path.resolve(config.paths.audio)
  const all = listAudioFiles(dir)
  if (all.length === 0) return res.json({ proposals: [], errors: [] })
  const meta = getAllAudioMeta()
  const requested: string[] | undefined = Array.isArray(req.body?.filenames) ? req.body.filenames : undefined
  const targets = (requested ?? all).filter(
    (f) => all.includes(f) && (requested ? true : !meta.get(f)?.moodCategory)
  )

  const proposals: any[] = []
  const errors: string[] = []
  for (const filename of targets) {
    try {
      const { buffer, ext } = await sampleAudio(path.join(dir, filename))
      const a = await analyzeAudioStructured(buffer, ext)
      proposals.push({ filename, ...a })
      await new Promise((r) => setTimeout(r, 200))
    } catch (e: any) {
      errors.push(`${filename}: ${e.message}`)
    }
  }
  res.json({ proposals, errors })
})

// PUT /api/audio/:filename/tags  { energia, moodCategory, descripcion } — confirma/edita
router.put('/:filename/tags', (req, res) => {
  const safe = path.basename(req.params.filename)
  const energia = Math.max(0, Math.min(10, Math.round(Number(req.body?.energia))))
  const moodCategory = String(req.body?.moodCategory || '')
  const descripcion = String(req.body?.descripcion || '')
  if (!Number.isFinite(energia)) return res.status(400).json({ error: 'energia inválida' })
  if (!MOOD_CATEGORIES.includes(moodCategory as any)) {
    return res.status(400).json({ error: `moodCategory debe ser uno de: ${MOOD_CATEGORIES.join(', ')}` })
  }
  upsertAudioMeta(safe, energia, moodCategory, descripcion)
  res.json({ success: true })
})

export default router
