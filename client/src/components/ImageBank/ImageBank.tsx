import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Shuffle, Upload, RefreshCw, Sparkles } from 'lucide-react'
import { imagesApi, pinterestApi, PinterestStatus } from '../../api'
import { ImageItem, ImageRecommendation } from '../../types'
import { useVideoStore } from '../../store/videoStore'

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
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null)
  const [recommendations, setRecommendations] = useState<ImageRecommendation[]>([])
  const [recommendPhrase, setRecommendPhrase] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const { config, setConfig, setSelectedImageTags, analyzingImages: analyzing, setAnalyzingImages: setAnalyzing, syncingPinterest: syncing, setSyncingPinterest: setSyncing } = useVideoStore()

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
  const fetchRecommendations = useCallback(async (text: string) => {
    if (!text || text === 'Tu frase aquí...' || text.length < 10) {
      setRecommendations([])
      setRecommendPhrase('')
      return
    }
    try {
      const { recommendations: recs } = await imagesApi.recommend(text)
      setRecommendations(recs)
      setRecommendPhrase(text)
    } catch {
      // silencioso
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => fetchRecommendations(phrase), 600)
    return () => clearTimeout(timer)
  }, [phrase, fetchRecommendations])

  const handlePinterestSync = async () => {
    setSyncing(true)
    try {
      await pinterestApi.sync()
      await Promise.all([load(), loadPinterestStatus()])
    } finally {
      setSyncing(false)
    }
  }

  const handleAnalyzeAll = async () => {
    setAnalyzing(true)
    setAnalyzeResult(null)
    try {
      const { processed, skipped, errors } = await imagesApi.analyzeAll()
      await load()
      if (recommendPhrase) await fetchRecommendations(recommendPhrase)
      if (errors.length > 0) {
        setAnalyzeResult(`Error: ${errors[0]}`)
      } else {
        setAnalyzeResult(`${processed} analizadas, ${skipped} ya tenían tags`)
        setTimeout(() => setAnalyzeResult(null), 5000)
      }
    } catch {
      setAnalyzeResult('Error al analizar')
    } finally {
      setAnalyzing(false)
    }
  }

  const selectImage = (img: ImageItem) => {
    setConfig({ imageId: img.id, imagePath: img.path, imagePreviewUrl: img.url })
    setSelectedImageTags(img.tags ?? [])
  }

  const pickRandom = async () => {
    const img = await imagesApi.random()
    selectImage(img)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const img = await imagesApi.upload(file)
    await load()
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
    <div className="flex flex-col gap-3 p-4">
      {pinterest?.isConfigured && (
        <div className="flex items-center justify-between text-xs bg-carbon-700/50 rounded-lg px-3 py-2 border border-carbon-600/50">
          <span className="flex items-center gap-1.5 text-bone-700">
            <span className="text-neon-red">◈</span>
            {pinterest.lastSync
              ? `${formatTimeAgo(pinterest.lastSync.timestamp)} · ${pinterest.lastSync.newImages} nuevas`
              : 'Sin sincronizar aún'}
          </span>
          <button
            onClick={handlePinterestSync}
            disabled={syncing}
            className="flex items-center gap-1 text-bone-700 hover:text-bone-500 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Sincronizar'}
          </button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={pickRandom}
          className="flex items-center gap-1.5 text-xs bg-carbon-700 hover:bg-carbon-600 border border-carbon-600 rounded-lg px-3 py-2 text-bone-500 transition-colors"
        >
          <Shuffle size={13} /> Aleatoria
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 text-xs bg-carbon-700 hover:bg-carbon-600 border border-carbon-600 rounded-lg px-3 py-2 text-bone-500 transition-colors"
        >
          <Upload size={13} /> Subir imagen
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      </div>

      {/* Botón Analizar */}
      <button
        onClick={handleAnalyzeAll}
        disabled={analyzing}
        className="flex items-center justify-between gap-2 text-xs bg-carbon-700/50 hover:bg-carbon-700 border border-carbon-600/50 rounded-lg px-3 py-2 text-bone-700 hover:text-bone-500 transition-colors disabled:opacity-50"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles size={11} className={analyzing ? 'animate-pulse text-gold-500' : ''} />
          {analyzing ? 'Analizando... (puede tardar varios minutos)' : 'Analizar banco con IA'}
        </span>
        {unanalyzedCount > 0 && !analyzing && (
          <span className="text-[10px] bg-gold-500/10 text-gold-500 px-1.5 py-0.5 rounded">
            {unanalyzedCount} sin analizar
          </span>
        )}
      </button>

      {analyzeResult && (
        <p className={`text-[11px] px-1 ${analyzeResult.startsWith('Error') ? 'text-neon-red' : 'text-gold-500'}`}>
          {analyzeResult}
        </p>
      )}

      {hasRecommendations && (
        <p className="text-[10px] text-gold-500/70 px-1">
          ✦ Ordenadas por compatibilidad con la frase
        </p>
      )}

      {hasUsed && (
        <button
          onClick={() => setHideUsed(!hideUsed)}
          className="text-xs text-bone-700 hover:text-bone-500 transition-colors text-left"
        >
          {hideUsed ? '+ Mostrar todas' : '○ Ocultar usadas'}
        </button>
      )}

      {loading ? (
        <p className="text-xs text-bone-700">Cargando imágenes...</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {visible.map((img) => {
            const score = scoreMap.get(img.id) ?? 0
            const isCompatible = score > 0
            const isSelected = config.imageId === img.id

            return (
              <button
                key={img.id}
                onClick={() => selectImage(img)}
                className={`relative aspect-[9/16] overflow-hidden rounded-lg border-2 transition-all ${
                  isSelected
                    ? 'border-neon-red'
                    : isCompatible
                    ? 'border-gold-500/60 hover:border-gold-500'
                    : 'border-transparent hover:border-carbon-600'
                }`}
              >
                <img src={img.url} alt={img.filename} className="w-full h-full object-cover" />

                {/* Badge de uso */}
                {(img.usageCount ?? 0) > 0 && (
                  <span className="absolute top-1 right-1 text-xs bg-black/70 text-gold-500 rounded px-1 py-0.5 font-medium leading-none">
                    ×{img.usageCount}
                  </span>
                )}

                {/* Badge compatible */}
                {isCompatible && !isSelected && (
                  <span className="absolute bottom-1 left-1 text-[9px] bg-gold-500/90 text-carbon-900 rounded px-1 py-0.5 font-bold leading-none">
                    ✦
                  </span>
                )}
              </button>
            )
          })}
          {visible.length === 0 && (
            <p className="col-span-3 text-xs text-bone-700 text-center py-8">
              No hay imágenes en el banco.
              <br />
              Sube una o revisa la carpeta configurada.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
