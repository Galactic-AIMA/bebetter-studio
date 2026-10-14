import { useEffect } from 'react'
import { X } from '@phosphor-icons/react'

interface Props {
  src: string
  filename?: string
  onClose: () => void
}

// Para ver el reel recién generado sin salir de la sala. Esc o el velo lo cierran.
export default function VideoResultModal({ src, filename, onClose }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reel generado"
      className="fixed inset-0 z-50 flex items-center justify-center bg-velo p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="aviso-entra relative flex max-h-[92dvh] flex-col overflow-hidden rounded-preview bg-s1 shadow-[0_40px_120px_-20px_rgb(0_0_0/.9)] ring-1 ring-hueso/[.06]">
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-2 top-2 z-10 grid h-10 w-10 place-items-center rounded-control bg-velo text-hueso-2 transition-colors duration-rapido ease-mesa hover:text-hueso lg:h-8 lg:w-8"
        >
          <X size={16} />
        </button>
        <video src={src} controls autoPlay playsInline className="max-h-[86dvh] w-auto bg-sala" />
        {filename && <p className="truncate px-3 py-2 font-mono text-meta text-hueso-3">{filename}</p>}
      </div>
    </div>
  )
}
