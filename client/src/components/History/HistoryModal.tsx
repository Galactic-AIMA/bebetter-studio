import { Star, DownloadSimple, PaintBrush, ArrowSquareOut } from '@phosphor-icons/react'
import { splitByTiempos } from '@shared/splitByTiempos'
import { HistoryItem, VideoRecord } from '../../types'
import { useVideoStore } from '../../store/videoStore'
import PanelDeslizante from '../ui/PanelDeslizante'

interface Props {
  item: HistoryItem
  onClose: () => void
}

const ALINEACION: Record<string, string> = { left: 'Izquierda', center: 'Centro', right: 'Derecha' }

/** Fila de propiedad (DESIGN.md §6): rejilla 112 px / 1fr, alto 32. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[112px_minmax(0,1fr)] items-center gap-2 border-b border-linea px-5 py-1 transition-colors duration-rapido ease-mesa hover:bg-s2">
      <span className="text-ui text-hueso-3">{label}</span>
      <span className="truncate text-ui text-hueso">{value}</span>
    </div>
  )
}

/** Muestra del color guardado en la pieza: es un DATO, por eso el hex va en línea. */
function ColorSwatch({ hex }: { hex: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-[3px] border border-linea-2" style={{ background: hex }} />
      <span className="font-mono text-meta text-hueso-2">{hex}</span>
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatFont(font: string) {
  const idx = font.lastIndexOf('-')
  if (idx === -1) return font
  return `${font.slice(0, idx)} — ${font.slice(idx + 1)}`
}

export default function HistoryModal({ item, onClose }: Props) {
  const { loadFullFromHistory, loadStyleFromHistory } = useVideoStore()
  const { config } = item
  const { text } = config
  const isVideo = item.kind === 'video'
  const vidRecord = isVideo ? (item as VideoRecord & { kind: 'video' }) : null

  const imageId = config.imageId
  const thumbnailUrl = imageId ? `/api/images/file/${encodeURIComponent(imageId)}` : null
  // Preview del video sin salir del UI: local (recién generado) o S3 si ya se publicó.
  const videoSrc = vidRecord ? (vidRecord.s3Url || `/output/videos/${encodeURIComponent(vidRecord.filename)}`) : null

  function handleLoadFull() {
    loadFullFromHistory(item)
    onClose()
  }

  function handleLoadStyle() {
    loadStyleFromHistory(item)
    onClose()
  }

  const [a, b] = splitByTiempos(text.content)
  const mono = (v: React.ReactNode) => <span className="font-mono text-meta text-hueso-2">{v}</span>

  return (
    <PanelDeslizante
      titulo={isVideo ? 'Reel' : 'Imagen'}
      meta={
        <span className="flex shrink-0 items-center gap-2 font-mono text-meta text-hueso-3">
          {formatDate(item.createdAt)}
          {item.viral && <span className="flex items-center gap-1 text-oro"><Star size={12} weight="fill" /> viral</span>}
        </span>
      }
      onClose={onClose}
      pie={
        <>
          <button onClick={handleLoadStyle} className="btn-sec flex-1" title="Solo tipografía y ajustes, sin frase ni fondo">
            <PaintBrush size={16} /> Cargar estilo
          </button>
          <button onClick={handleLoadFull} className="btn-sec flex-1 border-hueso" title="Frase, fondo y ajustes, como estaba">
            <DownloadSimple size={16} /> Cargar todo
          </button>
        </>
      }
    >
      {/* Preview: el vídeo reproducible o la miniatura de la imagen. */}
      {isVideo && videoSrc ? (
        <div className="flex justify-center bg-sala px-5 py-4">
          <video src={videoSrc} poster={thumbnailUrl ?? undefined} controls playsInline className="max-h-[45dvh] w-auto rounded-control" />
        </div>
      ) : thumbnailUrl ? (
        <div className="flex justify-center bg-sala px-5 py-4">
          <img src={thumbnailUrl} alt="" className="max-h-[45dvh] w-auto rounded-control" />
        </div>
      ) : null}

      <p className="border-b border-linea px-5 py-4 text-body text-hueso">
        {a}
        {b && <><span aria-hidden="true" className="mx-1.5 font-mono text-meta text-lacre">//</span><span className="text-hueso-2">{b}</span></>}
      </p>

      <h3 className="rotulo px-5 pb-1.5 pt-4">Texto</h3>
      <Row label="Fuente" value={formatFont(text.font)} />
      <Row label="Tamaño" value={mono(`${text.fontSize} px`)} />
      <Row label="Color" value={<ColorSwatch hex={text.color} />} />
      <Row label="Alineación" value={ALINEACION[text.align as string] ?? text.align} />
      <Row label="Interlineado" value={mono(text.lineHeight)} />
      <Row label="Ancho máx." value={mono(`${text.maxWidth} %`)} />
      {(text.letterSpacing ?? 0) !== 0 && <Row label="Espaciado" value={mono(`${text.letterSpacing} px`)} />}
      {(text.strokeWidth ?? 0) > 0 && (
        <Row label="Contorno" value={
          <span className="flex items-center gap-2">
            {mono(`${text.strokeWidth} px`)}
            <ColorSwatch hex={text.strokeColor ?? '#000000'} />
          </span>
        } />
      )}
      <Row label="Sombra" value={text.shadow ? 'Sí' : 'No'} />

      <h3 className="rotulo px-5 pb-1.5 pt-5">{isVideo ? 'Vídeo' : 'Imagen'}</h3>
      <Row label="Resolución" value={mono(`${config.resolution.width} × ${config.resolution.height}`)} />
      {isVideo && vidRecord && (
        <>
          <Row label="Duración" value={mono(`${vidRecord.config.duration} s`)} />
          <Row label="Efecto" value={vidRecord.config.textEffect ?? 'Ninguno'} />
          <Row label="Estilo visual" value={vidRecord.config.visualStyle ?? '—'} />
          <Row label="Transición" value={vidRecord.config.transition} />
          <Row label="Grano" value={vidRecord.config.grain ? 'Sí' : 'No'} />
        </>
      )}
      {config.watermark?.enabled && <Row label="Marca de agua" value={config.watermark.text ?? 'Imagen'} />}

      {isVideo && vidRecord && (vidRecord.s3Url || vidRecord.driveUrl) && (
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {vidRecord.s3Url && (
            <a href={vidRecord.s3Url} target="_blank" rel="noreferrer" className="btn-sec" title={vidRecord.s3Url}>
              <ArrowSquareOut size={16} /> Abrir en R2
            </a>
          )}
          {vidRecord.driveUrl && (
            <a href={vidRecord.driveUrl} target="_blank" rel="noreferrer" className="btn-sec" title={vidRecord.driveUrl}>
              <ArrowSquareOut size={16} /> Abrir en Drive
            </a>
          )}
        </div>
      )}
    </PanelDeslizante>
  )
}
