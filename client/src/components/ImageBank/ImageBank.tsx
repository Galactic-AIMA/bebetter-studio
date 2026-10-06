import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Shuffle, UploadSimple, ArrowsClockwise, Sparkle, MagicWand, Check, WarningCircle } from '@phosphor-icons/react'
import { imagesApi, phrasesApi, pinterestApi, PinterestStatus } from '../../api'
import { ImageItem, ImageRecommendation } from '../../types'
import { useVideoStore } from '../../store/videoStore'
import AIImageModal from './AIImageModal'
import { Progreso } from '../ui/mesa'

function formatTimeAgo(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'hace un momento'
  if (diffMins < 60) return `hace ${diffMins} min`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `hace ${diffHours}h`
  return `hace ${Math.floor(diffHours / 24)}d`
}

export default function ImageBank() {
  const [images, setImages] = useState<ImageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hideUsed, setHideUsed] = useState(false)
  const [pinterest, setPinterest] = useState<PinterestStatus | null>(null)
  const [syncingApi, setSyncingApi] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null)
  const [analyzeProg, setAnalyzeProg] = useState<{ done: number; total: number } | null>(null)
  const [recommendations, setRecommendations] = useState<ImageRecommendation[]>([])
  const [recommendPhrase, setRecommendPhrase] = useState<string>('')
  const [showAIModal, setShowAIModal] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { config, setConfig, setSelectedImage, setCompatiblePhraseIds, selectedPhraseId, analyzingImages: analyzing, setAnalyzingImages: setAnalyzing } = useVideoStore()

  const load = async () => {
    setLoading(true)
    try {
      const data = await imagesApi.list()
      setImages(data)
    } finally {
      setLoading(false)
    }
  }

  const loadPinterestStatus = async () => {
    try {
      const data = await pinterestApi.status()
      setPinterest(data)
    } catch {
      // silently ignore if Pinterest not available
    }
  }

  useEffect(() => {
    load()
    loadPinterestStatus()
  }, [])

  // Recomendaciones cuando cambia la frase seleccionada
  const phrase = config.text.content
  const fetchRecommendations = useCallback(async (text: string, phraseId: string | null) => {
    if (!text || text === 'Tu frase aquí...' || text.length < 10) {
      setRecommendations([])
      setRecommendPhrase('')
      return
    }
    try {
      const id = phraseId ?? text
      const { recommendations: recs } = await imagesApi.recommend(id, phraseId ? undefined : text)
      setRecommendations(recs)
      setRecommendPhrase(text)
    } catch {
      // silencioso
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => fetchRecommendations(phrase, selectedPhraseId ?? null), 600)
    return () => clearTimeout(timer)
  }, [phrase, selectedPhraseId, fetchRecommendations])

  const handlePinterestApiSync = async () => {
    setSyncingApi(true)
    try {
      await pinterestApi.syncApi()
      await Promise.all([load(), loadPinterestStatus()])
    } finally {
      setSyncingApi(false)
    }
  }

  const handleAnalyzeAll = async () => {
    setAnalyzing(true)
    setAnalyzeResult(null)
    setAnalyzeProg(null)
    // Poll del progreso mientras corre la petición larga (analyze-all no responde
    // hasta terminar, así que el contador viene de /analyze-progress).
    const poll = async () => {
      try {
        const p = await imagesApi.analyzeProgress()
        if (p.running || p.total > 0) setAnalyzeProg({ done: p.done, total: p.total })
      } catch { /* ignore */ }
    }
    poll()
    const timer = window.setInterval(poll, 2000)
    try {
      const { processed, skipped, errors } = await imagesApi.analyzeAll()
      await load()
      if (recommendPhrase) await fetchRecommendations(recommendPhrase, selectedPhraseId ?? null)
      if (errors.length > 0) {
        setAnalyzeResult(`${processed} analizadas · ${errors.length} con error (${errors[0]})`)
      } else {
        setAnalyzeResult(`${processed} analizadas, ${skipped} ya tenían tags`)
        setTimeout(() => setAnalyzeResult(null), 5000)
      }
    } catch {
      setAnalyzeResult('Error al analizar')
    } finally {
      window.clearInterval(timer)
      setAnalyzing(false)
      setAnalyzeProg(null)
    }
  }

  const selectImage = async (img: ImageItem) => {
    setConfig({ imageId: img.id, imagePath: img.path, imagePreviewUrl: img.url })
    setSelectedImage(img.id, img.tags ?? [])
    try {
      const { recommendations } = await phrasesApi.recommendForImage(img.id)
      setCompatiblePhraseIds(recommendations.map((r) => r.phraseId))
    } catch {
      setCompatiblePhraseIds([])
    }
  }

  const pickRandom = async () => {
    if (hideUsed) {
      const pool = images.filter((img) => (img.usageCount ?? 0) === 0)
      if (!pool.length) return
      selectImage(pool[Math.floor(Math.random() * pool.length)])
    } else {
      const img = await imagesApi.random()
      selectImage(img)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const img = await imagesApi.upload(file)
    await load()
    selectImage(img)
  }

  const handleAIGenerated = async (img: ImageItem) => {
    setShowAIModal(false)
    await load()
    if (recommendPhrase) await fetchRecommendations(recommendPhrase, selectedPhraseId ?? null)
    selectImage(img)
  }

  const scoreMap = new Map(recommendations.map((r) => [r.imageId, r.score]))
  const hasRecommendations = recommendations.length > 0

  const hasUsed = images.some((img) => (img.usageCount ?? 0) > 0)
  const filtered = hideUsed ? images.filter((img) => (img.usageCount ?? 0) === 0) : images

  // Si hay recomendaciones: compatibles primero, resto al final
  const visible = hasRecommendations
    ? [
        ...filtered.filter((img) => (scoreMap.get(img.id) ?? 0) > 0).sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0)),
        ...filtered.filter((img) => (scoreMap.get(img.id) ?? 0) === 0),
      ]
    : filtered

  const unanalyzedCount = images.filter((img) => !img.analyzedAt).length

  return (
    <div className="flex flex-col">
      {showAIModal && (
        <AIImageModal
          phrase={phrase}
          phraseId={selectedPhraseId ?? null}
          textY={config.text.position.y}
          onClose={() => setShowAIModal(false)}
          onGenerated={handleAIGenerated}
        />
      )}

      <div className="flex flex-col gap-3 border-b border-linea px-5 pb-4 pt-4 lg:pt-3">
        {!loading && images.length > 0 && (
          <p className="text-ui text-hueso-2">
            <span className="font-mono">{images.length}</span> fondos
            {unanalyzedCount > 0 && <> · <span className="font-mono">{unanalyzedCount}</span> sin analizar</>}
          </p>
        )}

        {pinterest?.pinterestApiConfigured && (
          <div className="flex items-center justify-between gap-2 font-mono text-meta text-hueso-3">
            <span>
              Pinterest ·{' '}
              {pinterest.lastSync
                ? `${formatTimeAgo(pinterest.lastSync.timestamp)} · ${pinterest.lastSync.newImages} nuevas`
                : 'sin sincronizar'}
            </span>
            <button onClick={handlePinterestApiSync} disabled={syncingApi} className="btn-fantasma font-sans">
              <ArrowsClockwise size={16} className={syncingApi ? 'text-oro' : ''} />
              {syncingApi ? 'Sincronizando…' : 'Sincronizar'}
            </button>
          </div>
        )}

        {hasUsed && (
          <div className="flex flex-wrap gap-1.5">
            <button className="chip" aria-pressed={hideUsed} onClick={() => setHideUsed(!hideUsed)}>
              Sin usar
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={pickRandom} className="btn-sec">
            <Shuffle size={16} /> Otro fondo
          </button>
          <button onClick={() => fileRef.current?.click()} className="btn-sec">
            <UploadSimple size={16} /> Subir
          </button>
          <button onClick={() => setShowAIModal(true)} className="btn-sec">
            <MagicWand size={16} /> Generar con IA
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </div>

        <button
          onClick={handleAnalyzeAll}
          disabled={analyzing}
          className="btn-fantasma self-start"
          title="Etiqueta los fondos con IA para emparejarlos con las frases"
        >
          <Sparkle size={16} className={analyzing ? 'text-oro' : ''} />
          {analyzing
            ? analyzeProg && analyzeProg.total > 0
              ? <>Analizando… <span className="font-mono">{analyzeProg.done}/{analyzeProg.total}</span></>
              : 'Analizando…'
            : 'Analizar banco con IA'}
        </button>

        {analyzing && analyzeProg && analyzeProg.total > 0 && (
          <Progreso actual={analyzeProg.done} total={analyzeProg.total} label="Progreso del análisis" />
        )}

        {analyzeResult && (
          <p role="status" className={`flex items-center gap-1.5 text-ui ${analyzeResult.startsWith('Error') ? 'text-lacre' : 'text-hueso-2'}`}>
            {analyzeResult.startsWith('Error') ? <WarningCircle size={16} /> : <Check size={16} />}
            {analyzeResult}
          </p>
        )}
      </div>

      {hasRecommendations && (
        <p className="flex items-center gap-1.5 border-b border-linea px-5 py-2 font-mono text-meta text-hueso-3">
          <Sparkle size={14} className="text-oro" /> Ordenadas por afinidad con la frase
        </p>
      )}

      {loading ? (
        <p className="px-5 py-6 text-ui text-hueso-3">Cargando fondos…</p>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-5 py-10">
          <p className="pt-[.16em] font-display text-display uppercase text-hueso">Sin fondos</p>
          <p className="text-body text-hueso-2">El banco de imágenes está vacío. Sube una o genera la primera con IA.</p>
          <button onClick={() => fileRef.current?.click()} className="btn-sec">
            <UploadSimple size={16} /> Subir imagen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 p-5" role="listbox" aria-label="Banco de imágenes">
          {visible.map((img) => {
            const isCompatible = (scoreMap.get(img.id) ?? 0) > 0
            const isSelected = config.imageId === img.id
            const usos = img.usageCount ?? 0

            return (
              <button
                key={img.id}
                role="option"
                aria-selected={isSelected}
                aria-label={`${img.filename}${usos ? `, ${usos} usos` : ', sin usar'}${isCompatible ? ', afín' : ''}`}
                onClick={() => selectImage(img)}
                className={`group relative aspect-[9/16] overflow-hidden rounded-control border transition-colors duration-rapido ease-mesa ${
                  isSelected
                    ? 'border-oro ring-1 ring-oro'
                    : 'border-linea-2 hover:border-borde-control'
                }`}
              >
                <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />

                {(img.origen === 'ia' || usos > 0) && (
                  <span className="absolute inset-x-1 top-1 flex justify-between font-mono text-meta leading-none">
                    {img.origen === 'ia' ? <span className="rounded-[4px] bg-velo px-1 py-0.5 text-hueso">IA</span> : <span />}
                    {usos > 0 && <span className="rounded-[4px] bg-velo px-1 py-0.5 text-hueso-2">×{usos}</span>}
                  </span>
                )}

                {(isSelected || isCompatible) && (
                  <span className={`absolute bottom-1 left-1 rounded-[4px] bg-velo px-1 py-0.5 font-mono text-meta leading-none ${isSelected ? 'text-oro' : 'text-hueso-2'}`}>
                    {isSelected ? 'en pantalla' : 'afín'}
                  </span>
                )}
              </button>
            )
          })}
          {visible.length === 0 && (
            <p className="col-span-3 py-8 text-center text-ui text-hueso-3">
              Todos los fondos se han usado ya. Quita el filtro «Sin usar» para verlos.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
