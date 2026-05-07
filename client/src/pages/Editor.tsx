import React, { useState, useRef, useEffect } from 'react'
import { Wand2, Send, RotateCcw, HardDrive, ChevronDown, Film, Image } from 'lucide-react'
import VideoPreview from '../components/Preview/VideoPreview'
import VideoEditor from '../components/VideoEditor/VideoEditor'
import ImageBank from '../components/ImageBank/ImageBank'
import PhraseBank from '../components/PhraseBank/PhraseBank'
import { useVideoStore } from '../store/videoStore'
import { videosApi, imagesOutputApi } from '../api'
import { VideoRecord, ImageRecord, ImageVariant } from '../types'

type Tab = 'editor' | 'images' | 'phrases'

export default function Editor() {
  const { config, selectedPhraseId, isGenerating, setGenerating, reset, mode, setMode } = useVideoStore()
  const [tab, setTab] = useState<Tab>('editor')
  const [lastVideo, setLastVideo] = useState<VideoRecord | null>(null)
  const [lastImage, setLastImage] = useState<ImageRecord | null>(null)
  const [imageVariant, setImageVariant] = useState<ImageVariant>('combined')
  const [error, setError] = useState<string | null>(null)
  const [showEnvMenu, setShowEnvMenu] = useState(false)
  const envMenuRef = useRef<HTMLDivElement>(null)
  const [toast, setToast] = useState<{ state: 'loading' | 'success' | 'error'; loadingText?: string; successText?: string; message?: string } | null>(null)

  const hasDelimiter = config.text.content.includes('//')

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envMenuRef.current && !envMenuRef.current.contains(e.target as Node)) {
        setShowEnvMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Calcula las líneas con métricas reales del browser (measureText) para que
  // el servidor renderice exactamente lo mismo que muestra el preview canvas.
  const computeWrappedLines = (): string[] => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const { text, resolution } = config
    ctx.font = `${text.fontSize}px ${text.font.replace(/-/g, ' ')}, Arial, sans-serif`
    const maxPx = (text.maxWidth / 100) * resolution.width

    const words = text.content.split(' ')
    const lines: string[] = []
    let current = ''
    for (const word of words) {
      const test = current ? `${current} ${word}` : word
      if (ctx.measureText(test).width > maxPx && current) {
        lines.push(current)
        current = word
      } else {
        current = test
      }
    }
    if (current) lines.push(current)
    return lines
  }

  const generate = async () => {
    if (!config.imageId) {
      setError('Selecciona una imagen primero')
      return
    }
    setError(null)
    setGenerating(true)
    try {
      if (mode === 'video') {
        const wrappedLines = computeWrappedLines()
        const video = await videosApi.generate({ ...config, wrappedLines }, selectedPhraseId ?? undefined)
        setLastVideo(video)
        setLastImage(null)
      } else {
        const imgConfig = {
          imageId: config.imageId,
          imagePath: config.imagePath,
          text: config.text,
          resolution: config.resolution,
          watermark: config.watermark,
        }
        const variant = hasDelimiter ? imageVariant : 'combined'
        const image = await imagesOutputApi.generate(imgConfig, selectedPhraseId ?? undefined, variant)
        setLastImage(image)
        setLastVideo(null)
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setGenerating(false)
    }
  }

  const uploadToDrive = async () => {
    setToast({ state: 'loading', loadingText: 'Subiendo a Drive...', successText: 'Subido a Drive' })
    try {
      if (lastVideo) {
        const { driveUrl } = await videosApi.uploadToDrive(lastVideo.id)
        setLastVideo({ ...lastVideo, driveUrl })
      } else if (lastImage) {
        const { driveUrl } = await imagesOutputApi.uploadToDrive(lastImage.id)
        setLastImage({ ...lastImage, driveUrl })
      }
      setToast({ state: 'success', successText: 'Subido a Drive' })
      setTimeout(() => setToast(null), 4000)
    } catch (e: any) {
      setToast({ state: 'error', message: e.response?.data?.error || e.message })
    }
  }

  const publish = async (env: 'test' | 'prod') => {
    if (!lastVideo) return
    setToast({ state: 'loading', loadingText: `Publicando en ${env}...`, successText: `Publicado en ${env}` })
    try {
      await videosApi.publish(lastVideo.id, env)
      setToast({ state: 'success', successText: `Publicado en ${env}` })
      setTimeout(() => setToast(null), 4000)
    } catch (e: any) {
      setToast({ state: 'error', message: e.response?.data?.error || e.message })
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'editor', label: 'Estilo' },
    { id: 'images', label: 'Imágenes' },
    { id: 'phrases', label: 'Frases' },
  ]

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* ── Panel izquierdo: controles ── */}
      <aside className="w-80 min-w-80 border-r border-gray-800 flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'text-white border-b-2 border-brand-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'editor' && <VideoEditor />}
          {tab === 'images' && <ImageBank />}
          {tab === 'phrases' && <PhraseBank />}
        </div>

      </aside>

      {/* ── Centro: preview ── */}
      <main className="flex-1 flex flex-col items-center justify-center bg-gray-950 p-6 gap-4">

        {/* Toggle Video / Imagen */}
        <div className="flex rounded-xl overflow-hidden border border-gray-700 text-sm">
          <button
            onClick={() => setMode('video')}
            className={`flex items-center gap-2 px-4 py-2 transition-colors ${
              mode === 'video'
                ? 'bg-brand-500 text-white'
                : 'bg-gray-900 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Film size={14} /> Video
          </button>
          <button
            onClick={() => setMode('image')}
            className={`flex items-center gap-2 px-4 py-2 transition-colors ${
              mode === 'image'
                ? 'bg-brand-500 text-white'
                : 'bg-gray-900 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Image size={14} /> Imagen
          </button>
        </div>

        {/* Selector de variante (solo en modo imagen con delimiter //) */}
        {mode === 'image' && hasDelimiter && (
          <div className="flex rounded-xl overflow-hidden border border-gray-700 text-xs">
            {(['combined', 'hook', 'punchline'] as ImageVariant[]).map((v) => (
              <button
                key={v}
                onClick={() => setImageVariant(v)}
                className={`px-3 py-1.5 transition-colors ${
                  imageVariant === v
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                }`}
              >
                {v === 'combined' ? 'Combinada' : v === 'hook' ? 'Solo hook' : 'Solo remate'}
              </button>
            ))}
          </div>
        )}

        <div className="h-full max-h-[calc(100vh-180px)]" style={{ aspectRatio: `${config.resolution.width}/${config.resolution.height}` }}>
          <VideoPreview config={config} />
        </div>

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}

        {/* Acciones */}
        <div className="flex gap-3 flex-wrap justify-center">
          <button
            onClick={generate}
            disabled={isGenerating}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-xl px-6 py-3 transition-colors"
          >
            <Wand2 size={16} />
            {isGenerating
              ? 'Generando...'
              : mode === 'video' ? 'Generar video' : 'Generar imagen'}
          </button>

          {(lastVideo || lastImage) && (
            <>
              <button
                onClick={uploadToDrive}
                disabled={toast?.state === 'loading'}
                className="flex items-center gap-2 bg-blue-900/40 hover:bg-blue-900/60 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-700/50 text-blue-300 rounded-xl px-4 py-3 transition-colors text-sm"
              >
                <HardDrive size={15} /> Subir a Drive
              </button>

              {/* Publicar solo aplica en modo video */}
              {lastVideo && (
                <div ref={envMenuRef} className="relative flex">
                  <button
                    onClick={() => { publish('prod'); setShowEnvMenu(false) }}
                    disabled={toast?.state === 'loading'}
                    className="flex items-center gap-2 bg-green-900/40 hover:bg-green-900/60 disabled:opacity-50 disabled:cursor-not-allowed border border-green-700/50 text-green-300 rounded-l-xl px-4 py-3 transition-colors text-sm"
                  >
                    <Send size={15} /> Publicar
                  </button>
                  <button
                    onClick={() => setShowEnvMenu((v) => !v)}
                    disabled={toast?.state === 'loading'}
                    className="flex items-center bg-green-900/40 hover:bg-green-900/60 disabled:opacity-50 disabled:cursor-not-allowed border-t border-b border-r border-green-700/50 text-green-300 rounded-r-xl px-2 py-3 transition-colors"
                  >
                    <ChevronDown size={14} />
                  </button>
                  {showEnvMenu && (
                    <div className="absolute top-full right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden z-10 min-w-max">
                      <button
                        onClick={() => { publish('test'); setShowEnvMenu(false) }}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-yellow-300 hover:bg-gray-700 transition-colors"
                      >
                        <Send size={13} /> Publicar en test
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <button
            onClick={reset}
            className="text-gray-500 hover:text-gray-300 p-3 transition-colors"
            title="Reiniciar"
          >
            <RotateCcw size={16} />
          </button>
        </div>

        {(lastVideo || lastImage) && (
          <div className="text-center">
            <p className="text-xs text-gray-500">
              {lastVideo ? 'Video' : 'Imagen'} guardado:{' '}
              <a
                href={(lastVideo ?? lastImage)!.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="text-brand-500 hover:underline"
              >
                {(lastVideo ?? lastImage)!.filename}
              </a>
            </p>
          </div>
        )}
      </main>

      {/* Toast de publicación */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          toast.state === 'loading' ? 'bg-gray-800 border border-gray-700 text-gray-200' :
          toast.state === 'success' ? 'bg-green-900/80 border border-green-700 text-green-200' :
          'bg-red-900/80 border border-red-700 text-red-200'
        }`}>
          {toast.state === 'loading' && (
            <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {toast.state === 'success' && <span className="shrink-0">✓</span>}
          {toast.state === 'error' && <span className="shrink-0">✗</span>}
          <span>
            {toast.state === 'loading' && toast.loadingText}
            {toast.state === 'success' && toast.successText}
            {toast.state === 'error' && (toast.message || 'Error')}
          </span>
          {toast.state === 'error' && (
            <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
          )}
        </div>
      )}
    </div>
  )
}
