import { Image, MessageSquare, Layers, Clock } from 'lucide-react'
import { useState } from 'react'
import ImageBank from '../ImageBank/ImageBank'
import PhraseBank from '../PhraseBank/PhraseBank'
import BatchGenerator from '../BatchGenerator/BatchGenerator'
import HistoryPanel from '../History/HistoryPanel'

type Tab = 'images' | 'phrases' | 'batch' | 'history'

interface Props {
  /** Si se ve en móvil. En `lg` hacia arriba siempre se ve, mande lo que mande. */
  visibleMovil: boolean
}

const TABS: { id: Tab; icon: typeof Image; label: string }[] = [
  { id: 'images',  icon: Image,         label: 'Imágenes' },
  { id: 'phrases', icon: MessageSquare, label: 'Frases'   },
  { id: 'batch',   icon: Layers,        label: 'Lotes'    },
  { id: 'history', icon: Clock,         label: 'Historial' },
]

export default function LeftPanel({ visibleMovil }: Props) {
  const [tab, setTab] = useState<Tab>('images')

  return (
    <aside
      className={`${visibleMovil ? 'flex' : 'hidden'} lg:flex w-full lg:w-80 lg:min-w-80 flex-col bg-carbon-700 overflow-hidden`}
    >
      {/* Las pestañas van en COLUMNA en escritorio (hay 320 px de ancho y sobra
          alto) y en FILA en móvil, donde el alto es el recurso escaso: cuatro
          botones apilados se comerían 140 px de los ~600 útiles. */}
      <nav className="flex flex-row lg:flex-col gap-0.5 p-2 shrink-0 overflow-x-auto">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center justify-center lg:justify-start gap-2.5 flex-1 lg:flex-none shrink-0 px-3 py-2 rounded-lg text-xs transition-colors text-left ${
              tab === id
                ? 'bg-carbon-800 lg:bg-carbon-700 text-[#E8E4DC] border-b-2 lg:border-b-0 lg:border-l-2 border-neon-red'
                : 'text-[#E8E4DC]/70 hover:text-[#E8E4DC] hover:bg-carbon-700 border-b-2 lg:border-b-0 lg:border-l-2 border-transparent'
            }`}
          >
            <Icon size={13} className="shrink-0" />
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className={`flex-1 overflow-y-auto ${tab === 'images' ? '' : 'hidden'}`}><ImageBank /></div>
        <div className={`flex-1 overflow-y-auto ${tab === 'phrases' ? '' : 'hidden'}`}><PhraseBank /></div>
        <div className={`flex-1 overflow-y-auto ${tab === 'batch' ? '' : 'hidden'}`}><BatchGenerator /></div>
        <div className={`flex-1 overflow-hidden flex flex-col ${tab === 'history' ? '' : 'hidden'}`}><HistoryPanel active={tab === 'history'} /></div>
      </div>
    </aside>
  )
}
