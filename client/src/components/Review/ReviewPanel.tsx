import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Check, ImageSquare, WarningCircle, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { splitByTiempos } from '@shared/splitByTiempos'
import { videosApi } from '../../api'
import { VideoRecord } from '../../types'

interface Props {
  onClose: () => void
}

/**
 * La cola de revisión de un lote (Fase 5, 2026-08-19), como pantalla propia de la
 * sala de montaje (DESIGN.md §6, «el gesto del Cartel»): pieza a pieza, la frase
 * en Anton con el giro en lacre y el reel al lado.
 *
 * Desde la Fase 0.3 las piezas de un lote nacen en `pendiente_revision` y **no
 * gastan frase ni copies** hasta que alguien las aprueba.
 *
 * Las acciones, y por qué «otra imagen» sigue aunque el diseño hable de A · X · →:
 *
 *   APROBAR (A)       encola (que es lo que cuenta el uso y genera los copies)
 *   OTRA IMAGEN (F)   rehace la MISMA frase con otro fondo. Es el caso más común al
 *                     revisar —«la frase sí, la imagen no»— y sin él había que
 *                     rechazar y esperar a que otro lote volviera a sacar esa frase.
 *   FRASE MALA (X)    descarta Y ARCHIVA la frase. Sin archivarla volvería a salir en
 *                     el siguiente lote: el planificador ordena por `usage_count` y
 *                     rechazar no lo toca.
 *   SIGUIENTE (→ / ←) recorre sin decidir.
 */
