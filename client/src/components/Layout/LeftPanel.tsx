import { Images, Quotes, Stack, ClockCounterClockwise, type Icon } from '@phosphor-icons/react'
import ImageBank from '../ImageBank/ImageBank'
import PhraseBank from '../PhraseBank/PhraseBank'
import BatchGenerator from '../BatchGenerator/BatchGenerator'
import HistoryPanel from '../History/HistoryPanel'
import { BancoTab } from './Sidebar'

interface Props {
  tab: BancoTab
  onTab: (tab: BancoTab) => void
  /** Si se ve en móvil. En `lg` hacia arriba siempre se ve, mande lo que mande. */
  visibleMovil: boolean
  className?: string
}

const TABS: { id: BancoTab; icon: Icon; label: string }[] = [
  { id: 'phrases', icon: Quotes, label: 'Frases' },
  { id: 'images', icon: Images, label: 'Imágenes' },
  { id: 'batch', icon: Stack, label: 'Lotes' },
  { id: 'history', icon: ClockCounterClockwise, label: 'Historial' },
]

/**
 * La columna del banco: el MATERIAL de la mesa. Qué lista enseña lo decide la
 * barra lateral; aquí solo queda una fila de pestañas en móvil, donde no hay
 * barra lateral.
 */
export default function LeftPanel({ tab, onTab, visibleMovil, className = '' }: Props) {
  const actual = TABS.find((t) => t.id === tab)!

  return (
    <aside
      aria-label={`Banco: ${actual.label}`}
      className={`${visibleMovil ? 'flex' : 'hidden'} w-full shrink-0 flex-col overflow-hidden border-r border-linea bg-s1 lg:flex lg:w-[320px] xl:w-[360px] ${className}`}
    >
      <header className="hidden shrink-0 border-b border-linea px-5 pb-3.5 pt-5 lg:block">
        <h1 className="text-title font-light">{actual.label}</h1>
      </header>

      {/* Móvil: pestañas en FILA, que el alto es el recurso escaso. */}
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-linea p-2 lg:hidden" aria-label="Listas del banco">
        {TABS.map(({ id, icon: Icono, label }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex h-10 flex-1 shrink-0 items-center justify-center gap-2 rounded-control px-3 text-ui transition-colors duration-rapido ease-mesa ${
              tab === id ? 'bg-s2 text-hueso' : 'text-hueso-2 hover:text-hueso'
            }`}
          >
            <Icono size={16} className={tab === id ? 'text-oro' : ''} />
            {label}
          </button>
        ))}
      </nav>

      {/* Las cuatro listas siguen MONTADAS: cargan datos al montarse y guardan
          estado local, así que desmontarlas al cambiar recargaría el banco. */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className={`flex-1 overflow-y-auto ${tab === 'images' ? '' : 'hidden'}`}><ImageBank /></div>
        <div className={`flex-1 overflow-y-auto ${tab === 'phrases' ? '' : 'hidden'}`}><PhraseBank /></div>
        <div className={`flex-1 overflow-y-auto ${tab === 'batch' ? '' : 'hidden'}`}><BatchGenerator /></div>
        <div className={`flex flex-1 flex-col overflow-hidden ${tab === 'history' ? '' : 'hidden'}`}><HistoryPanel active={tab === 'history'} /></div>
      </div>
    </aside>
  )
}
