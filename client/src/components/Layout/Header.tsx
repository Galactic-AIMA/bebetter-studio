import { Film, Image, GalleryHorizontalEnd, HardDrive, Send, RotateCcw, ChevronDown, ScrollText, Clock, ListPlus, Music, BarChart3, ClipboardCheck, MoreVertical } from 'lucide-react'
import { useRef, useEffect, useState } from 'react'
import { useVideoStore } from '../../store/videoStore'
import { ContentMode } from '../../store/videoStore'
import LogsModal from '../Logs/LogsModal'
import CadenceModal from '../Cadence/CadenceModal'
import AudioTagsPanel from '../Audio/AudioTagsPanel'
import ReviewPanel from '../Review/ReviewPanel'
import { videosApi } from '../../api'

interface Props {
  lastVideoId: string | null
  lastImageId: string | null
  isGenerating: boolean
  toast: { state: 'loading' | 'success' | 'error'; message?: string } | null
  onUploadDrive: () => void
  onPublish: (env: 'test' | 'prod') => void
  onQueue: () => void
}

export default function Header({ lastVideoId, lastImageId, isGenerating, toast, onUploadDrive, onPublish, onQueue }: Props) {
  const { mode, setMode, reset } = useVideoStore()
  const [showEnvMenu, setShowEnvMenu] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [showCadence, setShowCadence] = useState(false)
  const [showAudio, setShowAudio] = useState(false)
  const [showReview, setShowReview] = useState(false)
  // Menú de desbordamiento de móvil: analítica · audio · cadencia · registro ·
  // reiniciar. En una barra de 12 px de alto y 390 de ancho no caben cinco iconos
  // MÁS el wordmark, los modos y el aviso de revisión, y encima quedan a 26 px de
  // objetivo táctil. Aquí abajo se pulsan con el pulgar y llevan etiqueta.
  const [showMas, setShowMas] = useState(false)
  // Cuántas piezas esperan revisión. Va en el Header porque un lote termina EN
  // SEGUNDO PLANO: sin este número, David no tendría forma de enterarse de que hay
  // 30 piezas esperando salvo abriendo el panel a ciegas.
  const [pendientes, setPendientes] = useState(0)
  const envMenuRef = useRef<HTMLDivElement>(null)
  const masMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envMenuRef.current && !envMenuRef.current.contains(e.target as Node)) {
        setShowEnvMenu(false)
      }
      if (masMenuRef.current && !masMenuRef.current.contains(e.target as Node)) {
        setShowMas(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const mirar = () => videosApi.pendientes().then((v) => setPendientes(v.length)).catch(() => {})
    mirar()
    // Cada minuto: un lote de 30 tarda bastante, así que el contador tiene que
    // subir solo mientras David hace otra cosa.
    const t = setInterval(mirar, 60_000)
    return () => clearInterval(t)
  }, [showReview])

  const hasResult = lastVideoId || lastImageId
  const busy = toast?.state === 'loading'

  return (
    <header className="flex items-center justify-between gap-2 px-3 sm:px-5 h-12 bg-carbon-700 shrink-0 z-10">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 select-none shrink-0">
        <img src="/favicon.svg" alt="" className="w-6 h-6" />
        {/* El wordmark completo solo cuando sobra ancho: en móvil el logo ya
            identifica la app y esos 120 px hacen falta para los modos. */}
        <div className="hidden md:flex items-center gap-0.5">
          <span className="text-sm font-semibold tracking-widest text-[#E8E4DC]">BEBETTER</span>
          <span className="text-sm font-semibold tracking-widest text-[#E8E4DC]/70 ml-1.5">STUDIO</span>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center rounded-lg overflow-hidden border border-carbon-600 text-xs">
        {([
          { id: 'video' as ContentMode, icon: Film, label: 'Video' },
          { id: 'image' as ContentMode, icon: Image, label: 'Imagen' },
          { id: 'carousel' as ContentMode, icon: GalleryHorizontalEnd, label: 'Carrusel' },
        ]).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            title={label}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 transition-colors ${
              mode === id
                ? 'bg-carbon-700 text-bone-500 border-l border-neon-red first:border-l-0'
                : 'bg-carbon-800 text-bone-700 hover:text-bone-500'
            }`}
          >
            <Icon size={13} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {hasResult && (
          <>
            <button
              onClick={onUploadDrive}
              disabled={busy}
              title="Subir a Google Drive"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-xs text-bone-700 hover:text-bone-500 border border-carbon-600 rounded-lg bg-carbon-700 hover:bg-carbon-600 disabled:opacity-40 transition-colors"
            >
              <HardDrive size={12} /> <span className="hidden sm:inline">Drive</span>
            </button>

            {lastVideoId && (
              <div ref={envMenuRef} className="relative flex">
                <button
                  onClick={() => { onPublish('prod'); setShowEnvMenu(false) }}
                  disabled={busy}
                  title="Publicar ahora"
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-xs text-carbon-900 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 rounded-l-lg transition-colors font-medium"
                >
                  <Send size={12} /> <span className="hidden sm:inline">Publicar</span>
                </button>
                <button
                  onClick={() => setShowEnvMenu(v => !v)}
                  disabled={busy}
                  className="flex items-center px-1.5 py-2 sm:py-1.5 text-xs text-carbon-900 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 border-l border-gold-600 rounded-r-lg transition-colors"
                >
                  <ChevronDown size={12} />
                </button>
                {showEnvMenu && (
                  <div className="absolute top-full right-0 mt-1 bg-carbon-700 border border-carbon-600 rounded-lg overflow-hidden z-20 min-w-max shadow-xl">
                    <button
                      onClick={() => { onQueue(); setShowEnvMenu(false) }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-bone-500 hover:bg-carbon-600 transition-colors"
                      title="Sube a R2, genera copies y encola en el Sheet; publica en la próxima franja de cadencia tras tu aprobación"
                    >
                      <ListPlus size={11} /> Enviar a la cola
                    </button>
                    <button
                      onClick={() => { onPublish('test'); setShowEnvMenu(false) }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-bone-500 hover:bg-carbon-600 transition-colors border-t border-carbon-600"
                    >
                      <Send size={11} /> Publicar en test
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Analítica: no va en el toggle de modos porque no es un modo de
            creación. Se sale de ella pulsando cualquiera de los tres. */}
        <button
          onClick={() => setMode('analytics')}
          className={`hidden lg:block p-1.5 transition-colors ${
            mode === 'analytics' ? 'text-bone-500' : 'text-bone-700 hover:text-bone-500'
          }`}
          title="Analítica — qué funcionó y con qué receta"
        >
          <BarChart3 size={14} />
        </button>

        {/* Revisión NO entra en el menú de desbordamiento: es la acción de móvil
            por excelencia (mirar el lote que salió solo) y su aviso tiene que
            verse sin abrir nada. */}
        <button
          onClick={() => setShowReview(true)}
          className="relative p-2 sm:p-1.5 text-bone-700 hover:text-bone-500 transition-colors"
          title={pendientes ? `${pendientes} pieza(s) esperando revisión` : 'Revisión del lote'}
        >
          <ClipboardCheck size={15} />
          {pendientes > 0 && (
            <span className="absolute top-0 right-0 sm:-top-0.5 sm:-right-0.5 min-w-[14px] h-[14px] px-1 flex items-center justify-center rounded-full bg-gold-500 text-carbon-900 text-[9px] font-bold tabular-nums">
              {pendientes > 99 ? '99+' : pendientes}
            </span>
          )}
        </button>

        <button
          onClick={() => setShowAudio(true)}
          className="hidden lg:block p-1.5 text-bone-700 hover:text-bone-500 transition-colors"
          title="Audio — energía y mood"
        >
          <Music size={14} />
        </button>

        <button
          onClick={() => setShowCadence(true)}
          className="hidden lg:block p-1.5 text-bone-700 hover:text-bone-500 transition-colors"
          title="Cadencia de publicación"
        >
          <Clock size={14} />
        </button>

        <button
          onClick={() => setShowLogs(true)}
          className="hidden lg:block p-1.5 text-bone-700 hover:text-bone-500 transition-colors"
          title="Registro de actividad"
        >
          <ScrollText size={14} />
        </button>

        <button
          onClick={reset}
          disabled={isGenerating}
          className="hidden lg:block p-1.5 text-bone-700 hover:text-bone-500 transition-colors"
          title="Reiniciar"
        >
          <RotateCcw size={14} />
        </button>

        {/* Lo mismo de arriba, plegado, para pantallas estrechas. */}
        <div ref={masMenuRef} className="relative lg:hidden">
          <button
            onClick={() => setShowMas((v) => !v)}
            className="p-2 text-bone-700 hover:text-bone-500 transition-colors"
            title="Más opciones"
          >
            <MoreVertical size={16} />
          </button>
          {showMas && (
            <div className="absolute top-full right-0 mt-1 bg-carbon-700 border border-carbon-600 rounded-lg overflow-hidden z-30 min-w-[190px] shadow-xl">
              {([
                { icon: BarChart3,   label: 'Analítica',  onClick: () => setMode('analytics'), disabled: false },
                { icon: Music,       label: 'Audio',      onClick: () => setShowAudio(true),   disabled: false },
                { icon: Clock,       label: 'Cadencia',   onClick: () => setShowCadence(true), disabled: false },
                { icon: ScrollText,  label: 'Registro',   onClick: () => setShowLogs(true),    disabled: false },
                { icon: RotateCcw,   label: 'Reiniciar',  onClick: reset,                      disabled: isGenerating },
              ] as const).map(({ icon: Icon, label, onClick, disabled }) => (
                <button
                  key={label}
                  onClick={() => { onClick(); setShowMas(false) }}
                  disabled={disabled}
                  className="flex items-center gap-2.5 w-full px-3 py-3 text-xs text-bone-500 hover:bg-carbon-600 disabled:opacity-40 transition-colors border-b border-carbon-600 last:border-b-0"
                >
                  <Icon size={14} className="shrink-0 text-bone-700" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showLogs && <LogsModal onClose={() => setShowLogs(false)} />}
      {showCadence && <CadenceModal onClose={() => setShowCadence(false)} />}
      {showAudio && <AudioTagsPanel onClose={() => setShowAudio(false)} />}
      {showReview && <ReviewPanel onClose={() => setShowReview(false)} />}
    </header>
  )
}
