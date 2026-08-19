import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { config } from '../config'
import { embedText, readReelPhrase } from './geminiService'
import { filenameDeAsset, upsertSource, setSourcePhrase, getSource } from './audioSources'
import { setAudioDuracion } from './audioMetadata'

/**
 * Cosecha de audio CON PROCEDENCIA (2026-08-18).
 *
 * David pega la URL de un reel del nicho; esto baja el corte y —lo que de verdad
 * importa— guarda la frase que se leía en pantalla en ese reel.
 *
 * Por qué existe. El emparejamiento por `energia` se midió sobre 40 publicaciones
 * y no predice nada. Y el problema del "mejor tramo" no lo resuelve un algoritmo:
 * `mejorTramo()` encuentra el tramo MÁS FUERTE, que no es el tramo que la gente
 * usa. La salida es que el repositorio de tramos buenos ya lo tiene David: un reel
 * del nicho es un corte que ALGUIEN YA ELIGIÓ para este tipo de contenido. Es señal
 * de nicho, no musical, y ningún algoritmo la supera. De ahí que el corte se guarde
 * tal cual viene —sin `mejorTramo()`, sin `offset_seg`—: recortarlo destruiría justo
 * lo que lo hace valioso.
 *
 * Dos herramientas, cada una a lo suyo:
 *   `gallery-dl` para los METADATOS. Su extractor de Instagram expone el nombre de
 *     la canción, el artista, el id del audio y el segundo del tema por el que entra
 *     el reel. El de `yt-dlp` tira todos esos campos.
 *   `yt-dlp` para el VÍDEO, que es de donde salen el corte y los fotogramas con la
 *     frase.
 */

// Cuántos fotogramas se le pasan a Gemini para leer la frase. Tres, repartidos por
// el reel: el texto suele aparecer con retardo y cambiar a media pieza, así que uno
// solo cosecharía media frase. Más de tres no aporta y multiplica los tokens.
const FRAMES_OCR = 3

export interface HarvestResult {
  filename: string
  sourceUrl: string
  /** Lo que Gemini leyó en pantalla. Vacío = no encontró texto legible. */
  proposedPhrase: string
  durationSeg: number
  /** Nombre de la canción, si el reel usó la biblioteca de audio de Instagram. */
  audioTitle: string | null
  audioArtist: string | null
  /** Segundo del tema por el que entra este reel (ms). */
  startMs: number | null
  /** true = otro reel ya había traído este mismo tema; se reutiliza el archivo. */
  temaRepetido: boolean
  /** true = esta misma URL ya estaba cosechada. */
  yaEstaba: boolean
}

function run(bin: string, args: string[], timeoutMs = 3 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || '').trim() || err.message))
      resolve(stdout || '')
    })
  })
}

/**
 * Identificador estable del reel dentro de la URL (el "shortcode").
 *
 * Se usa para nombrar el archivo cuando no hay id de audio, y para que cosechar dos
 * veces el mismo reel no duplique nada: es el único dato de la URL que no cambia
 * entre variantes (con y sin `?igsh=`, con o sin `/reels/`, compartidas desde la
 * app móvil).
 */
export function shortcodeDe(url: string): string | null {
  const m = url.match(/\/(reels?|p|tv)\/([A-Za-z0-9_-]+)/)
  return m ? m[2] : null
}

/**
 * IPv4 forzado, y no es cosmético: es la diferencia entre 65 s y 5 s por reel.
 *
 * En esta máquina las direcciones IPv6 están en agujero negro y agotan el timeout
 * de TCP antes de caer a IPv4. `curl` no lo nota porque hace Happy Eyeballs (las
 * dos familias en paralelo), pero `socket.create_connection` de Python las prueba
 * UNA A UNA en orden — y tanto yt-dlp como gallery-dl son Python. Medido el
 * 2026-08-18 sobre el mismo reel: 65,4 s sin la bandera, 5,1 s con ella.
 */
const IPV4 = ['-4']

/**
 * Opciones de sesión. Instagram pide login para casi todo.
 *
 * Sirve para las dos herramientas: `yt-dlp 2026.07.04` y `gallery-dl 1.32.1`
 * aceptan las mismas dos banderas con la misma forma (verificado en su --help).
 */
function cookies(): string[] {
  const { cookiesFromBrowser, cookiesFile } = config.ytDlp
  if (cookiesFromBrowser) return ['--cookies-from-browser', cookiesFromBrowser]
  if (cookiesFile) return ['--cookies', cookiesFile]
  return []
}

export interface MetaReel {
  audioAssetId: string | null
  audioTitle: string | null
  audioArtist: string | null
  startMs: number | null
}

