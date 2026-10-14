import { useEffect, useState } from 'react'
import {
  VideoCamera, ImageSquare, Cards, Quotes, Images, Waveform, Stack, ClockCounterClockwise,
  FilmStrip, CalendarDots, ChartLineUp, Scroll, ArrowCounterClockwise, SignOut, List, X,
  type Icon,
} from '@phosphor-icons/react'
import { useVideoStore, ContentMode } from '../../store/videoStore'
import { videosApi, authApi } from '../../api'
import { useSesion } from '../Puerta'
import LogsModal from '../Logs/LogsModal'
import CadenceModal from '../Cadence/CadenceModal'
import AudioTagsPanel from '../Audio/AudioTagsPanel'
import ReviewPanel from '../Review/ReviewPanel'

export type BancoTab = 'images' | 'phrases' | 'batch' | 'history'

interface Props {
  bancoTab: BancoTab
  onBancoTab: (tab: BancoTab) => void
  isGenerating: boolean
  /** La sala baja la luz mientras se renderiza (DESIGN.md §7.3). */
  atenuada: boolean
}

interface Entrada {
  id: string
  label: string
  icon: Icon
  activo: boolean
  onClick: () => void
  cuenta?: number
}

/**
 * La barra lateral de «Sala de montaje» (DESIGN.md §5). Sustituye a la cabecera
 * de 2026: diez iconos sin etiqueta en una franja de 48 px y el toggle de modos.
 * Aquí todo lleva nombre y está agrupado por lo que es: crear, el banco, la
 * producción y los datos.
 *
 * Tres formas, un solo menú:
 *  - ≥1280 px: barra de 232 px con etiquetas.
 *  - 1024–1279 px: riel de 64 px, solo iconos (con aria-label y title).
 *  - <1024 px: barra superior + panel que entra desde la izquierda.
 */
