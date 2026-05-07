import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs'
import { TextConfig, ImageVariant, WatermarkConfig, WatermarkPosition } from '../types'
import { config } from '../config'

function watermarkOverlayExpr(position: WatermarkPosition): string {
  const m = 20
  switch (position) {
    case 'topLeft':     return `x=${m}:y=${m}`
    case 'topRight':    return `x=W-w-${m}:y=${m}`
    case 'bottomLeft':  return `x=${m}:y=H-h-${m}`
    case 'bottomRight': return `x=W-w-${m}:y=H-h-${m}`
  }
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
}

const WINDOWS_FONTS = 'C:/Windows/Fonts'

const FONT_FALLBACKS: Record<string, string> = {
  'Montserrat-Bold':      `${WINDOWS_FONTS}/arialbd.ttf`,
  'Montserrat-Regular':   `${WINDOWS_FONTS}/arial.ttf`,
  'Playfair-Bold':        `${WINDOWS_FONTS}/georgiab.ttf`,
  'Lato-Regular':         `${WINDOWS_FONTS}/calibri.ttf`,
  'Oswald-Bold':          `${WINDOWS_FONTS}/arialbd.ttf`,
  'RobotoCondensed-Bold': `${WINDOWS_FONTS}/arialbd.ttf`,
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
  const shadowOpts = textCfg.shadow ? ':borderw=1:bordercolor=black@0.45' : ''
  const xExpr =
    textCfg.align === 'center'
      ? '(w-tw)/2'
      : textCfg.align === 'right'
      ? `w-tw-${width - Math.round((textCfg.position.x / 100) * width)}`
      : `${Math.round((textCfg.position.x / 100) * width)}`

  return lines.map((line, i) => {
    const y = startY + i * lineH
    return (
      `drawtext=text='${escapeLine(line)}':` +
      `fontfile='${fontPath}':` +
      `fontsize=${textCfg.fontSize}:` +
      `fontcolor=${textCfg.color}:` +
      `x=${xExpr}:y=${y}` +
      shadowOpts
    )
  })
}

function buildVideoFilter(
  textCfg: TextConfig,
  resolution: { width: number; height: number },
  variant: ImageVariant
): string {
  const { width, height } = resolution
  const maxW = Math.round((textCfg.maxWidth / 100) * width)
  const lineH = Math.round(textCfg.fontSize * textCfg.lineHeight)
  const content = textCfg.content
  const hasDelimiter = content.includes('//')

  let drawTextFilters: string[] = []

  if (hasDelimiter && variant === 'combined') {
    const [hookText, punchlineText = ''] = content.split('//').map((p) => p.trim())

    const hookLines = wrapText(hookText, textCfg.fontSize, maxW)
    const hookStartY = Math.max(10, Math.round(0.35 * height) - Math.round((hookLines.length * lineH) / 2))
    drawTextFilters = buildDrawTextFilters(hookLines, textCfg, hookStartY, width)

    if (punchlineText) {
      const punchLines = wrapText(punchlineText, textCfg.fontSize, maxW)
      const punchStartY = Math.max(10, Math.round(0.70 * height) - Math.round((punchLines.length * lineH) / 2))
      drawTextFilters = [...drawTextFilters, ...buildDrawTextFilters(punchLines, textCfg, punchStartY, width)]
    }
  } else {
    let displayText = content
    if (hasDelimiter) {
      const parts = content.split('//').map((p) => p.trim())
      displayText = variant === 'punchline' ? (parts[1] || parts[0]) : parts[0]
    }
    const lines = wrapText(displayText, textCfg.fontSize, maxW)
    const centerY = Math.round((textCfg.position.y / 100) * height)
    const startY = Math.max(10, centerY - Math.round((lines.length * lineH) / 2))
    drawTextFilters = buildDrawTextFilters(lines, textCfg, startY, width)
  }

  return (
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height}` +
    `,${drawTextFilters.join(',')}`
  )
}

export async function generateImage(opts: ImageGenerateOptions): Promise<ImageGenerateResult> {
  const outputDir = path.join(path.resolve(config.paths.output), 'images')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  const variant = opts.variant ?? 'combined'
  const suffix = variant !== 'combined' ? `_${variant}` : ''
  const filename = `${opts.outputName}${suffix}.jpg`
  const outputPath = path.join(outputDir, filename)

  const vfilter = buildVideoFilter(opts.text, opts.resolution, variant)

  const wmPath = config.watermark.path
  const wmEnabled = opts.watermark?.enabled && wmPath && fs.existsSync(wmPath)

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(opts.imagePath)

    if (wmEnabled) {
      const wmSize = Math.round(opts.resolution.width * 0.15)
      const posExpr = watermarkOverlayExpr(opts.watermark!.position ?? 'bottomRight')
      cmd
        .input(wmPath)
        .complexFilter([
          `[0:v]${vfilter}[v]`,
          `[1:v]scale=${wmSize}:-1[wm]`,
          `[v][wm]overlay=${posExpr}[out]`,
        ], 'out')
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
