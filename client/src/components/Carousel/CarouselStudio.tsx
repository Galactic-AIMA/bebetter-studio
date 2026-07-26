import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Sparkles, Wand2, RefreshCw, ChevronLeft, GalleryHorizontalEnd, AlertCircle, Loader2, Check, Square, Play, Send,
  Trash2, History, Zap,
} from 'lucide-react'
import { carouselsApi, Carousel, CarouselSlide, SlideRole, CarouselFuente } from '../../api'
import SlideViewer from './SlideViewer'

type Phase = 'input' | 'script' | 'work'
type Tipo = 'narrativo' | 'serie'

const ROLE_LABEL: Record<SlideRole, string> = {
  portada: 'Portada',
  desarrollo: 'Desarrollo',
  historia: 'Historia',
  cta: 'Cierre (CTA)',
}

const ASPECTS: { value: string; label: string }[] = [
  { value: '4:5', label: '4:5 · Carrusel' },
  { value: '1:1', label: '1:1 · Cuadrado' },
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

  const startOver = () => {
    stopRef.current = false
    setQueuedEta(null)
    setPublishedOk(false)
    setPhase('input')
    setSlides([])
    setCarousel(null)
    setError(null)
    setSlideErrors({})
    setGeneratingN(null)
    setPaused(false)
    setStopping(false)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="w-full h-full overflow-y-auto px-6 py-5">
      <div className="max-w-4xl mx-auto">
        {/* Título */}
        <div className="flex items-center gap-2.5 mb-1">
          <GalleryHorizontalEnd size={18} className="text-gold-500" />
          <h1 className="text-base font-semibold tracking-wide text-bone-500">Modo Carrusel</h1>
        </div>
        <p className="text-[11px] text-bone-700 mb-5 leading-relaxed">
          Cada slide es una imagen completa con el texto ya integrado (RAW · STOIC · CINEMATIC), coherente entre slides.
          Proveedor: KIE (Nano Banana Pro) · ~$0.09/slide. Primero se planifica el guion (gratis) y lo apruebas antes de gastar créditos.
        </p>

        {error && (
          <p className="mb-4 text-[11px] text-neon-red bg-neon-red/10 border border-neon-red/30 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertCircle size={13} /> {error}
          </p>
        )}

        {/* ── FASE INPUT ── */}
        {phase === 'input' && (
          <div className="flex flex-col gap-4 bg-carbon-800 rounded-xl p-5 border border-carbon-700">
            <div>
              <label className="block text-[11px] font-medium text-bone-500 mb-1.5">Tema o material fuente</label>
              <textarea
                value={tema}
                onChange={(e) => setTema(e.target.value)}
                rows={4}
                placeholder='Un tema ("la paciencia") o pega material completo: un capítulo de libro, el resumen de un video, una escena. Cuanta más sustancia, más concretas salen las slides.'
                className="w-full bg-carbon-900 border border-carbon-600 rounded-lg px-3 py-2 text-xs text-bone-500 leading-relaxed resize-y focus:outline-none focus:border-gold-500/60"
              />
            </div>

            {/* Atribución + marca de serie */}
            <div className="border-t border-carbon-700 pt-4">
              <label className="block text-[11px] font-medium text-bone-500 mb-1">Referencia (opcional)</label>
              <p className="text-[10px] text-bone-700 mb-2 leading-relaxed">
                Da autoridad y convierte varios carruseles en una <span className="text-bone-500">serie</span>. Se
                muestra solo en la portada y el cierre, discreto.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={autor}
                  onChange={(e) => setAutor(e.target.value)}
                  placeholder="Autor — Robert Greene"
                  className="bg-carbon-900 border border-carbon-600 rounded-lg px-3 py-2 text-xs text-bone-500 focus:outline-none focus:border-gold-500/60"
                />
                <input
                  value={obra}
                  onChange={(e) => setObra(e.target.value)}
                  placeholder="Obra — Las 48 Leyes del Poder"
                  className="bg-carbon-900 border border-carbon-600 rounded-lg px-3 py-2 text-xs text-bone-500 focus:outline-none focus:border-gold-500/60"
                />
                <input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Serie — LEY 15"
                  className="bg-carbon-900 border border-carbon-600 rounded-lg px-3 py-2 text-xs text-bone-500 focus:outline-none focus:border-gold-500/60"
                />
              </div>
              <label className="flex items-center gap-2 mt-2.5 text-[11px] text-bone-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={conHistoria}
                  onChange={(e) => setConHistoria(e.target.checked)}
                  className="accent-gold-500"
                />
                Incluir una slide con el caso o historia del material
              </label>
            </div>

            <div className="flex flex-wrap gap-5">
              {/* Tipo */}
              <div>
                <label className="block text-[11px] font-medium text-bone-500 mb-1.5">Tipo</label>
                <div className="flex items-center rounded-lg overflow-hidden border border-carbon-600 text-xs w-max">
                  {(['narrativo', 'serie'] as Tipo[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTipo(t)}
                      className={`px-3 py-1.5 transition-colors ${
                        tipo === t ? 'bg-carbon-600 text-gold-500 font-medium' : 'text-bone-700 hover:text-bone-500'
                      }`}
                    >
                      {t === 'narrativo' ? 'Narrativo' : 'Serie de frases'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nº slides */}
              <div>
                <label className="block text-[11px] font-medium text-bone-500 mb-1.5">Nº de slides</label>
                <div className="flex items-center rounded-lg overflow-hidden border border-carbon-600 text-xs w-max">
                  {[5, 6, 7, 8].map((n) => (
                    <button
                      key={n}
                      onClick={() => setNSlides(n)}
                      className={`px-3 py-1.5 transition-colors ${
                        nSlides === n ? 'bg-carbon-600 text-gold-500 font-medium' : 'text-bone-700 hover:text-bone-500'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Formato */}
              <div>
                <label className="block text-[11px] font-medium text-bone-500 mb-1.5">Formato</label>
                <div className="flex items-center rounded-lg overflow-hidden border border-carbon-600 text-xs w-max">
                  {ASPECTS.map((a) => (
                    <button
                      key={a.value}
                      onClick={() => setAspect(a.value)}
                      className={`px-3 py-1.5 transition-colors ${
                        aspect === a.value ? 'bg-carbon-600 text-gold-500 font-medium' : 'text-bone-700 hover:text-bone-500'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={planScript}
              disabled={!hasTema || loadingScript}
              className="self-start flex items-center gap-1.5 text-xs font-medium bg-[#E8E4DC] text-[#0A0A0A] rounded-lg px-4 py-2 hover:bg-white transition-colors disabled:opacity-40"
            >
              <Sparkles size={13} className={loadingScript ? 'animate-pulse' : ''} />
              {loadingScript ? 'Planificando…' : 'Planificar guion'}
            </button>
          </div>
        )}

        {/* ── Historial de carruseles (siempre visible en la pantalla inicial) ── */}
        {phase === 'input' && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2.5">
              <History size={13} className="text-gold-500" />
              <h2 className="text-[11px] font-medium text-bone-500">Carruseles anteriores</h2>
              {history.length > 0 && <span className="text-[10px] text-bone-700">({history.length})</span>}
              <button
                onClick={loadHistory}
                disabled={loadingHistory}
                className="ml-auto flex items-center gap-1 text-[10px] text-bone-700 hover:text-bone-500 disabled:opacity-40"
              >
                <RefreshCw size={10} className={loadingHistory ? 'animate-spin' : ''} /> Actualizar
              </button>
            </div>

            {loadingHistory && !history.length ? (
              <p className="text-[11px] text-bone-700">Cargando…</p>
            ) : !history.length ? (
              <p className="text-[11px] text-bone-700">
                Todavía no hay carruseles guardados. Los que generes aparecerán aquí.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {history.map((c) => {
                  const cover = c.slides.find((s) => s.publicUrl)?.publicUrl
                  const hechas = c.slides.filter((s) => s.publicUrl).length
                  return (
                    <div
                      key={c.id}
                      className="group relative bg-carbon-800 border border-carbon-700 rounded-lg overflow-hidden hover:border-carbon-600 transition-colors"
                    >
                      <button onClick={() => openCarousel(c)} className="w-full text-left" title="Abrir este carrusel">
                        <div className="relative bg-carbon-900" style={{ aspectRatio: '4 / 5' }}>
                          {cover ? (
                            <img src={cover} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-bone-700">
                              sin imágenes
                            </div>
                          )}
                          <span className="absolute top-1.5 left-1.5 text-[9px] font-mono bg-carbon-900/85 text-bone-500 rounded px-1">
                            {hechas}/{c.slides.length}
                          </span>
                          {(c.status === 'queued' || c.status === 'published') && (
                            <span className="absolute top-1.5 right-1.5 text-[9px] bg-gold-500 text-carbon-900 font-medium rounded px-1">
                              {c.status === 'queued' ? 'en cola' : 'publicado'}
                            </span>
                          )}
                        </div>
                        <div className="p-2">
                          {c.fuente?.referencia && (
                            <span className="text-[9px] font-medium text-neon-red block">{c.fuente.referencia}</span>
                          )}
                          <p className="text-[10px] text-bone-500 leading-snug line-clamp-2">{c.tema}</p>
                          <p className="text-[9px] text-bone-700 mt-0.5">
                            {new Date(c.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                          </p>
                        </div>
                      </button>
                      <button
                        onClick={() => removeCarousel(c.id)}
                        className="absolute bottom-1.5 right-1.5 p-1 rounded bg-carbon-900/80 text-bone-700 opacity-0 group-hover:opacity-100 hover:text-neon-red transition-all"
                        title="Borrar carrusel"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── FASE SCRIPT (guion editable) ── */}
        {phase === 'script' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <button onClick={() => setPhase('input')} className="flex items-center gap-1 text-[11px] text-bone-700 hover:text-bone-500">
                <ChevronLeft size={13} /> Cambiar tema
              </button>
              <button
                onClick={planScript}
                disabled={loadingScript}
                className="flex items-center gap-1 text-[10px] text-gold-500 hover:text-gold-400 disabled:opacity-40"
              >
                <RefreshCw size={10} className={loadingScript ? 'animate-spin' : ''} /> Reproponer guion
              </button>
            </div>

            <p className="text-[11px] text-bone-700">
              Revisa y edita el texto de cada slide. Al generar se cobra ~$0.09 por slide.
            </p>

            {slides.map((s) => (
              <div key={s.n} className="bg-carbon-800 rounded-lg p-3 border border-carbon-700">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-mono text-bone-700">#{s.n}</span>
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      s.rol === 'portada'
                        ? 'bg-neon-red/15 text-neon-red'
                        : s.rol === 'cta'
                        ? 'bg-gold-500/15 text-gold-500'
                        : s.rol === 'historia'
                        ? 'bg-gold-500/10 text-gold-500/80'
                        : 'bg-carbon-600 text-bone-700'
                    }`}
                  >
                    {ROLE_LABEL[s.rol]}
                  </span>
                </div>
                <textarea
                  value={s.texto}
                  onChange={(e) => editSlideText(s.n, e.target.value)}
                  rows={2}
                  className="w-full bg-carbon-900 border border-carbon-600 rounded-lg px-3 py-2 text-xs text-bone-500 leading-relaxed resize-y focus:outline-none focus:border-gold-500/60"
                />
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-bone-700 shrink-0" title="Escena visual de la slide (en inglés). Cada slide usa una distinta para no repetir imagen.">🎬 escena</span>
                  <input
                    value={s.simbolo ?? ''}
                    onChange={(e) => editSlideSimbolo(s.n, e.target.value)}
                    placeholder="p. ej. a lone chisel carving raw stone"
                    className="flex-1 bg-carbon-900 border border-carbon-600 rounded px-2 py-1 text-[11px] text-bone-700 italic focus:outline-none focus:border-gold-500/60"
                  />
                </div>
              </div>
            ))}

            <button
              onClick={createAndGenerate}
              className="self-start flex items-center gap-1.5 text-xs font-medium bg-[#E8E4DC] text-[#0A0A0A] rounded-lg px-4 py-2 hover:bg-white transition-colors mt-1"
            >
              <Wand2 size={13} /> Generar carrusel ({slides.length} slides)
            </button>
          </div>
        )}

        {/* ── FASE WORK (generando / generado) ── */}
        {phase === 'work' && carousel && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-bone-500 font-medium truncate min-w-0">
                {carousel.tema}
                {generatingN !== null && (
                  <span className="ml-2 text-[10px] text-gold-500 inline-flex items-center gap-1 whitespace-nowrap">
                    <Loader2 size={11} className="animate-spin" /> generando slide {generatingN}…
                    {stopping && <span className="text-bone-700">(deteniendo tras esta)</span>}
                  </span>
                )}
                {generatingN === null && paused && carousel.slides.some((s) => !s.publicUrl) && (
                  <span className="ml-2 text-[10px] text-bone-700 inline-flex items-center gap-1 whitespace-nowrap">
                    en pausa · faltan {carousel.slides.filter((s) => !s.publicUrl).length}
                  </span>
                )}
                {generatingN === null && carousel.slides.every((s) => s.publicUrl) && (
                  <span className="ml-2 text-[10px] text-gold-500 inline-flex items-center gap-1">
                    <Check size={11} /> completo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                {/* Detener la cola en curso */}
                {generatingN !== null && (
                  <button
                    onClick={stopQueue}
                    disabled={stopping}
                    className="flex items-center gap-1 text-[11px] text-neon-red border border-neon-red/40 rounded-lg px-2.5 py-1 hover:bg-neon-red/10 disabled:opacity-40 transition-colors"
                  >
                    <Square size={11} /> {stopping ? 'Deteniendo…' : 'Detener'}
                  </button>
                )}
                {/* Reanudar desde donde quedó */}
                {generatingN === null && paused && carousel.slides.some((s) => !s.publicUrl) && (
                  <button
                    onClick={resumeQueue}
                    className="flex items-center gap-1 text-[11px] text-carbon-900 bg-gold-500 hover:bg-gold-600 rounded-lg px-2.5 py-1 font-medium transition-colors"
                  >
                    <Play size={11} /> Reanudar
                  </button>
                )}

                <button
                  onClick={startOver}
                  disabled={generatingN !== null}
                  className="text-[11px] text-bone-700 hover:text-bone-500 disabled:opacity-40 px-1"
                >
                  Nuevo carrusel
                </button>

                {/* Publicar ya (secundario) */}
                <button
                  onClick={publishNow}
                  disabled={!canPublish || publishing || publishedOk}
                  className="flex items-center gap-1.5 text-[11px] text-bone-500 border border-carbon-600 rounded-lg px-3 py-1.5 hover:border-gold-500/60 hover:text-gold-500 disabled:opacity-40 disabled:hover:border-carbon-600 disabled:hover:text-bone-500 transition-colors"
                  title="Publica el carrusel en Instagram ahora mismo, sin esperar a la cadencia"
                >
                  <Zap size={11} />
                  {publishing ? 'Publicando…' : publishedOk ? 'Publicado' : 'Publicar ya'}
                </button>

                {/* Enviar a la cola (primario) */}
                <button
                  onClick={queueCarousel}
                  disabled={!canPublish || queueing || queuedEta !== null || publishedOk}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-carbon-900 bg-gold-500 hover:bg-gold-600 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
                  title="Sube las slides, genera el caption y lo deja en cola; se publica solo en su franja de cadencia"
                >
                  <Send size={11} />
                  {queueing ? 'Encolando…' : queuedEta !== null ? 'En la cola' : 'Enviar a la cola'}
                </button>
              </div>
            </div>

            {/* Confirmaciones / avisos, siempre visibles sin hacer scroll */}
            {(queuedEta !== null || publishedOk || tooManySlides) && (
              <div className="flex flex-col gap-1">
                {publishedOk && (
                  <span className="flex items-center gap-1.5 text-[11px] text-gold-500">
                    <Check size={12} /> Publicado en Instagram
                  </span>
                )}
                {queuedEta !== null && !publishedOk && (
                  <span className="flex items-center gap-1.5 text-[11px] text-gold-500">
                    <Check size={12} />
                    {queuedEta ? `En la cola — se publicará el ${queuedEta}` : 'En la cola — se publicará en su franja'}
                  </span>
                )}
                {tooManySlides && (
                  <span className="text-[11px] text-neon-red">
                    Instagram admite máximo 10 slides (este tiene {carousel.slides.length})
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {carousel.slides.map((s) => {
                const isGen = generatingN === s.n
                const err = slideErrors[s.n]
                return (
                  <div key={s.n} className="flex flex-col gap-1.5">
                    <div
                      className="relative rounded-lg overflow-hidden bg-carbon-900 border border-carbon-700 flex items-center justify-center"
                      style={{ aspectRatio }}
                    >
                      {s.publicUrl ? (
                        <button
                          onClick={() => {
                            const done = carousel.slides.filter((x) => x.publicUrl)
                            const i = done.findIndex((x) => x.n === s.n)
                            if (i >= 0) setViewerIdx(i)
                          }}
                          className="group w-full h-full cursor-zoom-in"
                          title="Ver en grande"
                        >
                          <img
                            src={s.publicUrl}
                            alt={`Slide ${s.n}`}
                            className="w-full h-full object-cover transition-opacity group-hover:opacity-80"
                          />
                        </button>
                      ) : isGen ? (
                        <Loader2 size={22} className="animate-spin text-gold-500" />
                      ) : err ? (
                        <AlertCircle size={20} className="text-neon-red" />
                      ) : (
                        <span className="text-[10px] text-bone-700">en cola…</span>
                      )}
                      <span className="absolute top-1.5 left-1.5 text-[9px] font-mono bg-carbon-900/80 text-bone-500 rounded px-1">
                        #{s.n} {s.rol === 'portada' ? '· portada' : s.rol === 'cta' ? '· cta' : s.rol === 'historia' ? '· historia' : ''}
                      </span>
                    </div>
                    {err && <span className="text-[9px] text-neon-red leading-tight">{err}</span>}
                    <button
                      onClick={() => regenerateSlide(s.n)}
                      disabled={generatingN !== null}
                      className="flex items-center justify-center gap-1 text-[10px] text-bone-700 hover:text-bone-500 border border-carbon-600 rounded py-1 disabled:opacity-30 transition-colors"
                    >
                      <RefreshCw size={10} className={isGen ? 'animate-spin' : ''} />
                      {s.publicUrl ? 'Regenerar' : 'Generar'}
                    </button>
                  </div>
                )
              })}
            </div>

            <p className="text-[10px] text-bone-700 leading-relaxed">
              Toca una slide para verla en grande. <span className="text-bone-500">Enviar a la cola</span> lo publica
              solo en la próxima franja de cadencia (puedes encolar varios en una sesión);{' '}
              <span className="text-bone-500">Publicar ya</span> lo sube a Instagram al instante.
            </p>
          </div>
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
