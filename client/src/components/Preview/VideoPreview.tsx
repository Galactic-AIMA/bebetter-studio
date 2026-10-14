import { useRef, useEffect } from 'react'
import { VideoConfig, WatermarkConfig } from '../../types'
import { buildFontMap, fontToCSS, parseFontKey } from '../../config/fonts'
import { wrapText, BLOCK_SEPARATOR } from '../../lib/wrapText'
import { drawTextScrim } from '../../lib/textScrim'

interface Props {
  config: VideoConfig
  /**
   * Identidad de la frase elegida. Cuando cambia, el texto entra en dos tiempos
   * (DESIGN.md §7.2). Escribir en el campo de texto NO la cambia, así que teclear
   * no repite la coreografía.
   */
  fraseKey?: string | null
  /** Sin fondo ni frase: se pinta solo la pantalla, y el estado vacío va encima. */
  vacio?: boolean
}

const FONT_MAP = buildFontMap()

/* Dos tiempos (DESIGN.md §7.2): el primero entra en 200 ms, respiro de 450 ms y
   entra el giro. Es lo que hace el reel. */
const T_ENTRA = 200
const T_RESPIRO = 450
const T_TOTAL = T_ENTRA + T_RESPIRO + T_ENTRA

/** Aproxima la curva `mesa` (cubic-bezier(.2,.8,.2,1)): sale rápido y se posa. */
const posarse = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)

/** Opacidad de [primer tiempo, giro] a `t` ms del inicio. */
function alfas(t: number): [number, number] {
  return [posarse(t / T_ENTRA), posarse((t - T_ENTRA - T_RESPIRO) / T_ENTRA)]
}

export default function VideoPreview({ config, fraseKey, vacio = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // La coreografía va por RELOJ, no por render: al elegir una frase el `config`
  // cambia varias veces seguidas (texto, fondo afín, pista…) y cada cambio
  // relanza el dibujo. Guardando cuándo empezó, cada redibujo retoma la
  // animación donde iba en vez de cortarla o empezarla de nuevo.
  const anim = useRef<{ key: string | null | undefined; inicio: number | null }>({ key: fraseKey, inicio: null })
  if (anim.current.key !== fraseKey) anim.current = { key: fraseKey, inicio: null }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = config.resolution.width
    const H = config.resolution.height
    // Un `config` más nuevo invalida este dibujo: sin esto, una imagen lenta
    // terminaba pintándose encima de la elegida después.
    let vigente = true

    // Sin `crossOrigin`: el canvas nunca se exporta, así que no importa que quede
    // «tainted», y sin él el navegador reutiliza la miniatura ya descargada del banco.
    const loadImg = (src: string): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
        const img = new Image()
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

    const entry = FONT_MAP[config.text.font] ?? { weight: '400', family: 'sans-serif' }
    const italic = entry.italic ? 'italic ' : ''
    const fontSpec = `${italic}${entry.weight} ${config.text.fontSize}px ${entry.family}`

    let cuadro = 0

    Promise.all(tasks).then(async ([bg, wm]) => {
      await document.fonts.load(fontSpec)
      if (!vigente) return
      // Las dimensiones se fijan aquí y no antes de cargar: cambiar `width` borra el
      // canvas, y el fotograma anterior se queda en pantalla mientras llega el nuevo.
      if (canvas.width !== W) canvas.width = W
      if (canvas.height !== H) canvas.height = H

      const pintar = (alfa: [number, number]) => {
        if (bg) {
          const scale = Math.max(W / bg.width, H / bg.height)
          const sw = bg.width * scale
          const sh = bg.height * scale
          ctx.drawImage(bg, (W - sw) / 2, (H - sh) / 2, sw, sh)
        } else {
          // Sin imagen elegida: el carbón de la sala, no un azul ajeno a la marca.
          ctx.fillStyle = '#1A1815'
          ctx.fillRect(0, 0, W, H)
        }
        // Degradado de carbón entre la imagen y el texto (mismo perfil que el render).
        drawTextScrim(ctx, W, H, config.text.position.y)
        if (!vacio) drawText(ctx, config, W, H, alfa)
        if (wmEnabled && wmType === 'text') {
          drawTextWatermark(ctx, config.watermark!, W, H)
        } else if (wmEnabled && wm) {
          drawImageWatermark(ctx, wm, config.watermark!, W, H)
        }
      }

      // Sin frase elegida, o con movimiento reducido: el texto entero, sin más.
      const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!anim.current.key || reducido) { pintar([1, 1]); return }

      // El reloj arranca en el PRIMER fotograma pintado de esta frase, no al
      // elegirla: si el fondo tarda en llegar, la coreografía no se pierde a ciegas.
      if (anim.current.inicio === null) anim.current.inicio = performance.now()
      const inicio = anim.current.inicio
      const paso = () => {
        if (!vigente) return
        const t = performance.now() - inicio
        pintar(alfas(t))
        if (t < T_TOTAL) cuadro = requestAnimationFrame(paso)
      }
      paso()
    })
    return () => { vigente = false; cancelAnimationFrame(cuadro) }
  }, [config, vacio])

  return (
    <div className="flex items-center justify-center w-full h-full">
      <canvas
        ref={canvasRef}
        style={{
          maxHeight: '100%',
          maxWidth: '100%',
          aspectRatio: `${config.resolution.width}/${config.resolution.height}`,
          borderRadius: '14px',
          objectFit: 'contain',
          // La pantalla de la sala: sombra profunda + anillo de 1 px (DESIGN.md §6).
          boxShadow: '0 40px 120px -20px rgb(0 0 0 / .9), 0 0 0 1px rgb(232 228 220 / .06)',
        }}
      />
    </div>
  )
}

