import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { config } from '../config'
import { getAllAudioMeta, upsertAudioMeta } from '../services/audioMetadata'
import { analyzeAudioStructured, MOOD_CATEGORIES, TEXTURE_CATEGORIES } from '../services/geminiService'
import { pickAudioForPhrase } from '../services/audioMatching'
import { duracionSegunAudio } from '../utils/duracionReel'
import { harvestFromUrl, confirmarProcedencia } from '../services/audioHarvest'
import { getSourcesByTrack, deleteSource, AudioSource } from '../services/audioSources'

const router = Router()

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'])

export interface AudioTrack {
  filename: string  // nombre del archivo (ej. "cinematic-hopeful.mp3")
  name: string      // nombre legible sin extensión (ej. "cinematic hopeful")
  energia?: number | null
  moodCategory?: string | null
  textura?: string | null
  descripcion?: string | null
  analyzed?: boolean
  /** Reels del nicho de los que salió este corte (varios comparten tema). */
  sources?: TrackSource[]
  /**
   * Corte al que se fusionó este por ser el mismo tema. Sin este dato, un duplicado
   * fusionado y una pista que nunca se cosechó se ven exactamente igual —los dos
   * sin procedencia— y el panel no puede explicar por qué está fuera del pool.
   */
  mergedInto?: string | null
  /** true = tiene alguna frase de origen vectorizada, o sea que puede sonar. */
  enPool?: boolean
}

export interface TrackSource {
  sourceUrl: string
  sourcePhrase: string | null
  audioTitle: string | null
  audioArtist: string | null
  startMs: number | null
  /** true = frase confirmada y vectorizada. */
  confirmada: boolean
}

/** Lista los archivos de audio que hay EN DISCO (ordenados). */
function listAudioFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Qué pistas existen: la BASE manda, el disco solo añade.
 *
 * Listar por `readdirSync` a secas funcionaba mientras el banco vivía en la
 * carpeta local. Desde la Fase 1 vive en R2 y `mediaStore` baja los ficheros solo
 * cuando hacen falta, así que en la VM el directorio está VACÍO y el panel salía
 * sin una sola pista — con 68 filas en `audio_tracks`. Es la misma corrección que
 * la Fase 1 hizo para imágenes, que no llegó a audio.
 *
 * Se UNEN las dos fuentes en vez de sustituir una por otra: la base es la verdad,
 * pero un fichero recién dejado en `data/audio` y todavía sin registrar sigue
 * viéndose en local. Quitar eso convertiría "aún no está en la base" en
 * "no existe", que es justo el fallo silencioso que se quiere evitar.
 */
function nombresDePistas(dir: string, enBase: Iterable<string>): string[] {
  const nombres = new Set<string>(enBase)
  for (const f of listAudioFiles(dir)) nombres.add(f)
  return [...nombres].sort((a, b) => a.localeCompare(b))
}

// GET /api/audio — lista las pistas con su metadata (energía/mood si ya se analizó)
router.get('/', async (_req, res) => {
  const dir = path.resolve(config.paths.audio)
  const meta = await getAllAudioMeta()
  const fuentes = await getSourcesByTrack()
  const tracks: AudioTrack[] = nombresDePistas(dir, meta.keys()).map((filename) => {
    const m = meta.get(filename)
    const src = fuentes.get(filename) ?? []
    return {
      filename,
      name: path.basename(filename, path.extname(filename)).replace(/[-_]/g, ' '),
      energia: m?.energia ?? null,
      moodCategory: m?.moodCategory ?? null,
      textura: m?.textura ?? null,
      descripcion: m?.descripcion ?? null,
      // Sin textura la pista suena igual pero deja de rotar: cuenta como pendiente.
      analyzed: !!(m && m.energia !== null && m.moodCategory && m.textura),
      mergedInto: m?.mergedInto ?? null,
      sources: src.map((f: AudioSource) => ({
        sourceUrl: f.sourceUrl,
        sourcePhrase: f.sourcePhrase,
        audioTitle: f.audioTitle,
        audioArtist: f.audioArtist,
        startMs: f.startMs,
        confirmada: f.sourceEmbedding !== null,
      })),
      // Lo que decide si suena o no desde el 18-ago. Las etiquetas de energía/mood
      // ya no puntúan: sin ninguna procedencia confirmada la pista queda fuera.
      enPool: src.some((f: AudioSource) => f.sourceEmbedding !== null),
    }
  })
  res.json(tracks)
})

