import { Image, MessageSquare, Layers, Clock } from 'lucide-react'
import { useState } from 'react'
import ImageBank from '../ImageBank/ImageBank'
import PhraseBank from '../PhraseBank/PhraseBank'
import BatchGenerator from '../BatchGenerator/BatchGenerator'
import HistoryPanel from '../History/HistoryPanel'

type Tab = 'images' | 'phrases' | 'batch' | 'history'

const TABS: { id: Tab; icon: typeof Image; label: string }[] = [
  { id: 'images',  icon: Image,         label: 'Imágenes' },
  { id: 'phrases', icon: MessageSquare, label: 'Frases'   },
  { id: 'batch',   icon: Layers,        label: 'Lotes'    },
  { id: 'history', icon: Clock,         label: 'Historial' },
]

export default function LeftPanel() {
  const [tab, setTab] = useState<Tab>('images')

  return (
    <aside className="w-80 min-w-80 flex flex-col bg-carbon-700 overflow-hidden">
      {/* Tab nav */}
      <nav className="flex flex-col gap-0.5 p-2">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left ${
              tab === id
                ? 'bg-carbon-700 text-[#E8E4DC] border-l-2 border-neon-red'
                : 'text-[#E8E4DC]/70 hover:text-[#E8E4DC] hover:bg-carbon-700 border-l-2 border-transparent'
            }`}
          >
            <Icon size={13} />
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'images'  && <ImageBank />}
        {tab === 'phrases' && <PhraseBank />}
        {tab === 'batch'   && <BatchGenerator />}
        {tab === 'history' && <HistoryPanel />}
      </div>
    </aside>
  )
}
