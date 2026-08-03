import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs'
import { VideoConfig, WatermarkPosition, TextEffect } from '../types'
import { config } from '../config'

function wmXExpr(position: WatermarkPosition, isText = false): string {
  if (position === 'left') return '20'
  if (position === 'center') return isText ? '(w-tw)/2' : '(W-w)/2'
  return isText ? 'w-tw-20' : 'W-w-20'
}

function wmYExpr(y: number): string {
  return `H*${(y / 100).toFixed(4)}`
}

export interface GenerateResult {
  filename: string
  localPath: string
  publicUrl: string
}

const WINDOWS_FONTS = 'C:/Windows/Fonts'

const FONT_FALLBACKS: Record<string, string> = {
  'Montserrat-Bold':          `${WINDOWS_FONTS}/arialbd.ttf`,
  'Montserrat-Regular':       `${WINDOWS_FONTS}/arial.ttf`,
  'PlayfairDisplay-Bold':     `${WINDOWS_FONTS}/georgiab.ttf`,
  'PlayfairDisplay-Regular':  `${WINDOWS_FONTS}/georgia.ttf`,
  'Lato-Regular':             `${WINDOWS_FONTS}/calibri.ttf`,
  'Lato-Bold':                `${WINDOWS_FONTS}/calibrib.ttf`,
  'Oswald-Bold':              `${WINDOWS_FONTS}/arialbd.ttf`,
  'RobotoCondensed-Bold':     `${WINDOWS_FONTS}/arialbd.ttf`,
}

// ---------------------------------------------------------------------------
// Degradado de carbón detrás del texto ("scrim")
//
// El hueso #E8E4DC pierde contraste sobre las imágenes claras del banco, así que
// se interpone un velo de carbón entre la imagen y el texto: opaco arriba y
// transparente hacia abajo. La geometría deriva de text.position.y para que el
// degradado acompañe al texto si se baja.
//
// Implementado con drawbox escalonado (t=fill) en vez de un PNG de gradiente
// como input extra: no añade inputs (el watermark de imagen ya usa
// complexFilter y un input más complicaría el grafo y el mapeo de audio),
// funciona igual en video y en imagen y es una simple cadena de filtros. Con 32
// bandas el salto de alpha es ~0.014, por debajo del umbral de banding visible
// sobre contenido fotográfico.
//
// Estos valores deben coincidir con client/src/lib/textScrim.ts (DEFAULT_SCRIM).
export interface ScrimConfig {
  color: string
  opacity: number
  /** Extensión del degradado por debajo del centro del texto, en % de altura. */
  spanBelowText: number
}

export const SCRIM: ScrimConfig = {
  color: process.env.SCRIM_COLOR ?? '#0A0A0A',
  opacity: Number(process.env.SCRIM_OPACITY ?? 0.45),
  spanBelowText: Number(process.env.SCRIM_SPAN_BELOW_TEXT ?? 25),
}

const SCRIM_BANDS = 32

export function buildScrimFilter(
  height: number,
  textPositionY: number,
  scrim: ScrimConfig = SCRIM
): string {
  if (!Number.isFinite(scrim.opacity) || scrim.opacity <= 0) return ''
  const endPct = Math.min(100, Math.max(1, textPositionY + scrim.spanBelowText))
  const endY = Math.round((endPct / 100) * height)
  if (endY <= 0) return ''

  const color = scrim.color.replace('#', '0x')
  const bandH = endY / SCRIM_BANDS
  const boxes: string[] = []
  for (let i = 0; i < SCRIM_BANDS; i++) {
    const alpha = scrim.opacity * (1 - (i + 0.5) / SCRIM_BANDS)
    if (alpha < 0.004) continue
    const y0 = Math.round(i * bandH)
    const y1 = Math.round((i + 1) * bandH)
    if (y1 <= y0) continue
    boxes.push(`drawbox=x=0:y=${y0}:w=iw:h=${y1 - y0}:color=${color}@${alpha.toFixed(4)}:t=fill`)
  }
  return boxes.join(',')
}
// ---------------------------------------------------------------------------

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55
}

