import { useEffect, useCallback } from 'react'
import { X, CaretLeft, CaretRight, ArrowSquareOut } from '@phosphor-icons/react'
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

  const flecha = 'grid h-10 w-10 shrink-0 place-items-center rounded-full bg-velo text-hueso-2 transition-colors duration-rapido ease-mesa hover:text-hueso'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Slide ${index + 1} de ${slides.length}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-sala/95 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <button onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)" className={`absolute right-3 top-3 z-10 ${flecha}`}>
        <X size={18} />
      </button>

      <div className="flex max-h-full max-w-full items-center gap-3">
        {slides.length > 1 && (
          <button onClick={prev} aria-label="Slide anterior" title="Anterior (←)" className={flecha}>
            <CaretLeft size={20} weight="light" />
          </button>
        )}
        <img
          src={slide.publicUrl}
          alt={`Slide ${slide.n}`}
          className="max-h-[82dvh] w-auto max-w-full rounded-panel object-contain shadow-[0_40px_120px_-20px_rgb(0_0_0/.9)]"
        />
        {slides.length > 1 && (
          <button onClick={next} aria-label="Slide siguiente" title="Siguiente (→)" className={flecha}>
            <CaretRight size={20} weight="light" />
          </button>
        )}
      </div>

      {/* Pie: posición, rol, texto y enlace al archivo */}
      <div className="mt-3 flex max-w-2xl flex-col items-center gap-1.5 text-center">
        <div className="flex items-center gap-3 font-mono text-meta text-hueso-3">
          <span className="tabular-nums">{index + 1} / {slides.length}</span>
          <span className="text-oro">{ROLE_LABEL[slide.rol] ?? slide.rol}</span>
          <a
            href={slide.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 transition-colors duration-rapido ease-mesa hover:text-hueso"
            title="Abrir el PNG original en una pestaña"
          >
            <ArrowSquareOut size={12} /> original
          </a>
        </div>
        <p className="line-clamp-2 text-ui text-hueso">{slide.texto}</p>
      </div>
    </div>
  )
}
