import { useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { CarouselSlide } from '../../api'

interface Props {
  slides: CarouselSlide[] // solo las que ya tienen imagen
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}

const ROLE_LABEL: Record<string, string> = {
  portada: 'Portada',
  desarrollo: 'Desarrollo',
  historia: 'Historia',
  cta: 'Cierre',
}

// Visor a pantalla completa de las slides generadas, con navegación
// (flechas del teclado / botones) y salida con Esc.
export default function SlideViewer({ slides, index, onIndex, onClose }: Props) {
  const slide = slides[index]

  const prev = useCallback(() => onIndex((index - 1 + slides.length) % slides.length), [index, slides.length, onIndex])
  const next = useCallback(() => onIndex((index + 1) % slides.length), [index, slides.length, onIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, onClose])

  if (!slide?.publicUrl) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Cerrar */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-10 p-2 rounded-lg bg-carbon-800/80 text-bone-700 hover:text-bone-500 transition-colors"
        title="Cerrar (Esc)"
      >
        <X size={18} />
      </button>

      <div className="flex items-center gap-3 max-w-full max-h-full">
        {slides.length > 1 && (
          <button
            onClick={prev}
            className="p-2 rounded-full bg-carbon-800/80 text-bone-700 hover:text-bone-500 transition-colors shrink-0"
            title="Anterior (←)"
          >
            <ChevronLeft size={20} />
          </button>
        )}

        <img
          src={slide.publicUrl}
          alt={`Slide ${slide.n}`}
          className="max-h-[82vh] max-w-full w-auto object-contain rounded-lg shadow-2xl"
        />

        {slides.length > 1 && (
          <button
            onClick={next}
            className="p-2 rounded-full bg-carbon-800/80 text-bone-700 hover:text-bone-500 transition-colors shrink-0"
            title="Siguiente (→)"
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>

      {/* Pie: posición, rol, texto y enlace al archivo */}
      <div className="mt-3 flex flex-col items-center gap-1.5 max-w-2xl text-center">
        <div className="flex items-center gap-2 text-[11px] text-bone-700">
          <span className="tabular-nums">
            {index + 1} / {slides.length}
          </span>
          <span className="text-carbon-600">·</span>
          <span className="text-gold-500">{ROLE_LABEL[slide.rol] ?? slide.rol}</span>
          <a
            href={slide.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 hover:text-bone-500 transition-colors"
            title="Abrir el PNG original en una pestaña"
          >
            <ExternalLink size={11} /> original
          </a>
        </div>
        <p className="text-[11px] text-bone-500 leading-snug line-clamp-2">{slide.texto}</p>
      </div>
    </div>
  )
}
