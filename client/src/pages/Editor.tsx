import { useEffect, useRef, useState } from 'react'
import { Play, Queue, PaperPlaneTilt, CaretDown, GoogleDriveLogo, ArrowSquareOut, CheckCircle, WarningCircle, CircleNotch, X } from '@phosphor-icons/react'
import { useVideoStore } from '../store/videoStore'
import { videosApi, imagesOutputApi } from '../api'
import { wrapText } from '../lib/wrapText'
import { VideoRecord, ImageRecord, ImageVariant } from '../types'
import Sidebar, { BancoTab } from '../components/Layout/Sidebar'
import LeftPanel from '../components/Layout/LeftPanel'
import RightPanel from '../components/Layout/RightPanel'
import ProximasSalidas from '../components/Layout/ProximasSalidas'
import VideoPreview from '../components/Preview/VideoPreview'
import VideoResultModal from '../components/Preview/VideoResultModal'
import CarouselStudio from '../components/Carousel/CarouselStudio'
import AnalyticsPanel from '../components/Analytics/AnalyticsPanel'
import BottomNav, { Seccion } from '../components/Layout/BottomNav'

type ToastState = { state: 'loading' | 'success' | 'error'; loadingText?: string; successText?: string; message?: string }

/** Secundario de DESIGN.md §6. Se repite en la barra de resultado. */
const BTN_SECUNDARIO =
  'inline-flex h-8 items-center gap-2 rounded-control border border-borde-control px-3 text-ui text-hueso transition-colors duration-rapido ease-mesa hover:bg-s2 disabled:opacity-40'

