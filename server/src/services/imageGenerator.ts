import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs'
import { TextConfig, ImageVariant, WatermarkConfig, WatermarkPosition } from '../types'
import { config } from '../config'

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

  return lines.map((line, i) => {
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
      const fontPath = `${WINDOWS_FONTS}/arial.ttf`.replace(/^([A-Z]):/, '$1\\:')
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
