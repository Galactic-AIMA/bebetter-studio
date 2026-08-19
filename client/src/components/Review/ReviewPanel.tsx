import { useEffect, useState } from 'react'
import { X, ClipboardCheck, Check, ImageOff, TextQuote, AlertCircle, Loader2 } from 'lucide-react'
import { videosApi } from '../../api'
import { VideoRecord } from '../../types'

interface Props {
  onClose: () => void
}

/**
 * La cola de revisión de un lote (Fase 5, 2026-08-19).
 *
 * Es el eslabón que faltaba para poder USAR el lote automático. Desde la Fase 0.3
 * las piezas de un lote nacen en `pendiente_revision` y **no gastan frase ni
 * copies** hasta que alguien las aprueba; el backend ya tenía las tres rutas, pero
 * sin pantalla esas 30 piezas se quedaban en un estado que nadie podía mirar.
 *
 * Va ANTES que el bot de Telegram a propósito: `[Aprob]` manda un MP4 por vídeo, y
 * 30 de golpe dejarían el chat inservible.
 *
 * Los tres botones, y por qué son tres y no dos:
 *
 *   APROBAR       encola (que es lo que cuenta el uso y genera los copies)
 *   OTRA IMAGEN   rehace la MISMA frase con otro fondo. Es el caso más común al
 *                 revisar —«la frase sí, la imagen no»— y sin él había que
 *                 rechazar y esperar a que otro lote volviera a sacar esa frase.
 *   FRASE MALA    descarta Y ARCHIVA la frase. Sin archivarla volvería a salir en
 *                 el siguiente lote: el planificador ordena por `usage_count` y
 *                 rechazar no lo toca.
 */
export default function ReviewPanel({ onClose }: Props) {
  const [items, setItems] = useState<VideoRecord[]>([])
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = async () => {
    setCargando(true)
    try {
      setItems(await videosApi.pendientes())
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  /** Quita una pieza de la lista sin recargar: la revisión va rápido y recargar corta el ritmo. */
  const quitar = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id))

  const aprobar = async (v: VideoRecord) => {
    setOcupado(v.id); setError(null); setAviso(null)
    try {
      await videosApi.queue(v.id)
      quitar(v.id)
      setAviso(`Aprobada y enviada a la cola: ${v.title}`)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally { setOcupado(null) }
  }

  const otraImagen = async (v: VideoRecord) => {
    setOcupado(v.id); setError(null); setAviso(null)
    try {
      const nueva = await videosApi.rehacer(v.id)
      // La nueva ocupa el sitio de la vieja, no se va al final: así se ve el
      // resultado del cambio sin buscarlo.
      setItems((xs) => xs.map((x) => (x.id === v.id ? nueva : x)))
      setAviso(`Rehecha con otro fondo: ${v.title}`)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally { setOcupado(null) }
  }

  const fraseMala = async (v: VideoRecord) => {
    setOcupado(v.id); setError(null); setAviso(null)
    try {
      const r = await videosApi.reject(v.id, 'frase')
      quitar(v.id)
      setAviso(r.fraseArchivada
        ? `Descartada y la frase archivada, fuera de la rotación`
        : `Descartada (la frase no se archivó: no estaba vinculada)`)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally { setOcupado(null) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-5xl bg-carbon-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh]">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-carbon-700 shrink-0">
          <ClipboardCheck size={15} className="text-gold-500" />
          <h2 className="text-sm font-semibold tracking-wide text-bone-500">Revisión del lote</h2>
          {!cargando && (
            <span className="text-[10px] text-gold-500 bg-gold-500/10 px-1.5 py-0.5 rounded">
              {items.length} pendiente{items.length === 1 ? '' : 's'}
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg bg-carbon-700/80 text-bone-700 hover:text-bone-500 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-3 sm:p-4">
          {cargando ? (
            <p className="text-bone-700 text-xs">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="text-bone-700 text-xs">
              Nada por revisar. Las piezas aparecen aquí cuando un lote termina — y hasta que
              las apruebes no gastan frase ni copies.
            </p>
          ) : (
            // Rejilla responsive: una columna en móvil, hasta tres en escritorio.
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((v) => {
                const trabajando = ocupado === v.id
                return (
                  <div
                    key={v.id}
                    className={`bg-carbon-900/60 rounded-lg border overflow-hidden flex flex-col ${
                      trabajando ? 'border-gold-500' : 'border-carbon-700'
                    }`}
                  >
                    {/* `preload="metadata"`: con 30 piezas, precargar el vídeo entero
                        se comería la red y la memoria al abrir el panel. */}
                    <video
                      src={v.s3Url || v.publicUrl}
                      controls
                      preload="metadata"
                      className="w-full aspect-[9/16] bg-black object-contain"
                    />
                    <p className="px-2.5 pt-2 text-[11px] text-bone-500 line-clamp-3 min-h-[3.2em]">
                      {v.config?.text?.content || v.title}
                    </p>
                    <p className="px-2.5 pt-1 text-[10px] text-bone-700">
                      {v.config?.duration ? `${v.config.duration}s` : ''}
                      {v.config?.audioTrack ? ' · con música' : ' · sin música'}
                    </p>

                    <div className="mt-auto p-2 flex items-center gap-1.5">
                      <button
                        onClick={() => aprobar(v)}
                        disabled={trabajando}
                        title="Aprobar y enviar a la cola (cuenta el uso y genera los copies)"
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded-lg bg-gold-500 text-carbon-900 hover:bg-gold-600 disabled:opacity-40 transition-colors font-medium"
                      >
                        {trabajando ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Aprobar
                      </button>
                      <button
                        onClick={() => otraImagen(v)}
                        disabled={trabajando}
                        title="La frase sí, la imagen no: rehace con otro fondo (tarda, genera imagen)"
                        className="p-1.5 rounded-lg bg-carbon-700 text-bone-500 hover:text-gold-500 disabled:opacity-40 transition-colors"
                      >
                        <ImageOff size={13} />
                      </button>
                      <button
                        onClick={() => fraseMala(v)}
                        disabled={trabajando}
                        title="Frase mala: la descarta Y la archiva para que no vuelva a salir"
                        className="p-1.5 rounded-lg bg-carbon-700 text-bone-500 hover:text-neon-red disabled:opacity-40 transition-colors"
                      >
                        <TextQuote size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {(error || aviso) && (
          <div className="px-4 py-2 border-t border-carbon-700 shrink-0">
            {error && (
              <div className="flex items-start gap-1.5 text-[11px] text-neon-red">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {!error && aviso && <p className="text-[11px] text-gold-500">{aviso}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