export default function ReviewPanel({ onClose }: Props) {
  const [items, setItems] = useState<VideoRecord[]>([])
  const [pos, setPos] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState<'aprobar' | 'imagen' | 'frase' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // El giro (DESIGN.md §7.4). Guarda QUÉ pieza está revelada, no un booleano: así
  // la pieza nueva nace oculta en el mismo render en que aparece, y se revela dos
  // fotogramas después. Con un booleano nacía revelada y no había animación.
  const [reveladaId, setReveladaId] = useState<string | null>(null)
  const cerrarRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    videosApi.pendientes()
      .then(setItems)
      .catch((e: any) => setError(e?.response?.data?.error || e.message))
      .finally(() => setCargando(false))
    cerrarRef.current?.focus()
  }, [])

  const actual = items[Math.min(pos, items.length - 1)] as VideoRecord | undefined

  const revelado = !!actual && reveladaId === actual.id

  useEffect(() => {
    if (!actual) return
    let b = 0
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setReveladaId(actual.id)) })
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b) }
  }, [actual?.id])

  const ir = useCallback((n: number) => {
    if (!items.length) return
    setPos((n + items.length) % items.length)
  }, [items.length])

  /** Quita una pieza sin recargar: la revisión va rápido y recargar corta el ritmo.
   *  La posición se queda donde está, así que la siguiente ocupa su sitio. */
  const quitar = (id: string) => {
    setItems((xs) => {
      const resto = xs.filter((x) => x.id !== id)
      setPos((p) => Math.min(p, Math.max(0, resto.length - 1)))
      return resto
    })
  }

  const fallo = (e: any) => setError(e?.response?.data?.error || e.message)

  const aprobar = async () => {
    if (!actual || ocupado) return
    setOcupado('aprobar'); setError(null); setAviso(null)
    try {
      await videosApi.queue(actual.id)
      quitar(actual.id)
      setAviso('Aprobada y enviada a la cola')
    } catch (e) { fallo(e) } finally { setOcupado(null) }
  }

  const otraImagen = async () => {
    if (!actual || ocupado) return
    setOcupado('imagen'); setError(null); setAviso(null)
    try {
      const nueva = await videosApi.rehacer(actual.id)
      // La nueva ocupa el sitio de la vieja: se ve el cambio sin buscarlo.
      setItems((xs) => xs.map((x) => (x.id === actual.id ? nueva : x)))
      setAviso('Rehecha con otro fondo')
    } catch (e) { fallo(e) } finally { setOcupado(null) }
  }

  const fraseMala = async () => {
    if (!actual || ocupado) return
    setOcupado('frase'); setError(null); setAviso(null)
    try {
      const r = await videosApi.reject(actual.id, 'frase')
      quitar(actual.id)
      setAviso(r.fraseArchivada
        ? 'Descartada, y la frase archivada: no volverá a salir'
        : 'Descartada (la frase no se archivó: no estaba vinculada)')
    } catch (e) { fallo(e) } finally { setOcupado(null) }
  }

  // Teclado: A aprueba, F pide otro fondo, X descarta la frase, ←/→ recorren, Esc sale.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      // Sobre el reproductor, las flechas son suyas (avanzar el vídeo).
      if (t.tagName === 'VIDEO' && e.key.startsWith('Arrow')) return
      const k = e.key.toLowerCase()
      if (k === 'escape') onClose()
      else if (k === 'arrowright') ir(pos + 1)
      else if (k === 'arrowleft') ir(pos - 1)
      else if (k === 'a') aprobar()
      else if (k === 'f') otraImagen()
      else if (k === 'x') fraseMala()
      else return
      e.preventDefault()
    }
    addEventListener('keydown', tecla)
    return () => removeEventListener('keydown', tecla)
  })

  const [a, b] = actual ? splitByTiempos(actual.config?.text?.content || actual.title) : ['', '']
  const largo = (actual?.config?.text?.content || '').length > 105
  const imagen = (v: VideoRecord) =>
    v.config?.imageId ? `/api/images/file/${encodeURIComponent(v.config.imageId)}` : undefined

  return (
    <section
      aria-label="Revisión del lote"
      className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-sala lg:left-16 xl:left-[232px]"
    >
      {/* La luz viene de arriba a la derecha, donde está el reel. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_70%_at_78%_0%,rgb(197_160_89/.1),transparent_70%)]"
      />

      <header className="relative flex shrink-0 items-center gap-4 border-b border-linea px-4 py-3 lg:border-0 lg:px-[72px] lg:pt-8">
        <h1 className="text-title font-light tracking-[-.01em] text-hueso">Revisión del lote</h1>
        {!cargando && items.length > 0 && (
          <span className="font-mono text-meta tabular-nums text-hueso-2">
            pieza {Math.min(pos, items.length - 1) + 1} de {items.length}
          </span>
        )}
        <button
          ref={cerrarRef}
          onClick={onClose}
          aria-label="Cerrar la revisión"
          className="btn-fantasma ml-auto h-10 gap-2 px-2 lg:h-8"
        >
          <span className="hidden sm:inline">Volver</span><span className="kbd hidden sm:inline-flex">Esc</span>
          <X size={18} className="sm:hidden" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {cargando ? (
          <p className="px-4 py-6 text-ui text-hueso-3 lg:px-[72px]">Cargando las piezas…</p>
        ) : !actual ? (
          <div className="flex flex-col items-start gap-3 px-4 py-16 lg:px-[72px]">
            <p className="pt-[.16em] font-display text-display uppercase text-hueso">Nada por revisar</p>
            <p className="max-w-[52ch] text-lead text-hueso-2">
              Las piezas llegan aquí cuando un lote termina. Hasta que las apruebes no gastan frase ni copies.
            </p>
            {aviso && <p className="flex items-center gap-1.5 text-ui text-hueso-2"><Check size={16} className="text-oro" /> {aviso}</p>}
            <button onClick={onClose} className="btn-sec mt-2">Volver al editor</button>
          </div>
        ) : (
          <div className="grid gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-16 lg:px-[72px] lg:py-10">
            <div className="order-2 min-w-0 max-w-[760px] lg:order-1">
              {/* El giro: primer tiempo desde la máscara, filete, y entra el giro. */}
              <h2
                key={actual.id}
                aria-label={b ? `${a} ${b}` : a}
                className={`font-display uppercase leading-[.98] text-hueso ${
                  largo ? 'text-[min(46px,9vw)]' : 'text-[min(54px,10vw)]'
                }`}
              >
                <span aria-hidden className="-mt-[.16em] block overflow-hidden pt-[.16em]">
                  <span className={`block transition-transform duration-[600ms] ease-sala ${revelado ? 'translate-y-0' : 'translate-y-[105%]'}`}>
                    {a}
                  </span>
                </span>
                {b && (
                  <>
                    <span
                      aria-hidden
                      className={`my-[.4em] mb-[.45em] block h-[3px] w-[72px] origin-left bg-hueso transition-transform duration-300 ease-sala ${
                        revelado ? 'scale-x-100 delay-[450ms]' : 'scale-x-0'
                      }`}
                    />
                    <span aria-hidden className="-mt-[.16em] block overflow-hidden pt-[.16em]">
                      <span className={`block text-lacre transition-transform duration-[600ms] ease-sala ${revelado ? 'translate-y-0 delay-[600ms]' : 'translate-y-[105%]'}`}>
                        {b}
                      </span>
                    </span>
                  </>
                )}
              </h2>

              <dl className="mt-9 flex flex-wrap gap-x-8 gap-y-3 border-t border-linea pt-4">
                <div>
                  <dt className="rotulo mb-1.5">Duración</dt>
                  <dd className="font-mono text-body tabular-nums text-hueso">{actual.config?.duration ? `${actual.config.duration} s` : '—'}</dd>
                </div>
                <div>
                  <dt className="rotulo mb-1.5">Música</dt>
                  <dd className="text-body text-hueso">{actual.config?.audioTrack ? 'Con pista' : 'Sin música'}</dd>
                </div>
                <div>
                  <dt className="rotulo mb-1.5">Generada</dt>
                  <dd className="font-mono text-body tabular-nums text-hueso">
                    {new Date(actual.createdAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                  </dd>
                </div>
              </dl>

              <div className="mt-8 flex flex-wrap gap-2.5">
                <button onClick={aprobar} disabled={!!ocupado} className="btn-sec h-10 gap-3 border-hueso px-4 lg:h-10">
                  <span className="flex items-center gap-1.5"><Check size={16} /> Aprobar y enviar a la cola</span>
                  <span className="kbd">A</span>
                </button>
                <button
                  onClick={otraImagen}
                  disabled={!!ocupado}
                  title="La frase sí, el fondo no: la rehace con otra imagen. Tarda, porque genera una."
                  className="btn-sec h-10 gap-3 px-4 lg:h-10"
                >
                  <span className="flex items-center gap-1.5"><ImageSquare size={16} /> Otra imagen</span>
                  <span className="kbd">F</span>
                </button>
                <button
                  onClick={fraseMala}
                  disabled={!!ocupado}
                  title="Descarta la pieza y archiva la frase para que no vuelva a salir"
                  className="btn-destructivo h-10 gap-3 px-4 lg:h-10"
                >
                  <span className="flex items-center gap-1.5"><X size={16} /> Frase mala</span>
                  <span className="kbd">X</span>
                </button>
                <button onClick={() => ir(pos + 1)} disabled={items.length < 2} className="btn-sec h-10 gap-3 px-4 lg:h-10">
                  Siguiente <span className="kbd">→</span>
                </button>
              </div>

              <div aria-live="polite" className="mt-4 min-h-6 text-ui">
                {ocupado === 'imagen' && <p className="text-hueso-2">Rehaciendo con otro fondo. Tarda un poco: genera una imagen nueva.</p>}
                {ocupado && ocupado !== 'imagen' && <p className="text-hueso-3">Un momento…</p>}
                {!ocupado && error && (
                  <p role="alert" className="flex items-start gap-1.5 text-lacre"><WarningCircle size={16} className="mt-0.5 shrink-0" /> {error}</p>
                )}
                {!ocupado && !error && aviso && (
                  <p className="flex items-center gap-1.5 text-hueso-2"><Check size={16} className="text-oro" /> {aviso}</p>
                )}
              </div>

              {items.length > 1 && (
                <ol aria-label="Piezas del lote" className="mt-8 flex flex-wrap gap-1.5">
                  {items.map((v, n) => {
                    const esta = v.id === actual.id
                    return (
                      <li key={v.id}>
                        <button
                          onClick={() => ir(n)}
                          aria-label={`Pieza ${n + 1}`}
                          aria-current={esta ? 'true' : undefined}
                          className={`block h-16 w-9 overflow-hidden rounded-[4px] bg-s2 transition-opacity duration-rapido ease-mesa ${
                            esta ? 'opacity-100 outline outline-2 outline-offset-2 outline-oro' : 'opacity-45 hover:opacity-80'
                          }`}
                        >
                          {imagen(v) && <img src={imagen(v)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>

            <div className="order-1 flex items-center justify-center gap-2 lg:order-2">
              <button onClick={() => ir(pos - 1)} disabled={items.length < 2} aria-label="Pieza anterior" className="btn-fantasma hidden h-10 w-10 justify-center lg:inline-flex">
                <CaretLeft size={18} weight="light" />
              </button>
              {/* `playsInline` o iOS abre el vídeo a pantalla completa al darle a play.
                  `preload="metadata"`: no se descarga el vídeo entero al llegar. El
                  póster es el fondo, para que la pieza se vea aunque el MP4 tarde. */}
              <video
                key={actual.id}
                src={actual.s3Url || actual.publicUrl}
                poster={imagen(actual)}
                controls
                playsInline
                preload="metadata"
                className="aspect-[9/16] h-[min(52dvh,640px)] rounded-preview bg-s1 object-cover shadow-[0_40px_120px_-20px_rgb(0_0_0/.9)] ring-1 ring-hueso/[.06] lg:h-[min(76vh,640px)]"
              />
              <button onClick={() => ir(pos + 1)} disabled={items.length < 2} aria-label="Pieza siguiente" className="btn-fantasma hidden h-10 w-10 justify-center lg:inline-flex">
                <CaretRight size={18} weight="light" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