function wrapText(text: string, fontSize: number, maxPx: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (estimateTextWidth(test, fontSize) > maxPx && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

function resolveFontPath(fontName: string): string {
  const customFont = path.join(config.paths.fonts, `${fontName}.ttf`)
  const resolved = fs.existsSync(customFont)
    ? customFont
    : (FONT_FALLBACKS[fontName] || `${WINDOWS_FONTS}/arial.ttf`)
  return resolved.replace(/\\/g, '/').replace(/^([A-Z]):/, '$1\\:')
}

function resolveItalicFontPath(fontName: string): string | null {
  const familyKey = fontName.split('-')[0]
  const italicKey = `${familyKey}-Italic`
  const customFont = path.join(config.paths.fonts, `${italicKey}.ttf`)
  if (fs.existsSync(customFont)) return customFont.replace(/\\/g, '/').replace(/^([A-Z]):/, '$1\\:')
  return null
}

// Resuelve la pista de audio de fondo dentro de data/audio. Devuelve null si
// no hay pista configurada o el archivo no existe (el video se genera sin audio).
function resolveAudioPath(audioTrack?: string): string | null {
  if (!audioTrack) return null
  const p = path.join(config.paths.audio, audioTrack)
  return fs.existsSync(p) ? p : null
}

const AUDIO_FADE = 1 // segundos de fade in/out del audio de fondo

// Cadena de filtros de audio: fade in/out + normalización de volumen (loudnorm).
// No hay ducking porque los videos no tienen voz — la música es el único audio.
function audioFilterChain(duration: number): string {
  const fadeOutStart = Math.max(0, duration - AUDIO_FADE)
  return [
    `afade=t=in:st=0:d=${AUDIO_FADE}`,
    `afade=t=out:st=${fadeOutStart}:d=${AUDIO_FADE}`,
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  ].join(',')
}

// Escapa el texto de una sola linea para el filtro drawtext
function escapeLine(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

// Retorna los parámetros FFmpeg adicionales para el efecto de texto
function effectOpts(effect: TextEffect, baseY: number): { yExpr: string; extraOpts: string } {
  switch (effect) {
    case 'fadeIn':
      return {
        yExpr: String(baseY),
        extraOpts: `:alpha='if(lt(t\\,1),t,1)'`,
      }
    case 'slideUp':
      return {
        yExpr: `'if(lt(t\\,0.8),${baseY}+60*(1-t/0.8),${baseY})'`,
        extraOpts: `:alpha='if(lt(t\\,0.8),t/0.8,1)'`,
      }
    case 'glowPulse':
      return {
        yExpr: String(baseY),
        extraOpts: `:borderw=6:bordercolor=white@'0.4+0.3*sin(6.28318*t)'`,
      }
    default:
      return { yExpr: String(baseY), extraOpts: '' }
  }
}

export async function generateVideo(
  cfg: VideoConfig,
  outputName: string
): Promise<GenerateResult> {
  const outputDir = path.join(path.resolve(config.paths.output), 'videos')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  const filename = `${outputName}.mp4`
  const outputPath = path.join(outputDir, filename)

  const { width, height } = cfg.resolution
  const { text, transition, transitionDuration, duration } = cfg
  const audioPath = resolveAudioPath(cfg.audioTrack)

  const maxW = Math.round((text.maxWidth / 100) * width)
  const centerY = Math.round((text.position.y / 100) * height)
  const fontPath = resolveFontPath(text.font)
  const lineH = Math.round(text.fontSize * text.lineHeight)

  // Usar las lineas pre-calculadas por el cliente (con canvas.measureText real).
  // Si no vienen, calcular con la estimacion local como fallback.
  const lines = (cfg.wrappedLines && cfg.wrappedLines.length > 0)
    ? cfg.wrappedLines
    : wrapText(text.content, text.fontSize, maxW)
  const totalH = lines.length * lineH
  const startY = Math.max(10, centerY - Math.round(totalH / 2))

  const xExpr = text.align === 'center'
    ? '(w-tw)/2'
    : text.align === 'right'
    ? `w-tw-${width - Math.round((text.position.x / 100) * width)}`
    : `${Math.round((text.position.x / 100) * width)}`

  const effect = cfg.textEffect ?? 'none'
  const shadowOpts = (text.shadow && effect !== 'glowPulse')
    ? ':shadowx=2:shadowy=2:shadowcolor=black@0.7'
    : ''
  const strokeOpts = (text.strokeWidth && text.strokeWidth > 0)
    ? `:borderw=${text.strokeWidth}:bordercolor=${(text.strokeColor ?? '#000000').replace('#', '0x')}`
    : ''

  // Las líneas vacías son el respiro entre bloques de tiempo: consumen su slot
  // vertical (el índice `i` sigue contando) pero no generan drawtext.
  const drawTextFilters = lines.flatMap((line, i) => {
    if (!line.trim()) return []
    const baseY = startY + i * lineH
    const { yExpr, extraOpts } = effectOpts(effect, baseY)
    return [
      `drawtext=text='${escapeLine(line)}':` +
      `fontfile='${fontPath}':` +
      `fontsize=${text.fontSize}:` +
      `fontcolor=${text.color}:` +
      `x=${xExpr}:y=${yExpr}` +
      shadowOpts +
      strokeOpts +
      extraOpts,
    ]
  })

  if (cfg.source) {
    const sourceLabel = `– ${cfg.source} –`
    const sourceFontSize = Math.round(text.fontSize * 0.55)
    const sourceY = startY + lines.length * lineH + sourceFontSize * 2
    const italicPath = resolveItalicFontPath(text.font) ?? fontPath
    const shadowSource = text.shadow ? ':shadowx=1:shadowy=1:shadowcolor=black@0.5' : ''
    drawTextFilters.push(
      `drawtext=text='${escapeLine(sourceLabel)}':` +
      `fontfile='${italicPath}':` +
      `fontsize=${sourceFontSize}:` +
      `fontcolor=${text.color}@0.8:` +
      `x=(w-tw)/2:y=${sourceY}` +
      shadowSource
    )
  }

  // Sin fade-desde-negro en la apertura: la imagen es visible desde el frame 0
  // para que la grilla de Shorts de YouTube (que toma un frame del video, no la
  // miniatura personalizada) no capture un frame negro. El texto puede seguir
  // entrando con su propio efecto (cfg.text.effect). Mantenemos el fade-out final.
  const fadeOut = transition !== 'none'
    ? `,fade=t=out:st=${duration - transitionDuration}:d=${transitionDuration}:color=black`
    : ''

  const grainFilter = cfg.grain ? `,noise=alls=8:allf=t` : ''

  // Orden: scale → crop → scrim → [fade] → [grano] → drawtext×N.
  // El scrim va justo tras el crop para quedar bajo el texto.
  const scrimFilter = buildScrimFilter(height, text.position.y)

  const vfilter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    scrimFilter,
    fadeOut.replace(/^,/, ''),
    grainFilter.replace(/^,/, ''),
    drawTextFilters.join(','),
  ].filter(Boolean).join(',')

  const outputOptions = [
    '-c:v libx264',
    '-preset fast',
    '-crf 23',
    '-pix_fmt yuv420p',
    '-movflags +faststart',
    `-t ${duration}`,
    '-r 30',
    // -ar 48000 / -ac 2: Instagram Reels exige audio ≤ 48 kHz; sin resamplear, el AAC
    // hereda el sample rate de la pista de fondo (p. ej. 96 kHz) y IG rechaza el contenedor.
    ...(audioPath ? ['-c:a aac', '-b:a 192k', '-ar 48000', '-ac 2'] : ['-an']),
  ]

  const wm = cfg.watermark
  const wmEnabled = wm?.enabled ?? false
  const wmType = wm?.type ?? 'text'
  const wmPos = wm?.position ?? 'right'
  const wmY = wm?.y ?? 90

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(cfg.imagePath).inputOptions(['-loop 1', `-t ${duration}`])

    // Cuando el watermark de imagen usa complexFilter, el mapeo automático de
    // streams se desactiva, así que el audio se debe plegar dentro del grafo.
    let audioInComplex = false

    if (wmEnabled && wmType === 'text') {
      const wmText = escapeLine(wm!.text ?? '@bebetter.path')
      const opacity = (wm!.opacity ?? 0.35).toFixed(2)
      const fontPath = `${WINDOWS_FONTS}/arial.ttf`.replace(/^([A-Z]):/, '$1\\:')
      const wmFilter = `drawtext=text='${wmText}':fontfile='${fontPath}':fontsize=22:fontcolor=white@${opacity}:x=${wmXExpr(wmPos, true)}:y=${wmYExpr(wmY)}`
      cmd.videoFilters(vfilter + `,${wmFilter}`)
    } else if (wmEnabled && wmType === 'image') {
      const wmPath = config.watermark.path
      if (wmPath && fs.existsSync(wmPath)) {
        const wmSize = Math.round(width * 0.15)
        cmd.input(wmPath) // input 1 (watermark). El audio, si hay, será input 2.
        const complex = [
          `[0:v]${vfilter}[v]`,
          `[1:v]scale=${wmSize}:-1[wm]`,
          `[v][wm]overlay=x=${wmXExpr(wmPos)}:y=${wmYExpr(wmY)}-h/2[out]`,
        ]
        if (audioPath) {
          complex.push(`[2:a]${audioFilterChain(duration)}[aout]`)
          audioInComplex = true
          cmd.complexFilter(complex, ['out', 'aout'])
        } else {
          cmd.complexFilter(complex, 'out')
        }
      } else {
        cmd.videoFilters(vfilter)
      }
    } else {
      cmd.videoFilters(vfilter)
    }

    // Audio de fondo: loop infinito (se recorta por -t) como último input.
    if (audioPath) {
      cmd.input(audioPath).inputOptions(['-stream_loop -1'])
      if (!audioInComplex) cmd.audioFilters(audioFilterChain(duration))
    }

    cmd
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => resolve({ filename, localPath: outputPath, publicUrl: `${config.publicBaseUrl}/output/videos/${filename}` }))
      .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .run()
  })
}