export default function Sidebar({ bancoTab, onBancoTab, isGenerating, atenuada }: Props) {
  const { mode, setMode, reset } = useVideoStore()
  // null en local (no hay puerta) ⇒ no se pinta el botón de salir.
  const sesion = useSesion()
  const [modal, setModal] = useState<'logs' | 'cadencia' | 'audio' | 'revision' | null>(null)
  const [menuMovil, setMenuMovil] = useState(false)
  // Cuántas piezas esperan revisión. Un lote termina EN SEGUNDO PLANO: sin este
  // número, David no se enteraría de que hay 30 piezas esperando salvo abriendo
  // el panel a ciegas.
  const [pendientes, setPendientes] = useState(0)

  useEffect(() => {
    const mirar = () => videosApi.pendientes().then((v) => setPendientes(v.length)).catch(() => {})
    mirar()
    // Cada minuto: un lote de 30 tarda bastante, así que el contador tiene que
    // subir solo mientras David hace otra cosa.
    const t = setInterval(mirar, 60_000)
    return () => clearInterval(t)
  }, [modal])

  useEffect(() => {
    if (!menuMovil) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuMovil(false)
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [menuMovil])

  // Revisión es una pantalla completa encima del editor: mientras está abierta,
  // nada más de la barra se marca como activo.
  const enRevision = modal === 'revision'
  const editando = (mode === 'video' || mode === 'image') && !enRevision
  // Las entradas del banco abren su lista en el editor; desde carrusel o
  // analítica, primero se vuelve al editor de video.
  const abrirBanco = (tab: BancoTab) => {
    if (mode !== 'video' && mode !== 'image') setMode('video')
    onBancoTab(tab)
  }
  const modo = (m: ContentMode) => () => setMode(m)

  const grupos: { titulo?: string; entradas: Entrada[] }[] = [
    {
      entradas: [
        { id: 'video', label: 'Video', icon: VideoCamera, activo: mode === 'video' && !enRevision, onClick: modo('video') },
        { id: 'image', label: 'Imagen', icon: ImageSquare, activo: mode === 'image' && !enRevision, onClick: modo('image') },
        { id: 'carousel', label: 'Carrusel', icon: Cards, activo: mode === 'carousel' && !enRevision, onClick: modo('carousel') },
      ],
    },
    {
      titulo: 'Banco',
      entradas: [
        { id: 'phrases', label: 'Frases', icon: Quotes, activo: editando && bancoTab === 'phrases', onClick: () => abrirBanco('phrases') },
        { id: 'images', label: 'Imágenes', icon: Images, activo: editando && bancoTab === 'images', onClick: () => abrirBanco('images') },
        { id: 'audio', label: 'Audio', icon: Waveform, activo: modal === 'audio', onClick: () => setModal('audio') },
      ],
    },
    {
      titulo: 'Producción',
      entradas: [
        { id: 'batch', label: 'Lotes', icon: Stack, activo: editando && bancoTab === 'batch', onClick: () => abrirBanco('batch') },
        { id: 'revision', label: 'Revisión', icon: FilmStrip, activo: modal === 'revision', onClick: () => setModal('revision'), cuenta: pendientes },
        { id: 'history', label: 'Historial', icon: ClockCounterClockwise, activo: editando && bancoTab === 'history', onClick: () => abrirBanco('history') },
        { id: 'cadencia', label: 'Cadencia', icon: CalendarDots, activo: modal === 'cadencia', onClick: () => setModal('cadencia') },
      ],
    },
    {
      titulo: 'Datos',
      entradas: [
        { id: 'analytics', label: 'Analítica', icon: ChartLineUp, activo: mode === 'analytics' && !enRevision, onClick: modo('analytics') },
        { id: 'logs', label: 'Registro', icon: Scroll, activo: modal === 'logs', onClick: () => setModal('logs') },
      ],
    },
  ]

  /** `riel`: solo iconos entre 1024 y 1279 px. En el panel móvil siempre hay etiqueta. */
  const lista = (riel: boolean) =>
    grupos.map((g, gi) => (
      <div key={gi} className={gi ? 'mt-3' : ''}>
        {g.titulo && <p className={`rotulo px-2 pb-1.5 pt-2 ${riel ? 'hidden xl:block' : ''}`}>{g.titulo}</p>}
        {g.titulo && riel && <div className="xl:hidden mx-3 mb-2 border-t border-linea" aria-hidden />}
        {g.entradas.map((e) => (
          <button
            key={e.id}
            onClick={() => {
              e.onClick()
              // Cualquier otra entrada saca de Revisión (si no abrió ella otro panel).
              if (e.id !== 'revision') setModal((m) => (m === 'revision' ? null : m))
              setMenuMovil(false)
            }}
            aria-current={e.activo ? 'page' : undefined}
            aria-label={e.cuenta ? `${e.label}, ${e.cuenta} esperando` : e.label}
            title={riel ? e.label : undefined}
            className={`group relative flex w-full items-center gap-2.5 rounded-control px-2 text-ui transition-colors duration-rapido ease-mesa ${
              riel ? 'h-9 justify-center xl:justify-start' : 'h-11 lg:h-9'
            } ${e.activo ? 'bg-s2 text-hueso' : 'text-hueso-2 hover:bg-s2 hover:text-hueso'}`}
          >
            <e.icon size={16} weight="regular" className={`shrink-0 ${e.activo ? 'text-oro' : ''}`} />
            <span className={riel ? 'hidden xl:inline' : ''}>{e.label}</span>
            {!!e.cuenta && (
              <span
                className={`ml-auto rounded-full bg-oro px-1.5 py-0.5 font-mono text-label tracking-normal font-medium text-sala tabular-nums ${
                  riel ? 'xl:static absolute -right-0.5 -top-0.5 xl:ml-auto' : ''
                }`}
              >
                {e.cuenta > 99 ? '99+' : e.cuenta}
              </span>
            )}
          </button>
        ))}
      </div>
    ))

  const pie = (riel: boolean) => (
    <div className={`mt-auto flex gap-1 border-t border-linea pt-3 ${riel ? 'flex-col xl:flex-row' : 'flex-row'}`}>
      <button
        onClick={reset}
        disabled={isGenerating}
        aria-label="Reiniciar el editor"
        title="Reiniciar el editor"
        className="flex h-9 items-center justify-center gap-2 rounded-control px-2 text-ui text-hueso-2 transition-colors duration-rapido ease-mesa hover:bg-s2 hover:text-hueso disabled:opacity-40"
      >
        <ArrowCounterClockwise size={16} />
        <span className={riel ? 'hidden xl:inline' : ''}>Reiniciar</span>
      </button>
      {sesion?.puertaActiva && (
        <button
          onClick={() => authApi.salir()}
          aria-label={`Salir (${sesion.email ?? ''})`}
          title={`Salir (${sesion.email ?? ''})`}
          className="flex h-9 items-center justify-center gap-2 rounded-control px-2 text-ui text-hueso-2 transition-colors duration-rapido ease-mesa hover:bg-s2 hover:text-hueso xl:ml-auto"
        >
          <SignOut size={16} />
          <span className={riel ? 'hidden xl:inline' : ''}>Salir</span>
        </button>
      )}
    </div>
  )

  const marca = (
    <span className="flex items-baseline gap-2 select-none">
      <span className="font-display text-[21px] leading-none tracking-[.02em]">BEBETTER</span>
      <span className="rotulo tracking-[.24em]">Studio</span>
    </span>
  )

  return (
    <>
      {/* Escritorio: barra (xl) o riel (lg) */}
      <nav
        aria-label="Navegación principal"
        className={`hidden lg:flex w-16 xl:w-[232px] shrink-0 flex-col bg-s1 border-r border-linea px-2.5 pb-3 pt-4 overflow-y-auto transition-opacity duration-sala ease-sala ${
          atenuada ? 'opacity-30' : ''
        }`}
      >
        <div className="mb-4 px-2">
          <span className="hidden xl:inline">{marca}</span>
          <span className="xl:hidden block text-center font-display text-[21px] leading-none" aria-label="bebetter studio">B</span>
        </div>
        {lista(true)}
        {pie(true)}
      </nav>

      {/* Móvil: barra superior */}
      <header className="lg:hidden flex h-12 shrink-0 items-center gap-3 bg-s1 border-b border-linea px-2">
        <button
          onClick={() => setMenuMovil(true)}
          aria-label="Abrir el menú"
          aria-expanded={menuMovil}
          className="grid h-10 w-10 place-items-center rounded-control text-hueso-2 hover:bg-s2 hover:text-hueso"
        >
          <List size={20} />
        </button>
        {marca}
        <button
          onClick={() => setModal('revision')}
          aria-label={pendientes ? `Revisión, ${pendientes} esperando` : 'Revisión del lote'}
          className="relative ml-auto grid h-10 w-10 place-items-center rounded-control text-hueso-2 hover:bg-s2 hover:text-hueso"
        >
          <FilmStrip size={20} />
          {pendientes > 0 && (
            <span className="absolute right-0.5 top-0.5 rounded-full bg-oro px-1.5 py-0.5 font-mono text-label tracking-normal font-medium text-sala tabular-nums">
              {pendientes > 99 ? '99+' : pendientes}
            </span>
          )}
        </button>
      </header>

      {/* Móvil: el menú entra y sale por la izquierda, por donde se abrió. */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-velo transition-opacity duration-panel ease-sala ${menuMovil ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setMenuMovil(false)}
        aria-hidden={!menuMovil}
      >
        <nav
          aria-label="Menú"
          onClick={(e) => e.stopPropagation()}
          className={`flex h-full w-[280px] max-w-[85vw] flex-col bg-s1 border-r border-linea px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 transition-transform duration-panel ease-sala ${
            menuMovil ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-3 flex items-center justify-between pl-2">
            {marca}
            <button onClick={() => setMenuMovil(false)} aria-label="Cerrar el menú" className="grid h-10 w-10 place-items-center rounded-control text-hueso-2 hover:bg-s2 hover:text-hueso">
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">{lista(false)}</div>
          {pie(false)}
        </nav>
      </div>

      {modal === 'logs' && <LogsModal onClose={() => setModal(null)} />}
      {modal === 'cadencia' && <CadenceModal onClose={() => setModal(null)} />}
      {modal === 'audio' && <AudioTagsPanel onClose={() => setModal(null)} />}
      {modal === 'revision' && <ReviewPanel onClose={() => setModal(null)} />}
    </>
  )
}
