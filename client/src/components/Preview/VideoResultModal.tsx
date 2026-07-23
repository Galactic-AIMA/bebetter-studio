import { X } from 'lucide-react'

interface Props {
  src: string
  filename?: string
  onClose: () => void
}

// Modal simple para reproducir un video generado sin salir del UI.
export default function VideoResultModal({ src, filename, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative bg-carbon-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-carbon-700/80 text-bone-700 hover:text-bone-500 transition-colors"
        >
          <X size={16} />
        </button>
        <video src={src} controls autoPlay playsInline className="max-h-[86vh] w-auto bg-black" />
        {filename && (
          <p className="px-3 py-2 text-[11px] text-bone-700 truncate bg-carbon-800">{filename}</p>
        )}
      </div>
    </div>
  )
}
