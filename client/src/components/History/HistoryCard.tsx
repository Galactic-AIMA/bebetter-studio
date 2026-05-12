import { Star } from 'lucide-react'
import { HistoryItem } from '../../types'

interface Props {
  item: HistoryItem
  onClick: () => void
  onToggleViral: (e: React.MouseEvent) => void
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function HistoryCard({ item, onClick, onToggleViral }: Props) {
  const imageId = item.config.imageId
  const thumbnailUrl = imageId ? `/api/images/file/${encodeURIComponent(imageId)}` : null
  const phrase = item.config.text.content

  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-carbon-600 transition-colors text-left group"
    >
      {/* Thumbnail */}
      <div className="shrink-0 w-12 h-12 rounded bg-carbon-600 overflow-hidden">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-carbon-600" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="text-xs text-bone-500 line-clamp-2 leading-snug">{phrase}</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-bone-700">{formatDate(item.createdAt)}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
            item.kind === 'video'
              ? 'bg-carbon-600 text-bone-700'
              : 'bg-carbon-600 text-gold-500'
          }`}>
            {item.kind === 'video' ? 'Video' : 'Img'}
          </span>
        </div>
      </div>

      {/* Viral star */}
      <button
        onClick={onToggleViral}
        className="shrink-0 p-0.5 rounded transition-colors hover:bg-carbon-600"
        title={item.viral ? 'Quitar viral' : 'Marcar viral'}
      >
        <Star
          size={13}
          className={item.viral ? 'fill-gold-500 text-gold-500' : 'text-bone-700 group-hover:text-bone-500'}
        />
      </button>
    </button>
  )
}
