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
    ? ':borderw=1:bordercolor=black@0.45'
    : ''

  const drawTextFilters = lines.map((line, i) => {
    const baseY = startY + i * lineH
    const { yExpr, extraOpts } = effectOpts(effect, baseY)
    return (
      `drawtext=text='${escapeLine(line)}':` +
      `fontfile='${fontPath}':` +
      `fontsize=${text.fontSize}:` +
      `fontcolor=${text.color}:` +
      `x=${xExpr}:y=${yExpr}` +
      shadowOpts +
      extraOpts
    )
  })

  const fadeIn = transition !== 'none'
    ? `,fade=t=in:st=0:d=${transitionDuration}:color=black`
    : ''
  const fadeOut = transition !== 'none'
    ? `,fade=t=out:st=${duration - transitionDuration}:d=${transitionDuration}:color=black`
    : ''

  const grainFilter = cfg.grain ? `,noise=alls=8:allf=t` : ''

  const vfilter =
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height}` +
    fadeIn +
    fadeOut +
    grainFilter +
    `,${drawTextFilters.join(',')}`

  const outputOptions = [
    '-c:v libx264',
    '-preset fast',
    '-crf 23',
    '-pix_fmt yuv420p',
    '-movflags +faststart',
    `-t ${duration}`,
    '-r 30',
    '-an',
  ]

  const wm = cfg.watermark
  const wmEnabled = wm?.enabled ?? false
  const wmType = wm?.type ?? 'text'
  const wmPos = wm?.position ?? 'right'
  const wmY = wm?.y ?? 90

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(cfg.imagePath).inputOptions(['-loop 1', `-t ${duration}`])

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
        cmd
          .input(wmPath)
          .complexFilter([
            `[0:v]${vfilter}[v]`,
            `[1:v]scale=${wmSize}:-1[wm]`,
            `[v][wm]overlay=x=${wmXExpr(wmPos)}:y=${wmYExpr(wmY)}-h/2[out]`,
          ], 'out')
      } else {
        cmd.videoFilters(vfilter)
      }
    } else {
      cmd.videoFilters(vfilter)
    }

    cmd
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => resolve({ filename, localPath: outputPath, publicUrl: `${config.publicBaseUrl}/output/videos/${filename}` }))
      .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .run()
  })
}
