import { useState } from 'react'
import { useVideoStore } from '../store/videoStore'
import { videosApi, imagesOutputApi } from '../api'
import { VideoRecord, ImageRecord, ImageVariant } from '../types'
import Header from '../components/Layout/Header'
import LeftPanel from '../components/Layout/LeftPanel'
import RightPanel from '../components/Layout/RightPanel'
import VideoPreview from '../components/Preview/VideoPreview'

type ToastState = { state: 'loading' | 'success' | 'error'; loadingText?: string; successText?: string; message?: string }

export default function Editor() {
  const { config, selectedPhraseId, isGenerating, setGenerating, mode } = useVideoStore()
  const [lastVideo, setLastVideo] = useState<VideoRecord | null>(null)
  const [lastImage, setLastImage] = useState<ImageRecord | null>(null)
  const [imageVariant, setImageVariant] = useState<ImageVariant>('combined')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const hasDelimiter = config.text.content.includes('//')

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
      if (ctx.measureText(test).width > maxPx && current) { lines.push(current); current = word }
      else current = test
    }
    if (current) lines.push(current)
    return lines
  }

  const generate = async () => {
    if (!config.imageId) { setError('Selecciona una imagen primero'); return }
    setError(null)
    setGenerating(true)
    try {
      if (mode === 'video') {
        const video = await videosApi.generate({ ...config, wrappedLines: computeWrappedLines() }, selectedPhraseId ?? undefined)
        setLastVideo(video)
        setLastImage(null)
      } else {
        const imgConfig = { imageId: config.imageId, imagePath: config.imagePath, text: config.text, resolution: config.resolution, watermark: config.watermark, source: config.source || undefined }
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

  return (
    <div className="flex flex-col h-screen bg-carbon-900 text-bone-500 overflow-hidden">
      <Header
        lastVideoId={lastVideo?.id ?? null}
        lastImageId={lastImage?.id ?? null}
        isGenerating={isGenerating}
        toast={toast}
        onUploadDrive={uploadToDrive}
        onPublish={publish}
      />

      <div className="flex flex-1 overflow-hidden bg-carbon-700">
        <LeftPanel />

        {/* Center */}
        <main className="flex-1 flex flex-col items-center justify-center bg-carbon-900 p-6 gap-3 overflow-hidden rounded-md m-0">
          {/* Variant selector */}
          {mode === 'image' && hasDelimiter && (
            <div className="flex rounded-lg overflow-hidden border border-carbon-600 text-xs">
              {(['combined', 'hook', 'punchline'] as ImageVariant[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setImageVariant(v)}
                  className={`px-3 py-1.5 transition-colors ${
                    imageVariant === v
                      ? 'bg-carbon-700 text-bone-500 border-x border-neon-red first:border-l-0 last:border-r-0'
                      : 'bg-carbon-800 text-bone-700 hover:text-bone-500'
                  }`}
                >
                  {v === 'combined' ? 'Combinada' : v === 'hook' ? 'Solo hook' : 'Solo remate'}
                </button>
              ))}
            </div>
          )}

          {/* Preview */}
          <div
            className="h-full max-h-[calc(100vh-120px)]"
            style={{ aspectRatio: `${config.resolution.width}/${config.resolution.height}` }}
          >
            <VideoPreview config={config} />
          </div>

          {/* Error */}
          {error && <p className="text-neon-red text-xs">{error}</p>}

          {/* Result link */}
          {(lastVideo || lastImage) && (
            <p className="text-xs text-bone-700">
              {lastVideo ? 'Video' : 'Imagen'} →{' '}
              <a
                href={(lastVideo ?? lastImage)!.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="text-gold-500 hover:underline"
              >
                {(lastVideo ?? lastImage)!.filename}
              </a>
            </p>
          )}
        </main>

        <RightPanel isGenerating={isGenerating} onGenerate={generate} />
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-xs font-medium border ${
          toast.state === 'loading' ? 'bg-carbon-700 border-carbon-600 text-bone-500' :
          toast.state === 'success' ? 'bg-carbon-700 border-gold-500/40 text-gold-500' :
          'bg-carbon-700 border-neon-red/40 text-neon-red'
        }`}>
          {toast.state === 'loading' && (
            <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {toast.state === 'success' && <span className="shrink-0">✓</span>}
          {toast.state === 'error'   && <span className="shrink-0">✗</span>}
          <span>
            {toast.state === 'loading' && toast.loadingText}
            {toast.state === 'success' && toast.successText}
            {toast.state === 'error'   && (toast.message || 'Error')}
          </span>
          {toast.state === 'error' && (
            <button onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100">✕</button>
          )}
        </div>
      )}
    </div>
  )
}