// GET /api/audio/pick?phraseId=X — pista que elegiría el auto-pick para esa frase.
// Sirve para PREVISUALIZAR el "Auto (por mood)" antes de generar y poder verificar.
router.get('/pick', async (req, res) => {
  const phraseId = String(req.query.phraseId || '')
  if (!phraseId) return res.status(400).json({ error: 'phraseId requerido' })
  const pick = await pickAudioForPhrase(phraseId)
  if (!pick) return res.json({ pick: null })
  res.json({
    pick: {
      filename: pick.filename,
      name: path.basename(pick.filename, path.extname(pick.filename)).replace(/[-_]/g, ' '),
      moodCategory: pick.moodCategory,
      textura: pick.textura,
      energia: pick.energia,
      score: pick.score,
      sourcePhrase: pick.sourcePhrase,
      sourceUrl: pick.sourceUrl,
      audioTitle: pick.audioTitle,
      audioArtist: pick.audioArtist,
      reelsDelNicho: pick.reelsDelNicho,
      duracionSeg: pick.duracionSeg,
      // Lo que va a durar el reel si se genera con esta pista: desde el 18-ago la
      // marca el corte, así que el preview debe poder enseñarlo antes de generar.
      duracionReel: duracionSegunAudio(pick.duracionSeg, 10),
    },
  })
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
  const meta = await getAllAudioMeta()
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

// POST /api/audio/harvest  { url }  → baja el corte del reel y PROPONE su frase
// de origen (leída de los fotogramas). NO la persiste: David la confirma con
// PUT /:filename/source. Mismo circuito que el tagging, y aquí importa más — una
// frase de origen equivocada empareja mal para siempre y sin avisar.
router.post('/harvest', async (req, res) => {
  const url = String(req.body?.url || '').trim()
  if (!url) return res.status(400).json({ error: 'url requerida' })
  try {
    res.json(await harvestFromUrl(url))
  } catch (e: any) {
    const msg = String(e.message || e)
    // El fallo típico no es un bug: es Instagram pidiendo sesión. Se traduce para
    // que David sepa que la salida es configurar YTDLP_COOKIES_FROM_BROWSER.
    const login = /login|rate-?limit|not available|cookies|restricted/i.test(msg)
    res.status(login ? 401 : 500).json({
      error: login
        ? `Instagram pidió sesión para ese reel. Configura YTDLP_COOKIES_FROM_BROWSER=chrome (o firefox/edge) en el .env y reinicia. Detalle: ${msg.slice(0, 300)}`
        : msg.slice(0, 500),
    })
  }
})

// POST /api/audio/harvest-batch  { urls: string[] }  → cosecha una tanda.
//
// En SERIE a propósito: son peticiones a Instagram desde la IP de casa de David y
// lanzarlas en paralelo es como se llega antes al bloqueo. A ~17 s por reel, una
// tanda de 50 tarda unos 15 min, así que el cliente necesita un timeout largo.
router.post('/harvest-batch', async (req, res) => {
  const urls: string[] = Array.isArray(req.body?.urls)
    ? req.body.urls.map((u: any) => String(u).trim()).filter(Boolean)
    : []
  if (urls.length === 0) return res.status(400).json({ error: 'urls requeridas' })

  const results: any[] = []
  const errors: string[] = []
  for (const url of urls) {
    try {
      results.push(await harvestFromUrl(url))
    } catch (e: any) {
      errors.push(`${url}: ${String(e.message).slice(0, 200)}`)
    }
  }
  res.json({ results, errors })
})

// PUT /api/audio/source  { sourceUrl, sourcePhrase } — confirma la frase de origen
// de UN reel y la vectoriza. Es lo que mete esa procedencia en el pool.
//
// La clave es la URL del reel y no el filename porque una misma pista tiene varias
// procedencias: cinco reels del nicho pueden compartir tema y cada uno lleva su
// propia frase.
router.put('/source', async (req, res) => {
  const sourceUrl = String(req.body?.sourceUrl || '').trim()
  const sourcePhrase = String(req.body?.sourcePhrase || '').trim()
  if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl requerida' })
  if (!sourcePhrase) return res.status(400).json({ error: 'sourcePhrase requerida' })
  try {
    await confirmarProcedencia(sourceUrl, sourcePhrase)
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/audio/source?url=… — quita una procedencia mal cosechada. No borra el
// archivo de audio: puede estar sosteniendo las procedencias de otros reels.
router.delete('/source', async (req, res) => {
  const url = String(req.query.url || '').trim()
  if (!url) return res.status(400).json({ error: 'url requerida' })
  res.json({ success: await deleteSource(url) })
})

// PUT /api/audio/:filename/tags  { energia, moodCategory, textura?, descripcion } — confirma/edita
router.put('/:filename/tags', async (req, res) => {
  const safe = path.basename(req.params.filename)
  const energia = Math.max(0, Math.min(10, Math.round(Number(req.body?.energia))))
  const moodCategory = String(req.body?.moodCategory || '')
  const descripcion = String(req.body?.descripcion || '')
  const textura = req.body?.textura ? String(req.body.textura) : undefined
  if (!Number.isFinite(energia)) return res.status(400).json({ error: 'energia inválida' })
  if (!MOOD_CATEGORIES.includes(moodCategory as any)) {
    return res.status(400).json({ error: `moodCategory debe ser uno de: ${MOOD_CATEGORIES.join(', ')}` })
  }
  if (textura && !TEXTURE_CATEGORIES.includes(textura as any)) {
    return res.status(400).json({ error: `textura debe ser una de: ${TEXTURE_CATEGORIES.join(', ')}` })
  }
  await upsertAudioMeta(safe, energia, moodCategory, descripcion, textura)
  res.json({ success: true })
})

export default router