/**
 * Metadatos musicales del reel, vía `gallery-dl -j`.
 *
 * El 18-ago se dio por hecho que "en qué tramo del tema entra este reel" no lo daba
 * ninguna API — se descartaron Graph API, TikTok, Spotify y YouTube. Sí lo da, en el
 * payload del propio reel, y `gallery-dl` lo expone (`audio_*` en su extractor de
 * Instagram).
 *
 * Devuelve todo a null sin lanzar: esto es un extra. Si el reel llevaba el audio
 * incrustado en el MP4 —lo que hace el propio pipeline de bebetter desde el 23-jul—
 * Instagram lo etiqueta "Original audio" y aquí no hay nombre que sacar. La cosecha
 * tiene que seguir funcionando igual.
 */
export async function metadatosDelReel(url: string): Promise<MetaReel> {
  const vacio: MetaReel = { audioAssetId: null, audioTitle: null, audioArtist: null, startMs: null }
  try {
    const out = await run(config.galleryDl.bin, [...IPV4, ...cookies(), '-j', '--no-download', url], 90_000)
    // `-j` escupe una lista de pares [tipo, ...] por línea o un array entero; se
    // rastrean las claves `audio_*` allá donde estén en vez de asumir la forma.
    const encontrado: MetaReel = { ...vacio }
    const visitar = (n: any): void => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(visitar)
      if (n.audio_title && !encontrado.audioTitle) encontrado.audioTitle = String(n.audio_title)
      if (n.audio_artist && !encontrado.audioArtist) {
        encontrado.audioArtist = Array.isArray(n.audio_artist)
          ? n.audio_artist.filter(Boolean).join(', ') || null
          : String(n.audio_artist)
      }
      if (n.audio_timestamps && encontrado.startMs === null) {
        const ts = Array.isArray(n.audio_timestamps) ? n.audio_timestamps : [n.audio_timestamps]
        const primero = ts.find((x: any) => typeof x === 'number')
        if (typeof primero === 'number') encontrado.startMs = primero
      }
      // El id del audio es la clave de deduplicación: dos reels con el mismo tema
      // tienen URLs que no se parecen en nada.
      for (const k of ['audio_asset_id', 'audio_id']) {
        if (n[k] && !encontrado.audioAssetId) encontrado.audioAssetId = String(n[k])
      }
      Object.values(n).forEach(visitar)
    }
    for (const linea of out.split('\n')) {
      const t = linea.trim()
      if (!t.startsWith('[') && !t.startsWith('{')) continue
      try { visitar(JSON.parse(t)) } catch { /* línea no-JSON */ }
    }
    return encontrado
  } catch {
    return vacio
  }
}

/** Duración en segundos de un archivo multimedia (0 si ffprobe no la da). */
async function duracion(file: string): Promise<number> {
  try {
    const out = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ])
    return Math.round(parseFloat(out.trim()) * 100) / 100 || 0
  } catch {
    return 0
  }
}

/** Extrae `FRAMES_OCR` fotogramas repartidos por el vídeo, como JPEG en memoria. */
async function extraerFrames(video: string, dur: number, tmpDir: string): Promise<Buffer[]> {
  // Repartidos al 25/50/75%: el segundo 0 suele ser negro o la portada, y el final
  // a menudo es ya el cierre de marca.
  const puntos = Array.from({ length: FRAMES_OCR }, (_, i) => (dur * (i + 1)) / (FRAMES_OCR + 1))
  const frames: Buffer[] = []
  for (const [i, seg] of puntos.entries()) {
    const out = path.join(tmpDir, `frame-${i}.jpg`)
    try {
      // -ss ANTES de -i: busca sin decodificar lo anterior, igual que videoGenerator.
      await run('ffmpeg', ['-y', '-ss', seg.toFixed(2), '-i', video, '-frames:v', '1', '-q:v', '3', out])
      if (fs.existsSync(out)) frames.push(fs.readFileSync(out))
    } catch { /* un frame que falla no invalida la cosecha */ }
  }
  return frames
}

/**
 * Baja el reel, guarda su audio en el banco y PROPONE la frase de origen.
 *
 * No persiste la frase: la devuelve para que David la confirme
 * (`confirmarProcedencia`). Mismo circuito que el etiquetado de pistas, y aquí
 * importa más — una frase de origen equivocada empareja mal para siempre y sin
 * avisar de nada.
 *
 * Si otro reel ya trajo este mismo tema, NO se vuelve a bajar el audio: se reutiliza
 * el archivo y solo se añade la frase nueva. Varios reels del nicho compartiendo
 * tema es lo normal, y bajarlo N veces rompería la rotación —que compara por nombre
 * de archivo— haciendo sonar lo mismo dos veces seguidas.
 */
