import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs'
import { VideoConfig } from '../types'
import { config } from '../config'

export interface GenerateResult {
  filename: string
  localPath: string
  publicUrl: string
}

const WINDOWS_FONTS = 'C:/Windows/Fonts'

const FONT_FALLBACKS: Record<string, string> = {
  'Montserrat-Bold':       `${WINDOWS_FONTS}/arialbd.ttf`,
  'Montserrat-Regular':    `${WINDOWS_FONTS}/arial.ttf`,
  'Playfair-Bold':         `${WINDOWS_FONTS}/georgiab.ttf`,
  'Lato-Regular':          `${WINDOWS_FONTS}/calibri.ttf`,
  'Oswald-Bold':           `${WINDOWS_FONTS}/arialbd.ttf`,
  'RobotoCondensed-Bold':  `${WINDOWS_FONTS}/arialbd.ttf`,
}

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

// Escapa el texto de una sola linea para el filtro drawtext
function escapeLine(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
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

  const shadowOpts = text.shadow
    ? ':borderw=1:bordercolor=black@0.45'
    : ''

  const drawTextFilters = lines.map((line, i) => {
    const y = startY + i * lineH
    return (
      `drawtext=text='${escapeLine(line)}':` +
      `fontfile='${fontPath}':` +
      `fontsize=${text.fontSize}:` +
      `fontcolor=${text.color}:` +
      `x=${xExpr}:y=${y}` +
      shadowOpts
    )
  })

  const fadeIn = transition !== 'none'
    ? `,fade=t=in:st=0:d=${transitionDuration}:color=black`
    : ''
  const fadeOut = transition !== 'none'
    ? `,fade=t=out:st=${duration - transitionDuration}:d=${transitionDuration}:color=black`
    : ''

  const vfilter =
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height}` +
    fadeIn +
    fadeOut +
    `,${drawTextFilters.join(',')}`

  return new Promise((resolve, reject) => {
    ffmpeg(cfg.imagePath)
      .inputOptions(['-loop 1', `-t ${duration}`])
      .videoFilters(vfilter)
      .outputOptions([
        '-c:v libx264',
        '-preset fast',
        '-crf 23',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        `-t ${duration}`,
        '-r 30',
        '-an',
      ])
      .output(outputPath)
      .on('end', () => {
        resolve({
          filename,
          localPath: outputPath,
          publicUrl: `${config.publicBaseUrl}/output/videos/${filename}`,
        })
      })
      .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .run()
  })
}
