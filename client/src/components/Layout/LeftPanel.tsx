import { Image, MessageSquare, Layers } from 'lucide-react'
import { useState } from 'react'
import ImageBank from '../ImageBank/ImageBank'
import PhraseBank from '../PhraseBank/PhraseBank'
import BatchGenerator from '../BatchGenerator/BatchGenerator'

type Tab = 'images' | 'phrases' | 'batch'

const TABS: { id: Tab; icon: typeof Image; label: string }[] = [
  { id: 'images',  icon: Image,         label: 'Imágenes' },
  { id: 'phrases', icon: MessageSquare, label: 'Frases'   },
  { id: 'batch',   icon: Layers,        label: 'Lotes'    },
]

export default function LeftPanel() {
  const [tab, setTab] = useState<Tab>('images')

  return (
    <aside className="w-60 min-w-60 flex flex-col bg-carbon-800 border-r border-carbon-600 overflow-hidden">
      {/* Tab nav */}
      <nav className="flex flex-col gap-0.5 p-2 border-b border-carbon-600">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left ${
              tab === id
                ? 'bg-carbon-700 text-bone-500 border-l-2 border-neon-red'
                : 'text-bone-700 hover:text-bone-500 hover:bg-carbon-700 border-l-2 border-transparent'
            }`}
          >
            <Icon size={13} />
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'images'  && <ImageBank />}
        {tab === 'phrases' && <PhraseBank />}
        {tab === 'batch'   && <BatchGenerator />}
      </div>
    </aside>
  )
}