export async function harvestFromUrl(url: string): Promise<HarvestResult> {
  const limpia = url.trim()
  if (!/^https?:\/\//i.test(limpia)) throw new Error('La URL debe empezar por http:// o https://')

  const yaRegistrada = await getSource(limpia)
  const meta = await metadatosDelReel(limpia)

  // Deduplicación por TEMA, antes de tocar la red para el vídeo.
  const compartido = meta.audioAssetId ? await filenameDeAsset(meta.audioAssetId) : null
  const code = shortcodeDe(limpia)
  const filename = compartido
    ?? yaRegistrada?.filename
    ?? `${meta.audioAssetId ? `audio-${meta.audioAssetId}` : code ? `reel-${code}` : `reel-${Date.now()}`}.mp3`
  const destino = path.join(path.resolve(config.paths.audio), filename)
  const temaRepetido = !!compartido && compartido !== yaRegistrada?.filename

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-harvest-'))
  try {
    // Se baja el vídeo COMPLETO (no solo el audio) porque la frase de origen está en
    // los píxeles. Y se baja incluso si el tema ya estaba: cada reel aporta SU frase,
    // que es lo que se viene a buscar.
    await run(config.ytDlp.bin, [
      ...IPV4,
      ...cookies(),
      '--no-playlist',
      // Se pide la variante PEQUEÑA a propósito. El vídeo aquí no se publica: solo
      // se usa para sacar el audio (que va en su propia pista, intacta a cualquier
      // resolución) y tres fotogramas para leer la frase. Bajar los 1440x2560 que
      // sirve Instagram era el grueso de los 142 s que costaba cada reel, y a 720p
      // el texto en pantalla se lee igual de bien.
      '-S', 'res:720',
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '-o', path.join(tmpDir, 'media.%(ext)s'),
      limpia,
    ])

    const bajado = fs.readdirSync(tmpDir)
      .map((f) => path.join(tmpDir, f))
      .find((f) => /\.(mp4|mkv|webm|mov)$/i.test(f))
    if (!bajado) throw new Error('yt-dlp terminó sin dejar ningún vídeo')

    const dur = await duracion(bajado)

    // El corte se guarda TAL CUAL viene. Sin recortes ni `mejorTramo()`: lo que se
    // cosecha es precisamente la elección de tramo que ya hizo otro. Y solo si el
    // archivo no estaba ya (tema compartido con un reel cosechado antes).
    if (!fs.existsSync(destino)) {
      fs.mkdirSync(path.dirname(destino), { recursive: true })
      await run('ffmpeg', ['-y', '-i', bajado, '-vn', '-ac', '2', '-b:a', '192k', destino])
      if (!fs.existsSync(destino)) throw new Error('FFmpeg no pudo extraer el audio del reel')
    }

    // El audio ya está en el banco: que falle la lectura no tira la cosecha, deja la
    // procedencia pendiente de que David escriba la frase a mano.
    let proposedPhrase = yaRegistrada?.sourcePhrase ?? ''
    try {
      proposedPhrase = (await readReelPhrase(await extraerFrames(bajado, dur, tmpDir))) || proposedPhrase
    } catch { /* sin propuesta; se escribe a mano */ }

    // Procedencia a medias: URL, archivo y metadatos sí, frase todavía no. Sin frase
    // vectorizada esta fila NO puntúa en el emparejamiento.
    // La duración se guarda porque DECIDE la del reel (`utils/duracionReel.ts`), y
    // medirla con ffprobe en cada elección de audio costaría un proceso por pieza.
    if (dur > 0) await setAudioDuracion(filename, dur)

    await upsertSource({
      sourceUrl: limpia,
      filename,
      audioAssetId: meta.audioAssetId,
      audioTitle: meta.audioTitle,
      audioArtist: meta.audioArtist,
      startMs: meta.startMs,
      proposedPhrase,
    })

    return {
      filename,
      sourceUrl: limpia,
      proposedPhrase,
      durationSeg: dur,
      audioTitle: meta.audioTitle,
      audioArtist: meta.audioArtist,
      startMs: meta.startMs,
      temaRepetido,
      yaEstaba: !!yaRegistrada,
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* temporal */ }
  }
}

/**
 * Confirma la frase de origen de un reel cosechado y la vectoriza. Es lo que mete
 * esa procedencia en el pool: hasta aquí el corte estaba descargado pero mudo para
 * el matching.
 *
 * El embedding va sobre el TEXTO CRUDO con SEMANTIC_SIMILARITY — el mismo trato que
 * recibe `phrases.embedding_texto`, para que los dos lados del coseno sean
 * comparables. Ojo: NO es `phrases.embedding`, que vectoriza las metáforas visuales
 * de la frase y existe para buscar imagen de fondo.
 */
export async function confirmarProcedencia(sourceUrl: string, sourcePhrase: string): Promise<void> {
  const frase = sourcePhrase.trim()
  if (!frase) throw new Error('La frase de origen no puede estar vacía')
  const vec = await embedText(frase, 'SEMANTIC_SIMILARITY')
  await setSourcePhrase(sourceUrl.trim(), frase, vec)
}