export default function Editor() {
  const { config, selectedPhraseId, isGenerating, setGenerating, mode } = useVideoStore()
  const [lastVideo, setLastVideo] = useState<VideoRecord | null>(null)
  const [lastImage, setLastImage] = useState<ImageRecord | null>(null)
  const [imageVariant, setImageVariant] = useState<ImageVariant>('combined')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [showVideoPreview, setShowVideoPreview] = useState(false)
  const [menuPublicar, setMenuPublicar] = useState(false)
  const menuPublicarRef = useRef<HTMLDivElement>(null)
  // Qué lista ocupa la columna del banco. Antes eran pestañas dentro del panel;
  // ahora la elige la barra lateral (y en móvil, la fila de pestañas del banco).
  const [bancoTab, setBancoTab] = useState<BancoTab>('images')
  // Qué panel se ve EN MÓVIL. En escritorio se ven los tres y este estado no pinta
  // nada (las clases `lg:` mandan). Arranca en 'vista' porque el preview es lo que
  // da sentido a todo lo demás.
  const [seccion, setSeccion] = useState<Seccion>('vista')

  const hasDelimiter = config.text.content.includes('//')

  useEffect(() => {
    if (!menuPublicar) return
    const fuera = (e: MouseEvent) => {
      if (menuPublicarRef.current && !menuPublicarRef.current.contains(e.target as Node)) setMenuPublicar(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [menuPublicar])

  const computeWrappedLines = (): string[] => {
    const { text, resolution } = config
    return wrapText({
      text: text.content,
      font: text.font,
      fontSize: text.fontSize,
      maxWidth: text.maxWidth,
      resolutionWidth: resolution.width,
    })
  }

  const generate = async () => {
    if (isGenerating) return
    if (!config.imageId) { setError('Elige una imagen primero.'); return }
    setError(null)
    setShowVideoPreview(false)
    setGenerating(true)
    try {
      if (mode === 'video') {
        const video = await videosApi.generate({ ...config, wrappedLines: computeWrappedLines() }, selectedPhraseId ?? undefined)
        setLastVideo(video)
        setLastImage(null)
      } else {
        // Sin `//` el servidor usa estas líneas (con la división por tiempos);
        // con `//` mantiene su propio layout de hook/punchline a 35% y 70%.
        const imgConfig = { imageId: config.imageId, imagePath: config.imagePath, text: config.text, resolution: config.resolution, watermark: config.watermark, source: config.source || undefined, wrappedLines: hasDelimiter ? undefined : computeWrappedLines() }
        const variant = hasDelimiter ? imageVariant : 'combined'
        const image = await imagesOutputApi.generate(imgConfig, selectedPhraseId ?? undefined, variant)
        setLastImage(image)
        setLastVideo(null)
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setGenerating(false)
    }
  }

  // G genera, como en la mesa (DESIGN.md §7). No mientras se escribe en un campo.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'g' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (mode === 'video' || mode === 'image') generate()
    }
    addEventListener('keydown', tecla)
    return () => removeEventListener('keydown', tecla)
  })

  const uploadToDrive = async () => {
    setToast({ state: 'loading', loadingText: 'Subiendo a Drive…', successText: 'Subido a Drive' })
    try {
      if (lastVideo) {
        const { driveUrl } = await videosApi.uploadToDrive(lastVideo.id)
        setLastVideo({ ...lastVideo, driveUrl })
      } else if (lastImage) {
        const { driveUrl } = await imagesOutputApi.uploadToDrive(lastImage.id)
        setLastImage({ ...lastImage, driveUrl })
      }
      setToast({ state: 'success', successText: 'Subido a Drive' })
      setTimeout(() => setToast(null), 4000)
    } catch (e: any) {
      setToast({ state: 'error', message: e.response?.data?.error || e.message })
    }
  }

  const publish = async (env: 'test' | 'prod') => {
    setMenuPublicar(false)
    if (!lastVideo) return
    const donde = env === 'prod' ? 'producción' : 'test'
    setToast({ state: 'loading', loadingText: `Publicando en ${donde}…`, successText: `Publicado en ${donde}` })
    try {
      await videosApi.publish(lastVideo.id, env)
      setToast({ state: 'success', successText: `Publicado en ${donde}` })
      setTimeout(() => setToast(null), 4000)
    } catch (e: any) {
      setToast({ state: 'error', message: e.response?.data?.error || e.message })
    }
  }

  // Cola: sube a R2, genera copies (con hashtags) y escribe la fila en el Sheet;
  // [Sched] lo publica en la próxima franja de la cadencia.
  const queueVideo = async () => {
    if (!lastVideo) return
    setToast({ state: 'loading', loadingText: 'Enviando a la cola…', successText: 'En la cola' })
    try {
      await videosApi.queue(lastVideo.id)
      setToast({ state: 'success', successText: 'En la cola' })
      setTimeout(() => setToast(null), 4000)
    } catch (e: any) {
      setToast({ state: 'error', message: e.response?.data?.error || e.message })
    }
  }

  const ocupado = toast?.state === 'loading'
  const editando = mode === 'video' || mode === 'image'
  // La sala baja la luz mientras se renderiza: todo menos el escenario se atenúa,
  // sin bloquearse (DESIGN.md §7.3).
  const atenuar = `transition-opacity duration-sala ease-sala ${isGenerating ? 'opacity-30' : ''}`

  // `h-[100dvh]` y no `h-screen`: en el móvil `100vh` mide la ventana SIN la barra
  // de direcciones, así que la barra inferior quedaba por debajo del borde visible.
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-sala text-hueso lg:flex-row">
      <Sidebar bancoTab={bancoTab} onBancoTab={setBancoTab} isGenerating={isGenerating} atenuada={isGenerating} />

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {mode === 'analytics' ? (
          <main className="min-w-0 flex-1 overflow-hidden">
            <AnalyticsPanel />
          </main>
        ) : mode === 'carousel' ? (
          <main className="min-w-0 flex-1 overflow-hidden">
            <CarouselStudio />
          </main>
        ) : (
          <>
            <LeftPanel tab={bancoTab} onTab={setBancoTab} visibleMovil={seccion === 'banco'} className={atenuar} />

            {/* ───── Escenario: la sala a oscuras donde manda el preview ───── */}
            <main
              className={`${seccion === 'vista' ? 'flex' : 'hidden'} relative min-w-0 flex-1 flex-col overflow-hidden lg:flex`}
            >
              <div className="luz-proyector encender pointer-events-none absolute inset-0" aria-hidden />
              <div className="grano absolute inset-0" aria-hidden />

              <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 pb-3 pt-4 lg:px-6 lg:pt-6">
                {mode === 'image' && hasDelimiter && (
                  <div className="flex gap-1.5" role="group" aria-label="Variante de la imagen">
                    {(['combined', 'hook', 'punchline'] as ImageVariant[]).map((v) => (
                      <button
                        key={v}
                        onClick={() => setImageVariant(v)}
                        aria-pressed={imageVariant === v}
                        className={`h-7 rounded-control border px-2.5 text-ui transition-colors duration-rapido ease-mesa ${
                          imageVariant === v ? 'border-linea-2 bg-s2 text-hueso' : 'border-dashed border-borde-control text-hueso-2 hover:text-hueso'
                        }`}
                      >
                        {v === 'combined' ? 'Combinada' : v === 'hook' ? 'Solo primer tiempo' : 'Solo giro'}
                      </button>
                    ))}
                  </div>
                )}

                {/* El preview: una promesa sobre el MP4 (DESIGN.md §6). */}
                <div
                  className="encender min-h-0 w-full max-w-full flex-1 lg:max-h-[620px]"
                  style={{ aspectRatio: `${config.resolution.width}/${config.resolution.height}`, maxWidth: '100%' }}
                >
                  <VideoPreview config={config} />
                </div>

                {/* Generar: el único botón relleno de la pantalla. `relative z-10` para
                    quedar por ENCIMA de la sombra del preview (120 px de desenfoque). */}
                <button
                  onClick={generate}
                  disabled={isGenerating}
                  className="relative z-10 hidden h-12 shrink-0 items-center gap-3 rounded-full bg-sangre px-7 text-[15px] font-medium text-hueso shadow-[0_10px_40px_-12px_rgb(139_26_26/.9),inset_0_1px_0_rgb(255_255_255/.1)] transition-[background-color,transform] duration-rapido ease-mesa hover:bg-sangre-hover active:scale-[.98] disabled:cursor-progress lg:inline-flex"
                >
                  <span className={`h-2.5 w-2.5 rounded-full bg-hueso ${isGenerating ? 'latido' : ''}`} aria-hidden />
                  {isGenerating ? 'Renderizando' : mode === 'video' ? 'Generar reel' : 'Generar imagen'}
                  {!isGenerating && (
                    <kbd className="rounded-[4px] border border-hueso/20 bg-sala/20 px-1.5 py-0.5 font-mono text-label tracking-normal">G</kbd>
                  )}
                </button>

                {error && (
                  <p role="alert" className="flex max-w-md items-center gap-2 text-ui text-lacre">
                    <WarningCircle size={16} className="shrink-0" /> {error}
                  </p>
                )}

                {/* Lo que se hace con la pieza recién salida. Todo secundario: el
                    relleno es solo para Generar. */}
                {lastVideo && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button onClick={() => setShowVideoPreview(true)} className={BTN_SECUNDARIO}>
                      <Play size={14} /> Ver reel
                    </button>
                    <button onClick={queueVideo} disabled={ocupado} className={BTN_SECUNDARIO}>
                      <Queue size={14} /> Enviar a la cola
                    </button>
                    <div ref={menuPublicarRef} className="relative">
                      <button
                        onClick={() => setMenuPublicar((v) => !v)}
                        disabled={ocupado}
                        aria-expanded={menuPublicar}
                        aria-haspopup="menu"
                        className={BTN_SECUNDARIO}
                      >
                        <PaperPlaneTilt size={14} /> Publicar ahora <CaretDown size={12} className="text-hueso-2" />
                      </button>
                      {menuPublicar && (
                        <div role="menu" className="absolute bottom-full left-0 z-20 mb-1.5 min-w-full overflow-hidden rounded-panel border border-linea-2 bg-s2 py-1 shadow-[0_20px_40px_-12px_rgb(0_0_0/.8)]">
                          <button role="menuitem" onClick={() => publish('prod')} className="block w-full whitespace-nowrap px-3 py-2 text-left text-ui hover:bg-s3">
                            En producción
                          </button>
                          <button role="menuitem" onClick={() => publish('test')} className="block w-full whitespace-nowrap px-3 py-2 text-left text-ui text-hueso-2 hover:bg-s3 hover:text-hueso">
                            En test
                          </button>
                        </div>
                      )}
                    </div>
                    <button onClick={uploadToDrive} disabled={ocupado} className={BTN_SECUNDARIO}>
                      <GoogleDriveLogo size={14} /> Drive
                    </button>
                  </div>
                )}
                {lastImage && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <a href={lastImage.publicUrl} target="_blank" rel="noreferrer" className={BTN_SECUNDARIO}>
                      <ArrowSquareOut size={14} /> Abrir imagen
                    </a>
                    <button onClick={uploadToDrive} disabled={ocupado} className={BTN_SECUNDARIO}>
                      <GoogleDriveLogo size={14} /> Drive
                    </button>
                  </div>
                )}
              </div>

              <div className={`relative z-10 hidden shrink-0 px-6 pb-4 lg:block ${atenuar}`}>
                <ProximasSalidas />
              </div>
            </main>

            <RightPanel visibleMovil={seccion === 'ajustes'} className={atenuar} />
          </>
        )}
      </div>

      {/* Móvil: generar y navegar. Solo en los modos de edición: carrusel y
          analítica ocupan la pantalla entera y no tienen paneles que alternar. */}
      {editando && (
        <>
          <div className="shrink-0 border-t border-linea bg-s1 px-3 py-2 lg:hidden">
            <button
              onClick={generate}
              disabled={isGenerating}
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-full bg-sangre text-[15px] font-medium text-hueso transition-colors duration-rapido ease-mesa hover:bg-sangre-hover active:scale-[.98] disabled:cursor-progress"
            >
              <span className={`h-2.5 w-2.5 rounded-full bg-hueso ${isGenerating ? 'latido' : ''}`} aria-hidden />
              {isGenerating ? 'Renderizando' : mode === 'video' ? 'Generar reel' : 'Generar imagen'}
            </button>
          </div>
          <BottomNav seccion={seccion} onSeccion={setSeccion} />
        </>
      )}

      {/* Aviso: abajo y al centro, sobre el escenario. Iconos, no ✓ ✗. */}
      {toast && (
        <div
          role={toast.state === 'error' ? 'alert' : 'status'}
          className={`fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2.5 rounded-panel border bg-s2 px-4 py-3 text-ui shadow-[0_20px_50px_-12px_rgb(0_0_0/.85)] lg:bottom-6 ${
            toast.state === 'error' ? 'border-lacre/40 text-lacre' : 'border-linea-2 text-hueso'
          }`}
        >
          {toast.state === 'loading' && <CircleNotch size={16} className="shrink-0 animate-spin" />}
          {toast.state === 'success' && <CheckCircle size={16} className="shrink-0 text-oro" />}
          {toast.state === 'error' && <WarningCircle size={16} className="shrink-0" />}
          <span>
            {toast.state === 'loading' && toast.loadingText}
            {toast.state === 'success' && toast.successText}
            {toast.state === 'error' && (toast.message || 'Algo falló.')}
          </span>
          {toast.state === 'error' && (
            <button onClick={() => setToast(null)} aria-label="Cerrar el aviso" className="-mr-1 ml-1 grid h-7 w-7 place-items-center rounded-control text-hueso-2 hover:bg-s3 hover:text-hueso">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Preview del video generado, sin salir del UI */}
      {showVideoPreview && lastVideo && (
        <VideoResultModal
          src={lastVideo.publicUrl}
          filename={lastVideo.filename}
          onClose={() => setShowVideoPreview(false)}
        />
      )}
    </div>
  )
}