// Duración del video en segundos (0 si no se puede leer).
function probeDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err || !data?.format?.duration) return resolve(0)
      resolve(Number(data.format.duration) || 0)
    })
  })
}

// Extrae un frame como miniatura (JPG). Toma el punto medio del video (acotado
// a 5s), que siempre queda fuera de los fades de entrada/salida.
export async function extractThumbnail(
  videoPath: string,
  outputName: string
): Promise<{ filename: string; localPath: string }> {
  const outputDir = path.join(path.resolve(config.paths.output), 'thumbnails')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  const filename = `${outputName}.jpg`
  const outputPath = path.join(outputDir, filename)

  const duration = await probeDuration(videoPath)
  // Punto medio acotado a 5s: siempre queda fuera de los fades (entrada/salida),
  // así la miniatura nunca cae en una zona oscura (antes, para un video de 6s,
  // el segundo 5 coincidía justo con el inicio del fade-out).
  const t = Math.max(0.1, Math.min(5, duration / 2))

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(t)
      .frames(1)
      .outputOptions(['-q:v 2'])
      .output(outputPath)
      .on('end', () => resolve({ filename, localPath: outputPath }))
      .on('error', (err) => reject(new Error(`FFmpeg thumbnail error: ${err.message}`)))
      .run()
  })
}
