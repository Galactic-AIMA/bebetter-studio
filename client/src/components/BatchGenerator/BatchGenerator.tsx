import React, { useEffect, useState } from 'react'
import { CheckSquare, Square, Layers } from 'lucide-react'
import { phrasesApi, imagesApi, videosApi, imagesOutputApi } from '../../api'
import { Phrase, ImageItem } from '../../types'
import { useVideoStore } from '../../store/videoStore'

interface BatchResult {
  phraseText: string
  filename: string
  publicUrl: string
  ok: boolean
  error?: string
}

function computeLines(text: string, fontSize: number, font: string, maxPx: number): string[] {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = `${fontSize}px ${font.replace(/-/g, ' ')}, Arial, sans-serif`
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (ctx.measureText(test).width > maxPx && current) { lines.push(current); current = word }
    else current = test
  }
  if (current) lines.push(current)
  return lines
}

export default function BatchGenerator() {
  const { config, mode } = useVideoStore()

  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [images, setImages] = useState<ImageItem[]>([])
  const [loadingData, setLoadingData] = useState(true)

  const [selectedPhraseIds, setSelectedPhraseIds] = useState<Set<string>>(new Set())
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set())

  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [results, setResults] = useState<BatchResult[]>([])

  useEffect(() => {
    Promise.all([phrasesApi.list(), imagesApi.list()]).then(([ps, imgs]) => {
      setPhrases(ps)
      setImages(imgs)
      setLoadingData(false)
    })
  }, [])

  const togglePhrase = (id: string) =>
    setSelectedPhraseIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleImage = (id: string) =>
    setSelectedImageIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleAllPhrases = () =>
    setSelectedPhraseIds(
      selectedPhraseIds.size === phrases.length ? new Set() : new Set(phrases.map((p) => p.id))
    )

  const toggleAllImages = () =>
    setSelectedImageIds(
      selectedImageIds.size === images.length ? new Set() : new Set(images.map((i) => i.id))
    )

  const selectedPhrases = phrases.filter((p) => selectedPhraseIds.has(p.id))
  const selectedImages = images.filter((img) => selectedImageIds.has(img.id))
  const isRunning = progress !== null

  const generate = async () => {
    if (!selectedPhrases.length || !selectedImages.length) return
    setResults([])
    setProgress({ current: 0, total: selectedPhrases.length })

    const newResults: BatchResult[] = []

    for (let i = 0; i < selectedPhrases.length; i++) {
      const phrase = selectedPhrases[i]
      const image = selectedImages[i % selectedImages.length]
      setProgress({ current: i + 1, total: selectedPhrases.length })

      try {
        const itemConfig = {
          ...config,
          imageId: image.id,
          imagePath: image.path,
          imagePreviewUrl: image.url,
          text: { ...config.text, content: phrase.text },
        }

        if (mode === 'video') {
          const maxPx = (itemConfig.text.maxWidth / 100) * itemConfig.resolution.width
          const wrappedLines = computeLines(phrase.text, itemConfig.text.fontSize, itemConfig.text.font, maxPx)
          const video = await videosApi.generate({ ...itemConfig, wrappedLines }, phrase.id)
          newResults.push({ phraseText: phrase.text, filename: video.filename, publicUrl: video.publicUrl, ok: true })
        } else {
          const imgConfig = {
            imageId: image.id,
            imagePath: image.path,
            text: itemConfig.text,
            resolution: itemConfig.resolution,
            watermark: itemConfig.watermark,
          }
          const img = await imagesOutputApi.generate(imgConfig, phrase.id, 'combined')
          newResults.push({ phraseText: phrase.text, filename: img.filename, publicUrl: img.publicUrl, ok: true })
        }
      } catch (e: any) {
        newResults.push({ phraseText: phrase.text, filename: '', publicUrl: '', ok: false, error: e.message })
      }
    }

    setResults(newResults)
    setProgress(null)
  }

  const okCount = results.filter((r) => r.ok).length
  const errCount = results.filter((r) => !r.ok).length

  if (loadingData) {
    return <p className="p-4 text-xs text-bone-700">Cargando...</p>
  }

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Frases */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-bone-700">
            Frases ({selectedPhraseIds.size}/{phrases.length})
          </h3>
          <button onClick={toggleAllPhrases} className="text-xs text-bone-700 hover:text-bone-500 transition-colors">
            {selectedPhraseIds.size === phrases.length ? 'Quitar todas' : 'Todas'}
          </button>
        </div>
        <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
          {phrases.map((p) => {
            const selected = selectedPhraseIds.has(p.id)
            return (
              <button
                key={p.id}
                onClick={() => togglePhrase(p.id)}
                className={`flex items-start gap-2 text-left px-2 py-1.5 rounded-lg transition-colors text-xs ${
                  selected ? 'bg-neon-red/20 text-neon-red' : 'bg-carbon-700 text-bone-700 hover:bg-carbon-600'
                }`}
              >
                {selected ? <CheckSquare size={13} className="mt-0.5 shrink-0" /> : <Square size={13} className="mt-0.5 shrink-0" />}
                <span className="leading-relaxed line-clamp-2">{p.text}</span>
              </button>
            )
          })}
          {phrases.length === 0 && <p className="text-xs text-bone-700 py-2">No hay frases en el banco.</p>}
        </div>
      </section>

      {/* ImÃ¡genes */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-bone-700">
            ImÃ¡genes ({selectedImageIds.size}/{images.length})
          </h3>
          <button onClick={toggleAllImages} className="text-xs text-bone-700 hover:text-bone-500 transition-colors">
            {selectedImageIds.size === images.length ? 'Quitar todas' : 'Todas'}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
          {images.map((img) => {
            const selected = selectedImageIds.has(img.id)
            return (
              <button
                key={img.id}
                onClick={() => toggleImage(img.id)}
                className={`relative aspect-[9/16] overflow-hidden rounded border-2 transition-all ${
                  selected ? 'border-neon-red' : 'border-transparent hover:border-carbon-600'
                }`}
              >
                <img src={img.url} alt={img.filename} className="w-full h-full object-cover" />
                {selected && (
                  <div className="absolute inset-0 bg-neon-red/20 flex items-center justify-center">
                    <CheckSquare size={16} className="text-neon-red" />
                  </div>
                )}
              </button>
            )
          })}
          {images.length === 0 && <p className="col-span-4 text-xs text-bone-700 py-2">No hay imÃ¡genes.</p>}
        </div>
        {selectedImages.length > 0 && selectedPhrases.length > selectedImages.length && (
          <p className="text-xs text-bone-700 mt-1">
            Las imÃ¡genes se ciclarÃ¡n ({selectedImages.length} imagen{selectedImages.length !== 1 ? 'es' : ''} para {selectedPhrases.length} frases)
          </p>
        )}
      </section>

      {/* BotÃ³n generar */}
      <button
        onClick={generate}
        disabled={isRunning || !selectedPhrases.length || !selectedImages.length}
        className="flex items-center justify-center gap-2 bg-gold-500 hover:bg-gold-600 disabled:bg-carbon-600 disabled:cursor-not-allowed text-bone-500 text-sm font-medium rounded-xl px-4 py-2.5 transition-colors"
      >
        <Layers size={15} />
        {isRunning
          ? `Generando ${progress!.current}/${progress!.total}...`
          : `Generar ${selectedPhrases.length || 0} ${mode === 'video' ? 'videos' : 'imÃ¡genes'}`}
      </button>

      {/* Barra de progreso */}
      {isRunning && (
        <div className="w-full bg-carbon-700 rounded-full h-1.5">
          <div
            className="bg-neon-red h-1.5 rounded-full transition-all"
            style={{ width: `${(progress!.current / progress!.total) * 100}%` }}
          />
        </div>
      )}

      {/* Resultados */}
      {results.length > 0 && (
        <section>
          <p className="text-xs text-bone-700 mb-2">
            {okCount} generado{okCount !== 1 ? 's' : ''}
            {errCount > 0 && <span className="text-neon-red"> Â· {errCount} error{errCount !== 1 ? 'es' : ''}</span>}
          </p>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${r.ok ? 'bg-carbon-700' : 'bg-red-900/20'}`}>
                <span className={`shrink-0 ${r.ok ? 'text-gold-500' : 'text-neon-red'}`}>{r.ok ? 'âœ“' : 'âœ—'}</span>
                {r.ok ? (
                  <a href={r.publicUrl} target="_blank" rel="noreferrer" className="text-gold-500 hover:underline truncate">
                    {r.filename}
                  </a>
                ) : (
                  <span className="text-neon-red truncate">{r.error || 'Error desconocido'}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}


