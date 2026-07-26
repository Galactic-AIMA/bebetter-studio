import { X, Wand2, Sparkles, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { aiImagesApi } from '../../api'
import { ImageItem } from '../../types'

interface Props {
  phrase: string
  phraseId: string | null
  onClose: () => void
  onGenerated: (img: ImageItem) => void
}

const ASPECTS: { value: string; label: string }[] = [
  { value: '9:16', label: '9:16 · Reel' },
  { value: '4:5', label: '4:5 · Carrusel' },
  { value: '1:1', label: '1:1 · Post' },
]

const hasPhrase = (p: string) => p && p !== 'Tu frase aquí...' && p.length >= 10

export default function AIImageModal({ phrase, phraseId, onClose, onGenerated }: Props) {
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('9:16')
  const [loadingPrompt, setLoadingPrompt] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const proposePrompt = () => {
    if (!hasPhrase(phrase)) return
    setLoadingPrompt(true)
    setError(null)
    aiImagesApi
      .proposePrompt(phraseId ?? undefined, phraseId ? undefined : phrase)
      .then((r) => setPrompt(r.prompt))
      .catch((e) => setError(e?.response?.data?.error || e.message))
      .finally(() => setLoadingPrompt(false))
  }

  // Pre-carga el prompt propuesto al abrir (si hay frase activa)
  useEffect(() => {
    proposePrompt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setGenerating(true)
    setError(null)
    try {
      const img = await aiImagesApi.generate(prompt.trim(), aspect)
      onGenerated(img)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Error al generar')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !generating) onClose()
      }}
    >
      <div className="relative w-full max-w-lg bg-carbon-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-carbon-700 shrink-0">
          <Wand2 size={15} className="text-gold-500" />
          <h2 className="text-sm font-semibold tracking-wide text-bone-500">Generar imagen con IA</h2>
          <button
            onClick={onClose}
            disabled={generating}
            className="ml-auto p-1.5 rounded-lg bg-carbon-700/80 text-bone-700 hover:text-bone-500 transition-colors disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-4">
          <p className="text-[11px] leading-relaxed text-bone-700">
            Se genera un fondo simbólico con estética de marca (RAW · STOIC · CINEMATIC),{' '}
            <span className="text-bone-500">sin texto</span>, para poner la frase encima. Se guarda en
            el banco y entra al matching automáticamente. Proveedor: KIE (Nano Banana Pro).
          </p>

          {/* Prompt editable */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-bone-500">Prompt (editable)</label>
              <button
                onClick={proposePrompt}
                disabled={loadingPrompt || generating || !hasPhrase(phrase)}
                className="flex items-center gap-1 text-[10px] text-gold-500 hover:text-gold-400 transition-colors disabled:opacity-40"
                title={hasPhrase(phrase) ? 'Reproponer desde la frase activa' : 'Selecciona una frase primero'}
              >
                <Sparkles size={10} className={loadingPrompt ? 'animate-pulse' : ''} />
                {loadingPrompt ? 'Proponiendo…' : 'Proponer desde la frase'}
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={generating}
              rows={8}
              placeholder={
                hasPhrase(phrase)
                  ? 'Cargando prompt propuesto…'
                  : 'Escribe un prompt o selecciona una frase para proponerlo automáticamente.'
              }
              className="w-full bg-carbon-900 border border-carbon-600 rounded-lg px-3 py-2 text-xs text-bone-500 leading-relaxed resize-y focus:outline-none focus:border-gold-500/60 disabled:opacity-60"
            />
          </div>

          {/* Formato */}
          <div>
            <label className="block text-[11px] font-medium text-bone-500 mb-1.5">Formato</label>
            <div className="flex items-center rounded-lg overflow-hidden border border-carbon-600 text-xs w-max">
              {ASPECTS.map((a) => (
                <button
                  key={a.value}
                  onClick={() => setAspect(a.value)}
                  disabled={generating}
                  className={`px-3 py-1.5 transition-colors disabled:opacity-40 ${
                    aspect === a.value ? 'bg-carbon-600 text-gold-500 font-medium' : 'text-bone-700 hover:text-bone-500'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-[11px] text-neon-red bg-neon-red/10 border border-neon-red/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-carbon-700 shrink-0">
          {generating && (
            <span className="text-[11px] text-gold-500 flex items-center gap-1.5">
              <RefreshCw size={11} className="animate-spin" />
              Generando… puede tardar ~1 min
            </span>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="ml-auto flex items-center gap-1.5 text-xs font-medium bg-[#E8E4DC] text-[#0A0A0A] rounded-lg px-4 py-2 hover:bg-white transition-colors disabled:opacity-40"
          >
            <Wand2 size={13} />
            {generating ? 'Generando…' : 'Generar'}
          </button>
        </div>
      </div>
    </div>
  )
}
