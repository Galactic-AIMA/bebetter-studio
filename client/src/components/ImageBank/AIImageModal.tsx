import { MagicWand, Sparkle, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { aiImagesApi } from '../../api'
import { ImageItem } from '../../types'
import PanelDeslizante from '../ui/PanelDeslizante'
import { Segmentos } from '../ui/mesa'

interface Props {
  phrase: string
  phraseId: string | null
  textY: number  // posición vertical del texto en el editor (0–100)
  onClose: () => void
  onGenerated: (img: ImageItem) => void
}

const ASPECTS: { value: string; label: string }[] = [
  { value: '9:16', label: '9:16 reel' },
  { value: '4:5', label: '4:5 carrusel' },
  { value: '1:1', label: '1:1 post' },
]

const hasPhrase = (p: string) => p && p !== 'Tu frase aquí...' && p.length >= 10

export default function AIImageModal({ phrase, phraseId, textY, onClose, onGenerated }: Props) {
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
      .proposePrompt(phraseId ?? undefined, phraseId ? undefined : phrase, textY)
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
    <PanelDeslizante
      titulo="Fondo con IA"
      onClose={onClose}
      pie={
        <>
          <span aria-live="polite" className="text-ui text-hueso-2">
            {generating && 'Generando. Tarda cerca de un minuto.'}
          </span>
          <button onClick={handleGenerate} disabled={generating || !prompt.trim()} className="btn-sec ml-auto border-hueso">
            <MagicWand size={16} />
            {generating ? 'Generando…' : 'Generar fondo'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5 px-5 py-5">
        <p className="text-ui text-hueso-2">
          Un fondo simbólico con la estética de la marca, <span className="text-hueso">sin texto</span>, para
          poner la frase encima. Se guarda en el banco y entra en el emparejamiento.
          <span className="mt-1 block font-mono text-meta text-hueso-3">KIE · Nano Banana Pro</span>
        </p>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="prompt-ia" className="text-ui text-hueso-3">Prompt</label>
            <button
              onClick={proposePrompt}
              disabled={loadingPrompt || generating || !hasPhrase(phrase)}
              className="btn-fantasma h-10 px-1 lg:h-8"
              title={hasPhrase(phrase) ? 'Vuelve a proponerlo desde la frase activa' : 'Elige una frase primero'}
            >
              <Sparkle size={16} />
              {loadingPrompt ? 'Proponiendo…' : 'Proponer desde la frase'}
            </button>
          </div>
          <textarea
            id="prompt-ia"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
            rows={9}
            placeholder={
              hasPhrase(phrase)
                ? 'Proponiendo un prompt a partir de la frase…'
                : 'Escribe un prompt, o elige una frase para que se proponga solo.'
            }
            className="campo resize-y text-ui disabled:opacity-60"
          />
        </div>

        <Segmentos
          label="Formato"
          value={aspect}
          onChange={setAspect}
          options={ASPECTS.map((a) => ({ value: a.value, label: a.label, disabled: generating && a.value !== aspect }))}
        />

        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-ui text-lacre">
            <WarningCircle size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
      </div>
    </PanelDeslizante>
  )
}
