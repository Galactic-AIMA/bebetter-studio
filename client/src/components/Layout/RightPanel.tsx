import { Wand2 } from 'lucide-react'
import VideoEditor from '../VideoEditor/VideoEditor'
import { useVideoStore } from '../../store/videoStore'

interface Props {
  isGenerating: boolean
  onGenerate: () => void
}

export default function RightPanel({ isGenerating, onGenerate }: Props) {
  const { mode } = useVideoStore()

  return (
    <aside className="w-[300px] min-w-[300px] flex flex-col bg-carbon-800 border-l border-carbon-600 overflow-hidden">
      {/* Scrollable controls */}
      <div className="flex-1 overflow-y-auto">
        <VideoEditor />
      </div>

      {/* Sticky generate button */}
      <div className="p-3 border-t border-carbon-600 bg-carbon-800">
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className="w-full flex items-center justify-center gap-2 h-11 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 disabled:cursor-not-allowed text-carbon-900 font-semibold text-sm tracking-wide rounded-xl transition-colors"
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
