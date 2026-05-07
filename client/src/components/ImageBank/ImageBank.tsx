import React, { useEffect, useState, useRef } from 'react'
import { Shuffle, Upload, RefreshCw } from 'lucide-react'
import { imagesApi, pinterestApi, PinterestStatus } from '../../api'
import { ImageItem } from '../../types'
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
  const [syncing, setSyncing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { config, setConfig } = useVideoStore()

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

  const handlePinterestSync = async () => {
    setSyncing(true)
    try {
      await pinterestApi.sync()
      await Promise.all([load(), loadPinterestStatus()])
    } finally {
      setSyncing(false)
    }
  }

  const selectImage = (img: ImageItem) => {
    setConfig({
      imageId: img.id,
      imagePath: img.path,
      imagePreviewUrl: img.url,
    })
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

  const hasUsed = images.some((img) => (img.usageCount ?? 0) > 0)
  const visible = hideUsed ? images.filter((img) => (img.usageCount ?? 0) === 0) : images

  return (
    <div className="flex flex-col gap-3 p-4">
      {pinterest?.isConfigured && (
        <div className="flex items-center justify-between text-xs bg-gray-800/50 rounded-lg px-3 py-2 border border-gray-700/50">
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="text-red-400">◈</span>
            {pinterest.lastSync
              ? `${formatTimeAgo(pinterest.lastSync.timestamp)} · ${pinterest.lastSync.newImages} nuevas`
              : 'Sin sincronizar aún'}
          </span>
          <button
            onClick={handlePinterestSync}
            disabled={syncing}
            className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Sincronizar'}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={pickRandom}
          className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 transition-colors"
        >
          <Shuffle size={13} /> Aleatoria
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 transition-colors"
        >
          <Upload size={13} /> Subir imagen
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      </div>

      {hasUsed && (
        <button
          onClick={() => setHideUsed(!hideUsed)}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors text-left"
        >
          {hideUsed ? '+ Mostrar todas' : '○ Ocultar usadas'}
        </button>
      )}

      {loading ? (
        <p className="text-xs text-gray-500">Cargando imágenes...</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {visible.map((img) => (
            <button
              key={img.id}
              onClick={() => selectImage(img)}
              className={`relative aspect-[9/16] overflow-hidden rounded-lg border-2 transition-all ${
                config.imageId === img.id
                  ? 'border-brand-500'
                  : 'border-transparent hover:border-gray-600'
              }`}
            >
              <img
                src={img.url}
                alt={img.filename}
                className="w-full h-full object-cover"
              />
              {(img.usageCount ?? 0) > 0 && (
                <span className="absolute top-1 right-1 text-xs bg-black/70 text-brand-400 rounded px-1 py-0.5 font-medium leading-none">
                  ×{img.usageCount}
                </span>
              )}
            </button>
          ))}
          {visible.length === 0 && (
            <p className="col-span-3 text-xs text-gray-500 text-center py-8">
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
