import VideoEditor from '../VideoEditor/VideoEditor'
import { useVideoStore } from '../../store/videoStore'

interface Props {
  /** Si se ve en móvil. En `lg` hacia arriba siempre se ve. */
  visibleMovil: boolean
  className?: string
}

/**
 * El inspector: las propiedades de la pieza en edición. Generar ya no vive aquí:
 * está en el escenario, debajo del preview, que es donde se mira al decidir.
 */
export default function RightPanel({ visibleMovil, className = '' }: Props) {
  const { mode, config } = useVideoStore()
  const formato = config.resolution.height > config.resolution.width ? '9:16' : '1:1'

  return (
    <aside
      aria-label="Pieza en edición"
      className={`${visibleMovil ? 'flex' : 'hidden'} w-full shrink-0 flex-col overflow-hidden border-l border-linea bg-s1 lg:flex lg:w-[300px] ${className}`}
    >
      <header className="flex shrink-0 items-baseline justify-between border-b border-linea px-5 pb-3.5 pt-5">
        <h2 className="text-body font-medium">Pieza en edición</h2>
        <span className="font-mono text-meta text-hueso-3">
          {mode === 'video' ? `${formato} · ${config.duration} s` : formato}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <VideoEditor />
      </div>
    </aside>
  )
}
