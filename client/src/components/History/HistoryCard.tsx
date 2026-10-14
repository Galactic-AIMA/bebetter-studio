import { Star } from '@phosphor-icons/react'
import { splitByTiempos } from '@shared/splitByTiempos'
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

/** Fila del historial. Dos botones hermanos (abrir · viral): antes la estrella era
 *  un botón DENTRO de otro, que el HTML no permite. */
export default function HistoryCard({ item, onClick, onToggleViral }: Props) {
  const imageId = item.config.imageId
  const thumbnailUrl = imageId ? `/api/images/file/${encodeURIComponent(imageId)}` : null
  const [a, b] = splitByTiempos(item.config.text.content)

  return (
    <li className="group flex items-start border-b border-linea transition-colors duration-rapido ease-mesa hover:bg-s2">
      <button onClick={onClick} className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-5 text-left">
        <span className="h-16 w-9 shrink-0 overflow-hidden rounded-control border border-linea-2 bg-s2">
          {thumbnailUrl && <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 text-ui text-hueso">
            {a}
            {b && <><span aria-hidden="true" className="mx-1 font-mono text-meta text-lacre">//</span><span className="text-hueso-2">{b}</span></>}
          </span>
          <span className="font-mono text-meta text-hueso-3">
            {formatDate(item.createdAt)} · {item.kind === 'video' ? 'video' : 'imagen'}
          </span>
        </span>
      </button>
      <button
        onClick={onToggleViral}
        aria-pressed={!!item.viral}
        aria-label={item.viral ? 'Quitar de virales' : 'Marcar como viral'}
        className="btn-fantasma shrink-0 px-4 py-3"
      >
        <Star size={16} weight={item.viral ? 'fill' : 'regular'} className={item.viral ? 'text-oro' : ''} />
      </button>
    </li>
  )
}
