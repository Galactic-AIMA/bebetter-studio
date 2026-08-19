import { Wand2 } from 'lucide-react'
import VideoEditor from '../VideoEditor/VideoEditor'
import { useVideoStore } from '../../store/videoStore'

interface Props {
  isGenerating: boolean
  onGenerate: () => void
  /** Si se ve en móvil. En `lg` hacia arriba siempre se ve. */
  visibleMovil: boolean
}

export default function RightPanel({ isGenerating, onGenerate, visibleMovil }: Props) {
  const { mode } = useVideoStore()

  return (
    <aside
      className={`${visibleMovil ? 'flex' : 'hidden'} lg:flex w-full lg:w-[300px] lg:min-w-[300px] flex-col bg-carbon-700 overflow-hidden`}
    >
      {/* Scrollable controls */}
      <div className="flex-1 overflow-y-auto">
        <VideoEditor />
      </div>

      {/* Botón de generar, fijo abajo. En móvil NO va aquí: vive fuera del panel
          (ver `Editor.tsx`) para poder pulsarse también desde el banco y desde el
          preview, sin tener que volver a la pestaña de ajustes. */}
      <div className="hidden lg:block p-3 bg-carbon-700">
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className="w-full flex items-center justify-center gap-2 h-11 bg-[#E8E4DC] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-[#0A0A0A] font-bold text-sm tracking-wide rounded-xl transition-colors"
        >
          <Wand2 size={15} />
          {isGenerating
            ? 'Generando...'
            : mode === 'video' ? 'Generar video' : 'Generar imagen'}
        </button>
      </div>
    </aside>
  )
}
