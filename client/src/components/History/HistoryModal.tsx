import { X, Download, Palette } from 'lucide-react'
import { HistoryItem, VideoRecord } from '../../types'
import { useVideoStore } from '../../store/videoStore'

interface Props {
  item: HistoryItem
  onClose: () => void
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-carbon-600 last:border-0">
      <span className="text-[11px] text-bone-700">{label}</span>
      <span className="text-[11px] text-bone-500 text-right max-w-[60%]">{value}</span>
    </div>
  )
}

function ColorSwatch({ hex }: { hex: string }) {
  return (
    <span className="flex items-center gap-1.5 justify-end">
      <span className="inline-block w-3 h-3 rounded-sm border border-white/10" style={{ background: hex }} />
      <span>{hex}</span>
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

  function handleLoadFull() {
    loadFullFromHistory(item)
    onClose()
  }

  function handleLoadStyle() {
    loadStyleFromHistory(item)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-md bg-carbon-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1 rounded-lg bg-carbon-700/80 text-bone-700 hover:text-bone-500 transition-colors"
        >
          <X size={14} />
        </button>

        {/* Thumbnail */}
        {thumbnailUrl && (
          <div className="h-36 bg-carbon-900 overflow-hidden shrink-0">
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-3">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                isVideo ? 'bg-carbon-600 text-bone-700' : 'bg-carbon-600 text-gold-500'
              }`}>
                {isVideo ? 'Video' : 'Imagen'}
              </span>
              {item.viral && (
                <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-gold-500/10 text-gold-500">
                  ⭐ Viral
                </span>
              )}
              <span className="text-[10px] text-bone-700 ml-auto">{formatDate(item.createdAt)}</span>
            </div>
            <p className="text-sm text-bone-500 leading-snug">{text.content}</p>
          </div>

          {/* Params */}
          <div className="bg-carbon-900 rounded-lg px-3 py-1">
            <Row label="Fuente" value={formatFont(text.font)} />
            <Row label="Tamaño" value={`${text.fontSize}px`} />
            <Row label="Color" value={<ColorSwatch hex={text.color} />} />
            <Row label="Alineación" value={text.align} />
            <Row label="Interlineado" value={text.lineHeight} />
            <Row label="Ancho máx." value={`${text.maxWidth}%`} />
            {(text.letterSpacing ?? 0) !== 0 && (
              <Row label="Letter spacing" value={`${text.letterSpacing}px`} />
            )}
            {(text.strokeWidth ?? 0) > 0 && (
              <Row label="Contorno" value={
                <span className="flex items-center gap-1.5 justify-end">
                  {`${text.strokeWidth}px`}
                  <span className="inline-block w-3 h-3 rounded-sm border border-white/10" style={{ background: text.strokeColor ?? '#000' }} />
                </span>
              } />
            )}
            <Row label="Sombra" value={text.shadow ? 'Sí' : 'No'} />
            {isVideo && vidRecord && (
              <>
                <Row label="Efecto texto" value={vidRecord.config.textEffect ?? 'none'} />
                <Row label="Estilo visual" value={vidRecord.config.visualStyle ?? '—'} />
                <Row label="Resolución" value={`${config.resolution.width} × ${config.resolution.height}`} />
                <Row label="Duración" value={`${vidRecord.config.duration}s`} />
                <Row label="Transición" value={vidRecord.config.transition} />
                <Row label="Grano" value={vidRecord.config.grain ? 'Sí' : 'No'} />
              </>
            )}
            {!isVideo && (
              <Row label="Resolución" value={`${config.resolution.width} × ${config.resolution.height}`} />
            )}
            {config.watermark?.enabled && (
              <Row label="Marca de agua" value={config.watermark.text ?? 'imagen'} />
            )}
          </div>

          {/* Links */}
          {isVideo && vidRecord && (vidRecord.s3Url || vidRecord.driveUrl) && (
            <div className="flex flex-col gap-1">
              {vidRecord.s3Url && (
                <a href={vidRecord.s3Url} target="_blank" rel="noreferrer" className="text-[11px] text-gold-500 hover:underline truncate">
                  S3: {vidRecord.s3Url}
                </a>
              )}
              {vidRecord.driveUrl && (
                <a href={vidRecord.driveUrl} target="_blank" rel="noreferrer" className="text-[11px] text-gold-500 hover:underline truncate">
                  Drive: {vidRecord.driveUrl}
                </a>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-3 flex gap-2 border-t border-carbon-700 shrink-0">
          <button
            onClick={handleLoadStyle}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-carbon-700 text-bone-500 hover:bg-carbon-600 text-xs font-medium transition-colors"
          >
            <Palette size={12} />
            Cargar estilo
          </button>
          <button
            onClick={handleLoadFull}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#E8E4DC] text-[#0A0A0A] hover:bg-bone-700 text-xs font-medium transition-colors"
          >
            <Download size={12} />
            Cargar todo
          </button>
        </div>
      </div>
    </div>
  )
}
