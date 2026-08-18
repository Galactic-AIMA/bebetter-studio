import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs'
import { TextConfig, ImageVariant, WatermarkConfig, WatermarkPosition } from '../types'
import { config } from '../config'
import { buildScrimFilter } from './videoGenerator'
import { resolveFontFile, resolveItalicFontFile, toFFmpegPath, measurerFor, watermarkFontFile } from '../text/fontMeasure'
import { wrapWith } from '../text/wrap'

function wmXExpr(position: WatermarkPosition, isText = false): string {
  if (position === 'left') return '20'
  if (position === 'center') return isText ? '(w-tw)/2' : '(W-w)/2'
  return isText ? 'w-tw-20' : 'W-w-20'
}

function wmYExpr(y: number): string {
  return `H*${(y / 100).toFixed(4)}`
}

export interface ImageGenerateResult {
  filename: string
  localPath: string
  publicUrl: string
  variant: ImageVariant
}

export interface ImageGenerateOptions {
  imagePath: string
  text: TextConfig
  resolution: { width: number; height: number }
  outputName: string
  variant?: ImageVariant
  watermark?: WatermarkConfig
  source?: string
  /** Líneas ya envueltas por el cliente (incluyen la división por tiempos). */
  wrappedLines?: string[]
}

/**
 * Envuelve midiendo con el TTF real (mismo algoritmo y mismo medidor que el
 * vídeo). `splitBlocks` queda en manos de quien llama: las mitades de un `//`
 * ya son bloques por sí mismas y no se vuelven a partir.
 */
function wrapImageText(text: string, font: string, fontSize: number, maxPx: number, splitBlocks: boolean): string[] {
  return wrapWith(measurerFor(font, fontSize), { text, maxPx, splitBlocks })
}

function resolveFontPath(fontName: string): string {
  return toFFmpegPath(resolveFontFile(fontName))
}

function resolveItalicFontPath(fontName: string): string | null {
  const italic = resolveItalicFontFile(fontName)
  return italic ? toFFmpegPath(italic) : null
}

