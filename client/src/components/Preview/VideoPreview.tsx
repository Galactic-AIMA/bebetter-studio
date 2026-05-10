import { useRef, useEffect } from 'react'
import { VideoConfig, WatermarkConfig } from '../../types'

interface Props {
  config: VideoConfig
}

const FONT_MAP: Record<string, { weight: string; family: string }> = {
  'Montserrat-Bold':      { weight: '700', family: 'Montserrat' },
  'Montserrat-Regular':   { weight: '400', family: 'Montserrat' },
  'Playfair-Bold':        { weight: '700', family: '"Playfair Display"' },
  'Lato-Regular':         { weight: '400', family: 'Lato' },
  'Oswald-Bold':          { weight: '700', family: 'Oswald' },
  'RobotoCondensed-Bold': { weight: '700', family: '"Roboto Condensed"' },
  'Anton-Regular':        { weight: '400', family: 'Anton' },
  'Inter-Bold':           { weight: '700', family: 'Inter' },
  'Inter-Regular':        { weight: '400', family: 'Inter' },
  'IBMPlexSans-Bold':     { weight: '700', family: '"IBM Plex Sans"' },
  'IBMPlexSans-Regular':  { weight: '400', family: '"IBM Plex Sans"' },
}

function fontToCSS(fontName: string, sizePx: number): string {
  const entry = FONT_MAP[fontName]
  if (!entry) return `${sizePx}px sans-serif`
  return `${entry.weight} ${sizePx}px ${entry.family}, sans-serif`
}

export default function VideoPreview({ config }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = config.resolution.width
    const H = config.resolution.height
    canvas.width = W
    canvas.height = H

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    const loadImg = (src: string): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = src
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
      })

    const wmEnabled = config.watermark?.enabled
    const wmType = config.watermark?.type ?? 'text'
    const needsWmImage = wmEnabled && wmType === 'image'

    const tasks: Promise<HTMLImageElement | null>[] = [
      config.imagePreviewUrl ? loadImg(config.imagePreviewUrl) : Promise.resolve(null),
      needsWmImage ? loadImg('/api/watermark') : Promise.resolve(null),
    ]

    const { weight, family } = FONT_MAP[config.text.font] ?? { weight: '400', family: 'sans-serif' }
    const fontSpec = `${weight} ${config.text.fontSize}px ${family}`

    Promise.all(tasks).then(async ([bg, wm]) => {
      await document.fonts.load(fontSpec)
      if (bg) {
        const scale = Math.max(W / bg.width, H / bg.height)
        const sw = bg.width * scale
        const sh = bg.height * scale
        ctx.drawImage(bg, (W - sw) / 2, (H - sh) / 2, sw, sh)
      } else {
        ctx.fillStyle = '#1a1a2e'
        ctx.fillRect(0, 0, W, H)
      }
      drawText(ctx, config, W, H)
      if (wmEnabled && wmType === 'text') {
        drawTextWatermark(ctx, config.watermark!, W, H)
      } else if (wmEnabled && wm) {
        drawImageWatermark(ctx, wm, config.watermark!, W, H)
      }
    })
  }, [config])

  return (
    <div className="flex items-center justify-center w-full h-full">
      <canvas
        ref={canvasRef}
        style={{
          maxHeight: '100%',
          maxWidth: '100%',
          aspectRatio: `${config.resolution.width}/${config.resolution.height}`,
          borderRadius: '8px',
          objectFit: 'contain',
        }}
      />
    </div>
  )
}

function drawText(
  ctx: CanvasRenderingContext2D,
  config: VideoConfig,
  W: number,
  H: number
) {
  const { text } = config
  if (!text.content) return

  const fontSize = text.fontSize
  ctx.font = fontToCSS(text.font, fontSize)
  ctx.fillStyle = text.color
  ctx.textAlign = text.align
  ctx.textBaseline = 'middle'

  const maxPx = (text.maxWidth / 100) * W
  const x =
    text.align === 'center'
      ? W / 2
      : text.align === 'right'
      ? W - (W - (text.position.x / 100) * W)
      : (text.position.x / 100) * W
  const y = (text.position.y / 100) * H

  if (text.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetX = 2
    ctx.shadowOffsetY = 2
  }

  const words = text.content.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (ctx.measureText(test).width > maxPx && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)

  const lineH = fontSize * text.lineHeight
  const totalH = lines.length * lineH
  const startY = y - totalH / 2 + lineH / 2

  lines.forEach((line, i) => {
    ctx.fillText(line, x, startY + i * lineH)
  })

  ctx.shadowColor = 'transparent'
}

function drawTextWatermark(
  ctx: CanvasRenderingContext2D,
  wm: WatermarkConfig,
  W: number,
  H: number
) {
  const text = wm.text ?? '@bebetter.path'
  const opacity = wm.opacity ?? 0.35
  const yPx = H * ((wm.y ?? 90) / 100)
  const fontSize = Math.round(W * 0.02)
  ctx.font = `${fontSize}px Arial, sans-serif`
  ctx.globalAlpha = opacity
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = wm.position === 'left' ? 'left' : wm.position === 'center' ? 'center' : 'right'
  const x = wm.position === 'left' ? 20 : wm.position === 'center' ? W / 2 : W - 20
  ctx.fillText(text, x, yPx)
  ctx.globalAlpha = 1
}

function drawImageWatermark(
  ctx: CanvasRenderingContext2D,
  wm: HTMLImageElement,
  wmCfg: WatermarkConfig,
  W: number,
  H: number
) {
  const wmW = Math.round(W * 0.15)
  const wmH = Math.round(wm.height * (wmW / wm.width))
  const margin = 20
  const x = wmCfg.position === 'left' ? margin : wmCfg.position === 'center' ? (W - wmW) / 2 : W - wmW - margin
  const y = H * ((wmCfg.y ?? 90) / 100) - wmH / 2
  ctx.drawImage(wm, x, y, wmW, wmH)
}
