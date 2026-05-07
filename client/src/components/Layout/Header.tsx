import { Film, Image, HardDrive, Send, RotateCcw, ChevronDown } from 'lucide-react'
import { useRef, useEffect, useState } from 'react'
import { useVideoStore } from '../../store/videoStore'
import { ContentMode } from '../../store/videoStore'

interface Props {
  lastVideoId: string | null
  lastImageId: string | null
  isGenerating: boolean
  toast: { state: 'loading' | 'success' | 'error'; message?: string } | null
  onUploadDrive: () => void
  onPublish: (env: 'test' | 'prod') => void
}

export default function Header({ lastVideoId, lastImageId, isGenerating, toast, onUploadDrive, onPublish }: Props) {
  const { mode, setMode, reset } = useVideoStore()
  const [showEnvMenu, setShowEnvMenu] = useState(false)
  const envMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envMenuRef.current && !envMenuRef.current.contains(e.target as Node)) {
        setShowEnvMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const hasResult = lastVideoId || lastImageId
  const busy = toast?.state === 'loading'

  return (
    <header className="flex items-center justify-between px-5 h-12 bg-carbon-800 border-b border-carbon-600 shrink-0 z-10">
      {/* Wordmark */}
      <div className="flex items-center gap-0.5 select-none">
        <span className="text-sm font-semibold tracking-widest text-bone-500">BE</span>
        <span className="text-sm font-semibold tracking-widest text-blood-500">BETTER</span>
        <span className="text-sm font-semibold tracking-widest text-bone-700 ml-1.5">STUDIO</span>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center rounded-lg overflow-hidden border border-carbon-600 text-xs">
        {([
          { id: 'video' as ContentMode, icon: Film, label: 'Video' },
          { id: 'image' as ContentMode, icon: Image, label: 'Imagen' },
        ]).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
              mode === id
                ? 'bg-carbon-700 text-bone-500 border-l border-neon-red first:border-l-0'
                : 'bg-carbon-800 text-bone-700 hover:text-bone-500'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {hasResult && (
          <>
            <button
              onClick={onUploadDrive}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-bone-700 hover:text-bone-500 border border-carbon-600 rounded-lg bg-carbon-700 hover:bg-carbon-600 disabled:opacity-40 transition-colors"
            >
              <HardDrive size={12} /> Drive
            </button>

            {lastVideoId && (
              <div ref={envMenuRef} className="relative flex">
                <button
                  onClick={() => { onPublish('prod'); setShowEnvMenu(false) }}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-carbon-900 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 rounded-l-lg transition-colors font-medium"
                >
                  <Send size={12} /> Publicar
                </button>
                <button
                  onClick={() => setShowEnvMenu(v => !v)}
                  disabled={busy}
                  className="flex items-center px-1.5 py-1.5 text-xs text-carbon-900 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 border-l border-gold-600 rounded-r-lg transition-colors"
                >
                  <ChevronDown size={12} />
                </button>
                {showEnvMenu && (
                  <div className="absolute top-full right-0 mt-1 bg-carbon-700 border border-carbon-600 rounded-lg overflow-hidden z-20 min-w-max shadow-xl">
                    <button
                      onClick={() => { onPublish('test'); setShowEnvMenu(false) }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-bone-500 hover:bg-carbon-600 transition-colors"
                    >
                      <Send size={11} /> Publicar en test
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <button
          onClick={reset}
          disabled={isGenerating}
          className="p-1.5 text-bone-700 hover:text-bone-500 transition-colors"
          title="Reiniciar"
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </header>
  )
}