function escapeLine(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function buildDrawTextFilters(
  lines: string[],
  textCfg: TextConfig,
  startY: number,
  width: number
): string[] {
  const fontPath = resolveFontPath(textCfg.font)
  const lineH = Math.round(textCfg.fontSize * textCfg.lineHeight)
  const shadowOpts = textCfg.shadow ? ':shadowx=2:shadowy=2:shadowcolor=black@0.7' : ''
  const strokeOpts = (textCfg.strokeWidth && textCfg.strokeWidth > 0)
    ? `:borderw=${textCfg.strokeWidth}:bordercolor=${(textCfg.strokeColor ?? '#000000').replace('#', '0x')}`
    : ''
  const xExpr =
    textCfg.align === 'center'
      ? '(w-tw)/2'
      : textCfg.align === 'right'
      ? `w-tw-${width - Math.round((textCfg.position.x / 100) * width)}`
      : `${Math.round((textCfg.position.x / 100) * width)}`

  // flatMap: una línea vacía (el respiro entre tiempos) no emite drawtext, pero
  // conserva su slot vertical porque el índice `i` sigue avanzando.
  return lines.flatMap((line, i) => {
    if (!line) return []
    const y = startY + i * lineH
    return (
      `drawtext=text='${escapeLine(line)}':` +
      `fontfile='${fontPath}':` +
      `fontsize=${textCfg.fontSize}:` +
      `fontcolor=${textCfg.color}:` +
      `x=${xExpr}:y=${y}` +
      shadowOpts +
      strokeOpts
    )
  })
}

function buildVideoFilter(
  textCfg: TextConfig,
  resolution: { width: number; height: number },
  variant: ImageVariant,
  source?: string,
  wrappedLines?: string[]
): string {
  const { width, height } = resolution
  const maxW = Math.round((textCfg.maxWidth / 100) * width)
  const lineH = Math.round(textCfg.fontSize * textCfg.lineHeight)
  const content = textCfg.content
  const hasDelimiter = content.includes('//')

  let drawTextFilters: string[] = []
  // Ancla vertical (% de altura) del bloque de texto más bajo: define hasta dónde
  // baja el degradado de carbón. Por defecto, la posición del texto.
  let scrimAnchorY = textCfg.position.y

  if (hasDelimiter && variant === 'combined') {
    const [hookText, punchlineText = ''] = content.split('//').map((p) => p.trim())

    const hookLines = wrapImageText(hookText, textCfg.font, textCfg.fontSize, maxW, false)
    const hookStartY = Math.max(10, Math.round(0.35 * height) - Math.round((hookLines.length * lineH) / 2))
    drawTextFilters = buildDrawTextFilters(hookLines, textCfg, hookStartY, width)
    scrimAnchorY = 35

    if (punchlineText) {
      const punchLines = wrapImageText(punchlineText, textCfg.font, textCfg.fontSize, maxW, false)
      const punchStartY = Math.max(10, Math.round(0.70 * height) - Math.round((punchLines.length * lineH) / 2))
      drawTextFilters = [...drawTextFilters, ...buildDrawTextFilters(punchLines, textCfg, punchStartY, width)]
      scrimAnchorY = 70
    }
  } else {
    let displayText = content
    if (hasDelimiter) {
      const parts = content.split('//').map((p) => p.trim())
      displayText = variant === 'punchline' ? (parts[1] || parts[0]) : parts[0]
    }
    // Sin `//`, las líneas del cliente son las buenas: vienen de measureText y
    // ya traen la división por tiempos. Con `//` no sirven (envuelven el texto
    // entero, no la parte que toca mostrar) → se recalcula en local, y ahí la
    // mitad mostrada ya es un bloque: no se vuelve a partir por tiempos.
    const lines = (!hasDelimiter && wrappedLines?.length)
      ? wrappedLines
      : wrapImageText(displayText, textCfg.font, textCfg.fontSize, maxW, !hasDelimiter)
    const centerY = Math.round((textCfg.position.y / 100) * height)
    const startY = Math.max(10, centerY - Math.round((lines.length * lineH) / 2))
    drawTextFilters = buildDrawTextFilters(lines, textCfg, startY, width)

    if (source) {
      const sourceLabel = `– ${source} –`
      const sourceFontSize = Math.round(textCfg.fontSize * 0.55)
      const sourceY = startY + lines.length * lineH + sourceFontSize * 2
      const italicPath = resolveItalicFontPath(textCfg.font) ?? resolveFontPath(textCfg.font)
      const shadowSource = textCfg.shadow ? ':shadowx=1:shadowy=1:shadowcolor=black@0.5' : ''
      drawTextFilters.push(
        `drawtext=text='${escapeLine(sourceLabel)}':` +
        `fontfile='${italicPath}':` +
        `fontsize=${sourceFontSize}:` +
        `fontcolor=${textCfg.color}@0.8:` +
        `x=(w-tw)/2:y=${sourceY}` +
        shadowSource
      )
    }
  }

  // scale → crop → degradado de carbón → drawtext×N (mismo orden que el video).
  const scrimFilter = buildScrimFilter(height, scrimAnchorY)

  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    scrimFilter,
    drawTextFilters.join(','),
  ].filter(Boolean).join(',')
}

export async function generateImage(opts: ImageGenerateOptions): Promise<ImageGenerateResult> {
  const outputDir = path.join(path.resolve(config.paths.output), 'images')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  const variant = opts.variant ?? 'combined'
  const suffix = variant !== 'combined' ? `_${variant}` : ''
  const filename = `${opts.outputName}${suffix}.jpg`
  const outputPath = path.join(outputDir, filename)

  const vfilter = buildVideoFilter(opts.text, opts.resolution, variant, opts.source, opts.wrappedLines)

  const wm = opts.watermark
  const wmEnabled = wm?.enabled ?? false
  const wmType = wm?.type ?? 'text'
  const wmPos = wm?.position ?? 'right'
  const wmY = wm?.y ?? 90

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(opts.imagePath)

    if (wmEnabled && wmType === 'text') {
      const wmText = (wm!.text ?? '@bebetter.path').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')
      const opacity = (wm!.opacity ?? 0.35).toFixed(2)
      const fontPath = toFFmpegPath(watermarkFontFile())
      const wmFilter = `drawtext=text='${wmText}':fontfile='${fontPath}':fontsize=22:fontcolor=white@${opacity}:x=${wmXExpr(wmPos, true)}:y=${wmYExpr(wmY)}`
      cmd.videoFilters(vfilter + `,${wmFilter}`)
    } else if (wmEnabled && wmType === 'image') {
      const wmPath = config.watermark.path
      if (wmPath && fs.existsSync(wmPath)) {
        const wmSize = Math.round(opts.resolution.width * 0.15)
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
      .outputOptions(['-frames:v 1', '-q:v 2'])
      .output(outputPath)
      .on('end', () => resolve({ filename, localPath: outputPath, publicUrl: `${config.publicBaseUrl}/output/images/${filename}`, variant }))
      .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .run()
  })
}
