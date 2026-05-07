import { useRef, useEffect } from 'react'
import { VideoConfig } from '../../types'

interface Props {
  config: VideoConfig
}

/**
 * Simulación visual del video final sobre canvas HTML5.
 * El canvas replica la composición exacta que FFmpeg generará:
 * imagen de fondo + texto superpuesto con la misma posición y estilo.
 * Formato fijo 9:16 escalado al contenedor.
 */
export default function VideoPreview({ config }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = 1080
    const H = 1920
    canvas.width = W
    canvas.height = H

    // Fondo negro por defecto mientras carga la imagen
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    if (!config.imagePreviewUrl) {
      drawText(ctx, config, W, H)
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = config.imagePreviewUrl
    img.onload = () => {
      // Escalar imagen manteniendo aspect-ratio y centrar (igual que FFmpeg crop)
      const scale = Math.max(W / img.width, H / img.height)
      const sw = img.width * scale
      const sh = img.height * scale
      const sx = (W - sw) / 2
      const sy = (H - sh) / 2

      ctx.drawImage(img, sx, sy, sw, sh)
      drawText(ctx, config, W, H)
    }
    img.onerror = () => {
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, W, H)
      drawText(ctx, config, W, H)
    }
  }, [config])

  return (
    <div className="flex items-center justify-center w-full h-full">
      <canvas
        ref={canvasRef}
        style={{
          maxHeight: '100%',
          maxWidth: '100%',
          aspectRatio: '9/16',
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
  ctx.font = `${fontSize}px ${text.font.replace(/-/g, ' ')}, sans-serif`
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

  // Wrap text
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