function drawText(
  ctx: CanvasRenderingContext2D,
  config: VideoConfig,
  W: number,
  H: number,
  /** Opacidad de [primer tiempo, giro]. Las líneas tras el respiro son el giro. */
  alfa: [number, number] = [1, 1]
) {
  const { text } = config
  if (!text.content) return

  const fontSize = text.fontSize
  ctx.font = fontToCSS(text.font, fontSize)
  ctx.fillStyle = text.color
  ctx.textAlign = text.align
  ctx.textBaseline = 'middle'

  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${text.letterSpacing ?? 0}px`
  }

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

  const lines = wrapText({
    text: text.content,
    font: text.font,
    fontSize,
    maxWidth: text.maxWidth,
    resolutionWidth: W,
    ctx,
  })

  const lineH = fontSize * text.lineHeight
  const totalH = lines.length * lineH
  const startY = y - totalH / 2 + lineH / 2

  // Qué tiempo es cada línea: todo lo que va tras el primer respiro es el giro.
  const corte = lines.indexOf(BLOCK_SEPARATOR)
  const alfaDe = (i: number) => (corte >= 0 && i > corte ? alfa[1] : alfa[0])

  const strokeW = text.strokeWidth ?? 0
  if (strokeW > 0) {
    ctx.lineWidth = strokeW * 2
    ctx.strokeStyle = text.strokeColor ?? '#000000'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'transparent'
    lines.forEach((line, i) => {
      ctx.globalAlpha = alfaDe(i)
      ctx.strokeText(line, x, startY + i * lineH)
    })
    if (text.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.7)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetX = 2
      ctx.shadowOffsetY = 2
    }
  }

  lines.forEach((line, i) => {
    ctx.globalAlpha = alfaDe(i)
    ctx.fillText(line, x, startY + i * lineH)
  })
  ctx.globalAlpha = 1

  ctx.shadowColor = 'transparent'
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
  }

  // Línea de fuente/autor
  if (config.source) {
    const sourceLabel = `– ${config.source} –`
    const sourceFontSize = Math.round(fontSize * 0.55)
    const { family } = parseFontKey(text.font)
    const italicKey = `${family}-Italic`
    const sourceCss = FONT_MAP[italicKey]
      ? `italic ${FONT_MAP[italicKey].weight} ${sourceFontSize}px ${FONT_MAP[italicKey].family}, sans-serif`
      : `${sourceFontSize}px ${FONT_MAP[text.font]?.family ?? 'sans-serif'}, sans-serif`
    ctx.font = sourceCss
    ctx.fillStyle = text.color
    // La fuente cierra la frase: entra con el giro.
    ctx.globalAlpha = 0.8 * alfa[1]
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const sourceY = startY + lines.length * lineH + sourceFontSize * 2
    ctx.fillText(sourceLabel, W / 2, sourceY)
    ctx.globalAlpha = 1
  }
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
