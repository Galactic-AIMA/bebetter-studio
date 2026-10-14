import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Sparkle, ArrowsClockwise, CaretLeft, WarningCircle, Check, Stop, Play, PaperPlaneTilt, Queue, Trash,
} from '@phosphor-icons/react'
import { carouselsApi, Carousel, CarouselSlide, SlideRole, CarouselFuente } from '../../api'
import SlideViewer from './SlideViewer'
import CarouselQueue from './CarouselQueue'
import { Segmentos, Interruptor } from '../ui/mesa'

type Phase = 'input' | 'script' | 'work'
type Tipo = 'narrativo' | 'serie'

const ROLE_LABEL: Record<SlideRole, string> = {
  portada: 'Portada',
  desarrollo: 'Desarrollo',
  historia: 'Historia',
  cta: 'Cierre (CTA)',
}

const ASPECTS: { value: string; label: string }[] = [
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
]

export default function CarouselStudio() {
  const [phase, setPhase] = useState<Phase>('input')
  const [tema, setTema] = useState('')
  const [tipo, setTipo] = useState<Tipo>('narrativo')
  const [nSlides, setNSlides] = useState(6)
  const [aspect, setAspect] = useState('4:5')
  // Atribución + marca de serie (p. ej. Robert Greene · Las 48 Leyes del Poder · LEY 15)
  const [autor, setAutor] = useState('')
  const [obra, setObra] = useState('')
  const [referencia, setReferencia] = useState('')
  const [conHistoria, setConHistoria] = useState(true)

  const [slides, setSlides] = useState<CarouselSlide[]>([])
  const [carousel, setCarousel] = useState<Carousel | null>(null)

  const [loadingScript, setLoadingScript] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatingN, setGeneratingN] = useState<number | null>(null)
  const [slideErrors, setSlideErrors] = useState<Record<number, string>>({})
  const stopRef = useRef(false) // señal para detener la cola entre slides
  const [stopping, setStopping] = useState(false)
  const [paused, setPaused] = useState(false)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null) // slide abierta en grande
  const [queueing, setQueueing] = useState(false)
  const [queuedEta, setQueuedEta] = useState<string | null>(null) // '' = encolado sin fecha
  const [publishing, setPublishing] = useState(false)
  const [publishedOk, setPublishedOk] = useState(false)
  const [history, setHistory] = useState<Carousel[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Borrador del formulario, guardado al abrir un carrusel del historial: abrirlo
  // pisa los campos (tema, atribución…), así que se restaura al pulsar "Volver".
  const draftRef = useRef<{
    tema: string
    tipo: Tipo
    nSlides: number
    aspect: string
    autor: string
    obra: string
    referencia: string
    conHistoria: boolean
  } | null>(null)

  const aspectRatio = aspect === '1:1' ? '1 / 1' : '4 / 5'
  const hasTema = tema.trim().length >= 3

  // Condiciones para poder publicar/encolar (Instagram: entre 2 y 10 imágenes)
  const nSlidesCarousel = carousel?.slides.length ?? 0
  const tooManySlides = nSlidesCarousel > 10
  const canPublish =
    !!carousel &&
    generatingN === null &&
    nSlidesCarousel >= 2 &&
    !tooManySlides &&
    carousel.slides.every((s) => s.publicUrl)

  // ── Historial: carruseles ya generados (persisten en la DB) ────────────────
  const loadHistory = useCallback(() => {
    setLoadingHistory(true)
    carouselsApi
      .list()
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false))
  }, [])

  // Recarga la lista al entrar (o volver) a la pantalla inicial
  useEffect(() => {
    if (phase === 'input') loadHistory()
  }, [phase, loadHistory])

  // Abre un carrusel guardado en la vista de trabajo (ver slides, regenerar, encolar)
  const openCarousel = (c: Carousel) => {
    draftRef.current = { tema, tipo, nSlides, aspect, autor, obra, referencia, conHistoria }
    setCarousel(c)
    setTema(c.tema)
    setTipo(c.tipo)
    setAspect(c.aspect || '4:5')
    setAutor(c.fuente?.autor ?? '')
    setObra(c.fuente?.obra ?? '')
    setReferencia(c.fuente?.referencia ?? '')
    setSlides(c.slides)
    setQueuedEta(c.status === 'queued' ? '' : null)
    setPublishedOk(c.status === 'published')
    setSlideErrors({})
    setError(null)
    setPaused(false)
    setPhase('work')
  }

  const removeCarousel = async (id: string) => {
    try {
      await carouselsApi.remove(id)
      setHistory((prev) => prev.filter((c) => c.id !== id))
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    }
  }

  const fuente = (): CarouselFuente | undefined => {
    const f = { autor: autor.trim(), obra: obra.trim(), referencia: referencia.trim() }
    return f.autor || f.obra || f.referencia ? f : undefined
  }

  // ── Paso 1: guion (no gasta créditos) ──────────────────────────────────────
  const planScript = async () => {
    if (!hasTema) return
    setLoadingScript(true)
    setError(null)
    try {
      const s = await carouselsApi.script(tema.trim(), tipo, nSlides, fuente(), conHistoria)
      setSlides(s)
      setPhase('script')
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setLoadingScript(false)
    }
  }

  const editSlideText = (n: number, texto: string) =>
    setSlides((prev) => prev.map((s) => (s.n === n ? { ...s, texto } : s)))

  const editSlideSimbolo = (n: number, simbolo: string) =>
    setSlides((prev) => prev.map((s) => (s.n === n ? { ...s, simbolo } : s)))

  // ── Paso 2: crear el registro y generar las slides en serie ────────────────
  const createAndGenerate = async () => {
    setError(null)
    setSlideErrors({})
    try {
      const c = await carouselsApi.create(tema.trim(), tipo, aspect, slides, fuente())
      setCarousel(c)
      setPhase('work')
      await runQueue(c, c.slides)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    }
  }

  // Genera una lista de slides en orden (portada primero = referencia de las demás).
  // Detenible: consulta stopRef ANTES de cada slide; la que ya arrancó se completa
  // (KIE ya la cobró), pero no arranca las siguientes → deja la cola en pausa.
  const runQueue = async (c: Carousel, targets: CarouselSlide[]) => {
    stopRef.current = false
    setStopping(false)
    setPaused(false)
    for (const slide of targets) {
      if (stopRef.current) {
        setPaused(true)
        break
      }
      setGeneratingN(slide.n)
      try {
        const { url } = await carouselsApi.generateSlide(c.id, slide.n)
        setCarousel((prev) =>
          prev ? { ...prev, slides: prev.slides.map((s) => (s.n === slide.n ? { ...s, publicUrl: url } : s)) } : prev
        )
        setSlideErrors((prev) => {
          const { [slide.n]: _, ...rest } = prev
          return rest
        })
      } catch (e: any) {
        const msg = e?.response?.data?.error || e.message
        setSlideErrors((prev) => ({ ...prev, [slide.n]: msg }))
        // Si falla la PORTADA, las demás no pueden generarse (la usan como referencia).
        if (slide.n === c.slides[0].n) {
          setError('Falló la portada; se usa como referencia para el resto. Reintenta la portada.')
          break
        }
      }
    }
    setGeneratingN(null)
    setStopping(false)
  }

  // Detiene la cola: la slide en curso se completa; no arrancan las siguientes.
  const stopQueue = () => {
    stopRef.current = true
    setStopping(true)
  }

  // Reanuda desde las slides que aún no se han generado.
  const resumeQueue = () => {
    if (!carousel) return
    const pending = carousel.slides.filter((s) => !s.publicUrl)
    if (pending.length) runQueue(carousel, pending)
  }

  const regenerateSlide = async (n: number) => {
    if (!carousel || generatingN !== null) return
    setGeneratingN(n)
    setSlideErrors((prev) => {
      const { [n]: _, ...rest } = prev
      return rest
    })
    try {
      const { url } = await carouselsApi.generateSlide(carousel.id, n)
      setCarousel((prev) =>
        prev ? { ...prev, slides: prev.slides.map((s) => (s.n === n ? { ...s, publicUrl: url } : s)) } : prev
      )
    } catch (e: any) {
      setSlideErrors((prev) => ({ ...prev, [n]: e?.response?.data?.error || e.message }))
    } finally {
      setGeneratingN(null)
    }
  }

  // Encola el carrusel: sube las slides a R2, genera el caption y escribe la fila
  // en la cola. El scheduler de n8n lo publica en Instagram en su franja.
  const queueCarousel = async () => {
    if (!carousel) return
    setQueueing(true)
    setError(null)
    try {
      await carouselsApi.queue(carousel.id)
      // Consulta cuándo saldría (proyección de la cola)
      let eta = ''
      try {
        const up = await carouselsApi.upcoming()
        const mine = up.items.find((i) => i.carouselId === carousel.id)
        if (mine?.etaIso) {
          eta = new Date(mine.etaIso).toLocaleString('es-CO', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: up.timezone,
          })
        }
      } catch {
        /* la proyección es informativa; encolar ya funcionó */
      }
      setQueuedEta(eta)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setQueueing(false)
    }
  }

  // Carril express: publica en Instagram ahora mismo.
  const publishNow = async () => {
    if (!carousel) return
    setPublishing(true)
    setError(null)
    try {
      await carouselsApi.publish(carousel.id)
      setPublishedOk(true)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setPublishing(false)
    }
  }

  // Deja la pantalla inicial limpia (sin carrusel abierto ni guion a medias).
  const resetWorkState = () => {
    stopRef.current = false
    setQueuedEta(null)
    setPublishedOk(false)
    setSlides([])
    setCarousel(null)
    setError(null)
    setSlideErrors({})
    setGeneratingN(null)
    setPaused(false)
    setStopping(false)
    setViewerIdx(null)
    setPhase('input')
  }

  // Empezar de cero: además de cerrar el carrusel, vacía el tema y la atribución
  // (el tipo, el nº de slides y el formato se conservan como preferencias).
  const startOver = () => {
    draftRef.current = null
    setTema('')
    setAutor('')
    setObra('')
    setReferencia('')
    resetWorkState()
  }

  // Volver a la pantalla inicial SIN perder lo que hubiera escrito antes de
  // entrar a un carrusel del historial.
  const backToStart = () => {
    const d = draftRef.current
    if (d) {
      setTema(d.tema)
      setTipo(d.tipo)
      setNSlides(d.nSlides)
      setAspect(d.aspect)
      setAutor(d.autor)
      setObra(d.obra)
      setReferencia(d.referencia)
      setConHistoria(d.conHistoria)
      draftRef.current = null
    }
    resetWorkState()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const faltan = carousel ? carousel.slides.filter((s) => !s.publicUrl).length : 0
  // Etiqueta de rol: la portada y el cierre se marcan con luz; el resto, apagado.
  const rolClase = (rol: SlideRole) => (rol === 'portada' || rol === 'cta' ? 'text-oro' : 'text-hueso-3')

  return (
    <div className="h-full w-full overflow-y-auto px-4 py-5 sm:px-8 sm:py-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 text-title font-light text-hueso">Carrusel</h1>
        <p className="mb-6 max-w-[80ch] text-ui text-hueso-2">
          Cada slide es una imagen completa con el texto ya integrado y coherente con las demás. Primero se
          planifica el guion, que es gratis, y lo apruebas antes de gastar créditos.
          <span className="mt-1 block font-mono text-meta text-hueso-3">KIE · Nano Banana Pro · ~$0,09 por slide</span>
        </p>

        {error && (
          <p role="alert" className="mb-4 flex items-start gap-1.5 text-ui text-lacre">
            <WarningCircle size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {/* ── FASE INPUT ── */}
        {phase === 'input' && (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tema-carrusel" className="text-ui text-hueso-3">Tema o material fuente</label>
              <textarea
                id="tema-carrusel"
                value={tema}
                onChange={(e) => setTema(e.target.value)}
                rows={4}
                placeholder="Un tema («la paciencia») o material completo: un capítulo, el resumen de un vídeo, una escena. Cuanta más sustancia, más concretas salen las slides."
                className="campo resize-y"
              />
            </div>

            {/* Atribución + marca de serie */}
            <div className="flex flex-col gap-2 border-t border-linea pt-5">
              <span className="rotulo">Referencia · opcional</span>
              <p className="text-ui text-hueso-3">
                Da autoridad y convierte varios carruseles en una <span className="text-hueso-2">serie</span>. Sale
                solo en la portada y el cierre, discreta.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input value={autor} onChange={(e) => setAutor(e.target.value)} aria-label="Autor" placeholder="Autor: Robert Greene" className="campo" />
                <input value={obra} onChange={(e) => setObra(e.target.value)} aria-label="Obra" placeholder="Obra: Las 48 leyes del poder" className="campo" />
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} aria-label="Serie" placeholder="Serie: LEY 15" className="campo" />
              </div>
              <Interruptor label="Incluir una slide con el caso o la historia del material" checked={conHistoria} onChange={setConHistoria} />
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-linea pt-5 sm:grid-cols-3">
              <Segmentos
                label="Tipo"
                value={tipo}
                onChange={setTipo}
                options={[{ value: 'narrativo', label: 'Narrativo' }, { value: 'serie', label: 'Serie de frases' }]}
              />
              <Segmentos
                label="Slides"
                value={String(nSlides)}
                onChange={(v) => setNSlides(Number(v))}
                options={[5, 6, 7, 8].map((n) => ({ value: String(n), label: <span className="font-mono">{n}</span> }))}
              />
              <Segmentos label="Formato" value={aspect} onChange={setAspect} options={ASPECTS} />
            </div>

            <button onClick={planScript} disabled={!hasTema || loadingScript} className="btn-sec self-start border-hueso px-4">
              <Sparkle size={16} />
              {loadingScript ? 'Planificando…' : 'Planificar guion'}
            </button>
          </section>
        )}

        {/* ── Cola de publicación + cadencia semanal (pantalla inicial) ── */}
        {phase === 'input' && <CarouselQueue />}

        {/* ── Historial de carruseles (siempre visible en la pantalla inicial) ── */}
        {phase === 'input' && (
          <section className="mt-8 border-t border-linea pt-5">
            <header className="mb-3 flex items-center gap-2">
              <h2 className="rotulo">Carruseles anteriores</h2>
              {history.length > 0 && <span className="font-mono text-meta tabular-nums text-hueso-3">{history.length}</span>}
              <button onClick={loadHistory} disabled={loadingHistory} className="btn-fantasma ml-auto h-10 px-1 lg:h-8">
                <ArrowsClockwise size={16} /> Actualizar
              </button>
            </header>

            {loadingHistory && !history.length ? (
              <p className="text-ui text-hueso-3">Cargando los carruseles…</p>
            ) : !history.length ? (
              <div className="flex flex-col items-start gap-3 py-8">
                <p className="pt-[.16em] font-display text-display uppercase text-hueso">Sin carruseles</p>
                <p className="text-body text-hueso-2">Los que generes aparecerán aquí, para abrirlos, rehacer slides o encolarlos.</p>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {history.map((c) => {
                  const cover = c.slides.find((s) => s.publicUrl)?.publicUrl
                  const hechas = c.slides.filter((s) => s.publicUrl).length
                  return (
                    <li key={c.id} className="group relative">
                      <button onClick={() => openCarousel(c)} className="w-full text-left" title="Abrir este carrusel">
                        <span className="relative block overflow-hidden rounded-control border border-linea-2 bg-s2 transition-colors duration-rapido ease-mesa group-hover:border-borde-control" style={{ aspectRatio: '4 / 5' }}>
                          {cover ? (
                            <img src={cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                          ) : (
                            <span className="grid h-full w-full place-items-center text-meta text-hueso-3">sin imágenes</span>
                          )}
                          <span className="absolute left-1.5 top-1.5 rounded-[4px] bg-velo px-1 font-mono text-label tracking-normal text-hueso">
                            {hechas}/{c.slides.length}
                          </span>
                          {(c.status === 'queued' || c.status === 'published') && (
                            <span className="absolute right-1.5 top-1.5 rounded-[4px] bg-velo px-1 font-mono text-label tracking-normal text-oro">
                              {c.status === 'queued' ? 'en cola' : 'publicado'}
                            </span>
                          )}
                        </span>
                        <span className="block pt-2">
                          {c.fuente?.referencia && <span className="block font-mono text-meta text-hueso-3">{c.fuente.referencia}</span>}
                          <span className="line-clamp-2 block text-ui text-hueso">{c.tema}</span>
                          <span className="block font-mono text-meta text-hueso-3">
                            {new Date(c.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => removeCarousel(c.id)}
                        aria-label={`Borrar el carrusel «${c.tema.slice(0, 40)}»`}
                        title="Borrar carrusel"
                        className="absolute right-1.5 top-9 grid h-8 w-8 place-items-center rounded-control bg-velo text-hueso-2 opacity-100 transition-opacity duration-rapido ease-mesa hover:text-lacre focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                      >
                        <Trash size={16} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {/* ── FASE SCRIPT (guion editable) ── */}
        {phase === 'script' && (
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <button onClick={() => setPhase('input')} className="btn-fantasma h-10 lg:h-8">
                <CaretLeft size={16} /> Cambiar tema
              </button>
              <button onClick={planScript} disabled={loadingScript} className="btn-fantasma h-10 lg:h-8">
                <ArrowsClockwise size={16} /> {loadingScript ? 'Reproponiendo…' : 'Reproponer guion'}
              </button>
            </div>

            <p className="text-ui text-hueso-2">
              Revisa y edita el texto de cada slide. Al generar se cobra cerca de <span className="font-mono">$0,09</span> por slide.
            </p>

            <ol className="flex flex-col">
              {slides.map((s) => (
                <li key={s.n} className="flex flex-col gap-2 border-b border-linea py-4 first:pt-0">
                  <span className="flex items-baseline gap-2 font-mono text-meta">
                    <span className="text-hueso-3">#{s.n}</span>
                    <span className={rolClase(s.rol)}>{ROLE_LABEL[s.rol]}</span>
                  </span>
                  <textarea
                    value={s.texto}
                    onChange={(e) => editSlideText(s.n, e.target.value)}
                    aria-label={`Texto de la slide ${s.n}`}
                    rows={2}
                    className="campo resize-y"
                  />
                  <label className="flex items-center gap-2">
                    <span className="shrink-0 text-ui text-hueso-3" title="Escena visual de la slide, en inglés. Cada slide usa una distinta para no repetir imagen.">Escena</span>
                    <input
                      value={s.simbolo ?? ''}
                      onChange={(e) => editSlideSimbolo(s.n, e.target.value)}
                      placeholder="p. ej. a lone chisel carving raw stone"
                      className="campo h-10 py-0 text-ui text-hueso-2 lg:h-8"
                    />
                  </label>
                </li>
              ))}
            </ol>

            {/* El único botón relleno de esta pantalla: aquí es donde se gasta. */}
            <button
              onClick={createAndGenerate}
              className="relative z-10 inline-flex h-12 items-center gap-3 self-start rounded-full bg-sangre px-7 text-[15px] font-medium text-hueso shadow-[0_10px_40px_-12px_rgb(139_26_26/.9),inset_0_1px_0_rgb(255_255_255/.1)] transition-[background-color,transform] duration-rapido ease-mesa hover:bg-sangre-hover active:scale-[.98]"
            >
              <span aria-hidden className="h-[9px] w-[9px] rounded-full bg-hueso" />
              Generar carrusel · <span className="font-mono">{slides.length}</span> slides
            </button>
          </section>
        )}

        {/* ── FASE WORK (generando / generado) ── */}
        {phase === 'work' && carousel && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={backToStart}
                disabled={generatingN !== null}
                className="btn-fantasma h-10 shrink-0 lg:h-8"
                title="Volver a la pantalla inicial (conserva lo que tuvieras escrito)"
              >
                <CaretLeft size={16} /> Volver
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui text-hueso">{carousel.tema}</p>
                <p aria-live="polite" className="font-mono text-meta text-hueso-3">
                  {generatingN !== null ? (
                    <span className="text-oro">
                      <span aria-hidden className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full bg-oro" />
                      generando la slide {generatingN}{stopping && <span className="text-hueso-3"> · se detiene después</span>}
                    </span>
                  ) : paused && faltan > 0 ? (
                    `en pausa · faltan ${faltan}`
                  ) : faltan === 0 ? (
                    'completo'
                  ) : (
                    `faltan ${faltan}`
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {generatingN !== null && (
                  <button onClick={stopQueue} disabled={stopping} className="btn-destructivo">
                    <Stop size={16} /> {stopping ? 'Deteniendo…' : 'Detener'}
                  </button>
                )}
                {generatingN === null && paused && faltan > 0 && (
                  <button onClick={resumeQueue} className="btn-sec border-hueso">
                    <Play size={16} /> Reanudar
                  </button>
                )}
                <button onClick={startOver} disabled={generatingN !== null} className="btn-fantasma h-10 px-1 lg:h-8">
                  Nuevo carrusel
                </button>
                <button
                  onClick={publishNow}
                  disabled={!canPublish || publishing || publishedOk}
                  className="btn-sec"
                  title="Publica el carrusel en Instagram ahora mismo, sin esperar a la cadencia"
                >
                  <PaperPlaneTilt size={16} />
                  {publishing ? 'Publicando…' : publishedOk ? 'Publicado' : 'Publicar ya'}
                </button>
                <button
                  onClick={queueCarousel}
                  disabled={!canPublish || queueing || queuedEta !== null || publishedOk}
                  className="btn-sec border-hueso"
                  title="Sube las slides, genera el caption y lo deja en cola; sale solo en su franja de cadencia"
                >
                  <Queue size={16} />
                  {queueing ? 'Encolando…' : queuedEta !== null ? 'En la cola' : 'Enviar a la cola'}
                </button>
              </div>
            </div>

            {/* Confirmaciones / avisos, siempre visibles sin hacer scroll */}
            {(queuedEta !== null || publishedOk || tooManySlides) && (
              <div className="flex flex-col gap-1 text-ui">
                {publishedOk && (
                  <span className="flex items-center gap-1.5 text-hueso-2"><Check size={16} className="text-oro" /> Publicado en Instagram</span>
                )}
                {queuedEta !== null && !publishedOk && (
                  <span className="flex items-center gap-1.5 text-hueso-2">
                    <Check size={16} className="text-oro" />
                    {queuedEta ? `En la cola: sale el ${queuedEta}` : 'En la cola: sale en su franja'}
                  </span>
                )}
                {tooManySlides && (
                  <span className="flex items-center gap-1.5 text-lacre">
                    <WarningCircle size={16} /> Instagram admite 10 slides como máximo y este tiene {carousel.slides.length}.
                  </span>
                )}
              </div>
            )}

            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {carousel.slides.map((s) => {
                const isGen = generatingN === s.n
                const err = slideErrors[s.n]
                return (
                  <li key={s.n} className="flex flex-col gap-1.5">
                    <div
                      className={`relative flex items-center justify-center overflow-hidden rounded-control border bg-s2 ${isGen ? 'border-oro' : 'border-linea-2'}`}
                      style={{ aspectRatio }}
                    >
                      {s.publicUrl ? (
                        <button
                          onClick={() => {
                            const done = carousel.slides.filter((x) => x.publicUrl)
                            const i = done.findIndex((x) => x.n === s.n)
                            if (i >= 0) setViewerIdx(i)
                          }}
                          className="group h-full w-full cursor-zoom-in"
                          aria-label={`Ver la slide ${s.n} en grande`}
                        >
                          <img src={s.publicUrl} alt="" className="h-full w-full object-cover transition-opacity duration-rapido ease-mesa group-hover:opacity-80" />
                        </button>
                      ) : isGen ? (
                        <span className="font-mono text-meta text-oro">generando</span>
                      ) : err ? (
                        <WarningCircle size={20} className="text-lacre" />
                      ) : (
                        <span className="font-mono text-meta text-hueso-3">en espera</span>
                      )}
                      <span className="absolute left-1.5 top-1.5 rounded-[4px] bg-velo px-1 font-mono text-label tracking-normal text-hueso">
                        #{s.n}{s.rol !== 'desarrollo' && <span className={rolClase(s.rol)}> {ROLE_LABEL[s.rol].toLowerCase()}</span>}
                      </span>
                    </div>
                    {err && <span className="text-meta text-lacre">{err}</span>}
                    <button onClick={() => regenerateSlide(s.n)} disabled={generatingN !== null} className="btn-sec">
                      <ArrowsClockwise size={14} />
                      {s.publicUrl ? 'Regenerar' : 'Generar'}
                    </button>
                  </li>
                )
              })}
            </ul>

            <p className="text-ui text-hueso-3">
              Toca una slide para verla en grande. <span className="text-hueso-2">Enviar a la cola</span> lo publica
              solo en la próxima franja de la cadencia (puedes encolar varios seguidos);{' '}
              <span className="text-hueso-2">Publicar ya</span> lo sube a Instagram al momento.
            </p>
          </section>
        )}

        {/* Visor ampliado */}
        {viewerIdx !== null && carousel && (
          <SlideViewer
            slides={carousel.slides.filter((s) => s.publicUrl)}
            index={viewerIdx}
            onIndex={setViewerIdx}
            onClose={() => setViewerIdx(null)}
          />
        )}
      </div>
    </div>
  )
}
