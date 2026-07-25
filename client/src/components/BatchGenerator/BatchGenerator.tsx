import { useEffect, useState } from 'react'
import { CheckSquare, Square, Layers, Upload, Send, Play, ClipboardCheck, Wand2, Shuffle, Trash2, Pencil, Music, X } from 'lucide-react'
import { phrasesApi, imagesApi, videosApi, imagesOutputApi, batchApi, BatchPair } from '../../api'
import { Phrase, ImageItem } from '../../types'
import { useVideoStore } from '../../store/videoStore'
import VideoResultModal from '../Preview/VideoResultModal'

type BatchMode = 'phrases' | 'images'
type PlanMode = 'auto' | 'manual'

interface BatchResult {
  id: string
  mode: 'video' | 'image'
  phraseText: string
  matchedWith: string
  filename: string
  publicUrl: string
  ok: boolean
  error?: string
  driveUrl?: string
  driveError?: string
  published?: boolean
  publishError?: string
  queued?: boolean
  queueError?: string
}

// Post-acciones reutilizables (durante generación y sobre resultados ya generados).
async function drivePatch(id: string, m: 'video' | 'image'): Promise<Partial<BatchResult>> {
  try {
    const driveApi = m === 'video' ? videosApi : imagesOutputApi
    const { driveUrl } = await driveApi.uploadToDrive(id)
    return { driveUrl, driveError: undefined }
  } catch (e: any) {
    return { driveError: e.response?.data?.error || e.message }
  }
}

async function publishPatch(id: string, env: 'test' | 'prod'): Promise<Partial<BatchResult>> {
  try {
    await videosApi.publish(id, env)
    return { published: true, publishError: undefined }
  } catch (e: any) {
    return { publishError: e.response?.data?.error || e.message }
  }
}

async function queuePatch(id: string): Promise<Partial<BatchResult>> {
  try {
    await videosApi.queue(id)
    return { queued: true, queueError: undefined }
  } catch (e: any) {
    return { queueError: e.response?.data?.error || e.message }
  }
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

  const [planMode, setPlanMode] = useState<PlanMode>('auto')
  const [batchMode, setBatchMode] = useState<BatchMode>('phrases')

  // Manual
  const [selectedPhraseIds, setSelectedPhraseIds] = useState<Set<string>>(new Set())
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set())

  // Auto
  const [autoCount, setAutoCount] = useState(5)
  const [allowRepeat, setAllowRepeat] = useState(false)
  const [plannedPairs, setPlannedPairs] = useState<BatchPair[]>([])
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [picker, setPicker] = useState<number | null>(null) // índice del par que edita la imagen a mano
  const [pickerImages, setPickerImages] = useState<ImageItem[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)

  const [uploadToDrive, setUploadToDrive] = useState(false)
  const [publishToN8n, setPublishToN8n] = useState(false)
  const [publishEnv, setPublishEnv] = useState<'test' | 'prod'>('prod')

  const [progress, setProgress] = useState<{ current: number; total: number; phase?: string } | null>(null)
  const [results, setResults] = useState<BatchResult[]>([])
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null)

  const loadData = () =>
    Promise.all([phrasesApi.list(), imagesApi.list()]).then(([ps, imgs]) => {
      setPhrases(ps.sort((a, b) => (a.usageCount ?? 0) - (b.usageCount ?? 0)))
      setImages(imgs.sort((a, b) => (a.usageCount ?? 0) - (b.usageCount ?? 0)))
      setLoadingData(false)
    })

  useEffect(() => { loadData() }, [])

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

  const imageByName = (filename: string) => images.find((im) => im.filename === filename || im.id === filename)

  // ── Modo AUTO: proponer, re-rodar, excluir, cambiar imagen a mano ──────────────
  const proposePlan = async () => {
    setPlanError(null)
    setPlanning(true)
    setResults([])
    try {
      const { pairs } = await batchApi.plan(batchMode, autoCount, allowRepeat)
      setPlannedPairs(pairs)
      if (pairs.length === 0) setPlanError('No hay contenido analizado suficiente para armar el lote.')
    } catch (e: any) {
      setPlanError(e?.response?.data?.error || e.message)
    } finally {
      setPlanning(false)
    }
  }

  const rerollPair = async (idx: number) => {
    const pair = plannedPairs[idx]
    if (!pair) return
    try {
      const { recommendations } = await imagesApi.recommend(pair.phraseId, pair.phraseText, images.length)
      const usedElsewhere = new Set(plannedPairs.filter((_, i) => i !== idx).map((p) => p.imageId))
      // Al azar entre las 10 mejores no usadas → variedad real (no ping-pong entre 2).
      const candidates = recommendations
        .filter((r) => r.imageId !== pair.imageId && !usedElsewhere.has(r.imageId))
        .slice(0, 10)
      const next = candidates.length
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : recommendations.find((r) => r.imageId !== pair.imageId)
      if (!next) return
      const img = imageByName(next.imageId)
      setPlannedPairs((prev) => prev.map((p, i) =>
        i === idx ? { ...p, imageId: next.imageId, imageUrl: img?.url ?? p.imageUrl, score: next.score } : p
      ))
    } catch { /* silencioso */ }
  }

  const excludePair = (idx: number) =>
    setPlannedPairs((prev) => prev.filter((_, i) => i !== idx))

  // Abre el picker mostrando las imágenes ORDENADAS por compatibilidad con la
  // frase del par (no las 307 en desorden). Cae al banco completo si falla.
  const openPicker = async (idx: number) => {
    setPicker(idx)
    setPickerLoading(true)
    setPickerImages([])
    const pair = plannedPairs[idx]
    try {
      const { recommendations } = await imagesApi.recommend(pair.phraseId, pair.phraseText, images.length)
      const ranked = recommendations
        .map((r) => imageByName(r.imageId))
        .filter((im): im is ImageItem => !!im)
      setPickerImages(ranked.length ? ranked : images)
    } catch {
      setPickerImages(images)
    } finally {
      setPickerLoading(false)
    }
  }

  const setPairImage = (idx: number, img: ImageItem) => {
    setPlannedPairs((prev) => prev.map((p, i) =>
      i === idx ? { ...p, imageId: img.filename, imageUrl: img.url, score: 0 } : p
    ))
    setPicker(null)
  }

  // ── Generación (compartida por manual y auto) ──────────────────────────────────
  const generateFromPairs = async (pairs: { phrase: Phrase; image: ImageItem; audioTrack?: string }[]) => {
    const newResults: BatchResult[] = []

    for (let i = 0; i < pairs.length; i++) {
      const { phrase, image, audioTrack } = pairs[i]
      setProgress({ current: i + 1, total: pairs.length, phase: 'Generando' })

      try {
        const itemConfig = {
          ...config,
          imageId: image.id,
          imagePath: image.path,
          imagePreviewUrl: image.url,
          text: { ...config.text, content: phrase.text },
          source: phrase.author ?? '',
          // Auto: la pista emparejada por mood; si no hay, respeta el ajuste global.
          audioTrack: audioTrack ?? config.audioTrack,
        }

        let generatedId = ''
        const result: BatchResult = {
          id: '', mode, phraseText: phrase.text,
          matchedWith: batchMode === 'phrases' ? image.filename : phrase.text,
          filename: '', publicUrl: '', ok: true,
        }

        if (mode === 'video') {
          const maxPx = (itemConfig.text.maxWidth / 100) * itemConfig.resolution.width
          const wrappedLines = computeLines(phrase.text, itemConfig.text.fontSize, itemConfig.text.font, maxPx)
          const video = await videosApi.generate({ ...itemConfig, wrappedLines }, phrase.id)
          generatedId = video.id
          result.id = video.id
          result.filename = video.filename
          result.publicUrl = video.publicUrl
        } else {
          const imgConfig = {
            imageId: image.id,
            imagePath: image.path,
            text: itemConfig.text,
            resolution: itemConfig.resolution,
            watermark: itemConfig.watermark,
            source: phrase.author ?? '',
          }
          const img = await imagesOutputApi.generate(imgConfig, phrase.id, 'combined')
          generatedId = img.id
          result.id = img.id
          result.filename = img.filename
          result.publicUrl = img.publicUrl
        }

        if (uploadToDrive) {
          setProgress((p) => p ? { ...p, phase: 'Subiendo a Drive' } : p)
          Object.assign(result, await drivePatch(generatedId, mode))
        }
        if (publishToN8n && mode === 'video') {
          setProgress((p) => p ? { ...p, phase: 'Publicando n8n' } : p)
          Object.assign(result, await publishPatch(generatedId, publishEnv))
        }
        newResults.push(result)
      } catch (e: any) {
        newResults.push({
          id: '', mode, phraseText: phrase.text,
          matchedWith: batchMode === 'phrases' ? image.filename : phrase.text,
          filename: '', publicUrl: '', ok: false, error: e.message,
        })
      }
    }

    setResults(newResults)
    setProgress(null)
  }

  // Manual: empareja por compatibilidad (greedy secuencial) y genera.
  const generateManual = async () => {
    setResults([])
    const pairs: { phrase: Phrase; image: ImageItem }[] = []

    if (batchMode === 'phrases') {
      const usedImageIds = new Set<string>()
      const imageUsage = new Map(images.map((img) => [img.id, img.usageCount ?? 0]))
      setProgress({ current: 0, total: selectedPhrases.length, phase: 'Buscando imágenes' })
      for (let i = 0; i < selectedPhrases.length; i++) {
        const phrase = selectedPhrases[i]
        let image = images[i % images.length]
        try {
          const { recommendations } = await imagesApi.recommend(phrase.id, phrase.text, images.length)
          const available = recommendations
            .filter((r) => !usedImageIds.has(r.imageId))
            .sort((a, b) => {
              const ua = imageUsage.get(a.imageId) ?? 0
              const ub = imageUsage.get(b.imageId) ?? 0
              if (ua !== ub) return ua - ub
              return b.score - a.score
            })
          if (available.length > 0) {
            const matched = images.find((img) => img.id === available[0].imageId)
            if (matched) image = matched
          }
        } catch {}
        usedImageIds.add(image.id)
        pairs.push({ phrase, image })
        setProgress({ current: i + 1, total: selectedPhrases.length, phase: 'Buscando imágenes' })
      }
    } else {
      const usedPhraseIds = new Set<string>()
      const phraseUsage = new Map(phrases.map((p) => [p.id, p.usageCount ?? 0]))
      setProgress({ current: 0, total: selectedImages.length, phase: 'Buscando frases' })
      for (let i = 0; i < selectedImages.length; i++) {
        const image = selectedImages[i]
        let phrase = phrases[i % phrases.length]
        try {
          const { recommendations } = await phrasesApi.recommendForImage(image.filename, phrases.length)
          const available = recommendations
            .filter((r) => !usedPhraseIds.has(r.phraseId))
            .sort((a, b) => {
              const ua = phraseUsage.get(a.phraseId) ?? 0
              const ub = phraseUsage.get(b.phraseId) ?? 0
              if (ua !== ub) return ua - ub
              return b.score - a.score
            })
          if (available.length > 0) {
            const matched = phrases.find((p) => p.id === available[0].phraseId)
            if (matched) phrase = matched
          }
        } catch {}
        usedPhraseIds.add(phrase.id)
        pairs.push({ phrase, image })
        setProgress({ current: i + 1, total: selectedImages.length, phase: 'Buscando frases' })
      }
    }

    await generateFromPairs(pairs)
  }

  // Auto: genera desde el preview (mapea ids a los objetos del estado).
  const generatePlan = async () => {
    const pairs = plannedPairs
      .map((pp) => {
        const phrase = phrases.find((p) => p.id === pp.phraseId)
        const image = imageByName(pp.imageId)
        return phrase && image
          ? { phrase, image, ...(pp.audioTrack ? { audioTrack: pp.audioTrack } : {}) }
          : null
      })
      .filter((x): x is { phrase: Phrase; image: ImageItem; audioTrack?: string } => x !== null)
    if (pairs.length === 0) return
    await generateFromPairs(pairs)
  }

  // Aplica una post-acción a los resultados ya generados (sin regenerar), solo a los pendientes.
  const runPostAction = async (
    phase: string,
    isPending: (r: BatchResult) => boolean,
    patch: (r: BatchResult) => Promise<Partial<BatchResult>>
  ) => {
    const targets = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.ok && r.id && isPending(r))
    if (targets.length === 0) return

    let done = 0
    setProgress({ current: 0, total: targets.length, phase })
    for (const { r, i } of targets) {
      const update = await patch(r)
      setResults((prev) => prev.map((x, xi) => (xi === i ? { ...x, ...update } : x)))
      done++
      setProgress({ current: done, total: targets.length, phase })
    }
    setProgress(null)
  }

  const uploadPendingToDrive = () =>
    runPostAction('Subiendo a Drive', (r) => !r.driveUrl, (r) => drivePatch(r.id, r.mode))

  const publishPending = () =>
    runPostAction('Publicando n8n', (r) => r.mode === 'video' && !r.published, (r) => publishPatch(r.id, publishEnv))

  const sendPendingToApproval = () =>
    runPostAction('Enviando a aprobación', (r) => r.mode === 'video' && !r.queued, (r) => queuePatch(r.id))

  const okCount = results.filter((r) => r.ok).length
  const errCount = results.filter((r) => !r.ok).length
  const pendingDrive = results.filter((r) => r.ok && r.id && !r.driveUrl).length
  const pendingPublish = results.filter((r) => r.ok && r.id && r.mode === 'video' && !r.published).length
  const pendingQueue = results.filter((r) => r.ok && r.id && r.mode === 'video' && !r.queued).length

  const canGenerateManual = batchMode === 'phrases' ? selectedPhrases.length > 0 : selectedImages.length > 0
  const manualTotal = batchMode === 'phrases' ? selectedPhrases.length : selectedImages.length

  if (loadingData) {
    return <p className="p-4 text-xs text-bone-700">Cargando...</p>
  }

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Modo de planificación */}
      <div className="flex gap-1 bg-carbon-700 rounded-lg p-1">
        {(['auto', 'manual'] as PlanMode[]).map((pm) => (
          <button
            key={pm}
            onClick={() => setPlanMode(pm)}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              planMode === pm ? 'bg-carbon-600 text-bone-500' : 'text-bone-700 hover:text-bone-500'
            }`}
          >
            {pm === 'auto' ? 'Automático' : 'Manual'}
          </button>
        ))}
      </div>

      {/* Driver (por frases / por imágenes) */}
      <div className="flex gap-1 bg-carbon-700 rounded-lg p-1">
        <button
          onClick={() => setBatchMode('phrases')}
          className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
            batchMode === 'phrases' ? 'bg-carbon-600 text-bone-500' : 'text-bone-700 hover:text-bone-500'
          }`}
        >
          Por frases
        </button>
        <button
          onClick={() => setBatchMode('images')}
          className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
            batchMode === 'images' ? 'bg-carbon-600 text-bone-500' : 'text-bone-700 hover:text-bone-500'
          }`}
        >
          Por imágenes
        </button>
      </div>

      {/* ── MODO AUTOMÁTICO ────────────────────────────────────────────────────── */}
      {planMode === 'auto' && (
        <>
          <p className="text-[10px] text-bone-700">
            Elige cuántas piezas y el sistema toma las {batchMode === 'phrases' ? 'frases' : 'imágenes'} menos
            usadas, empareja por compatibilidad (el score manda) y asigna audio por mood. Revisa el preview antes de generar.
          </p>

          <div className="flex items-center gap-2">
            <label className="text-[11px] text-bone-700">Cantidad</label>
            <input
              type="number" min={1} max={50} value={autoCount}
              onChange={(e) => setAutoCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
              className="w-16 bg-carbon-900 border border-carbon-600 rounded-lg px-2 py-1 text-xs text-bone-500 tabular-nums focus:border-gold-500 outline-none"
            />
            <button
              onClick={() => setAllowRepeat((v) => !v)}
              className={`text-[11px] px-2 py-1 rounded-lg transition-colors ${
                allowRepeat ? 'bg-gold-500/20 text-gold-500' : 'bg-carbon-700 text-bone-700 hover:bg-carbon-600'
              }`}
              title="Permite repetir imagen cuando no alcanzan las compatibles"
            >
              Permitir repetir imagen
            </button>
          </div>

          <button
            onClick={proposePlan}
            disabled={planning || isRunning}
            className="flex items-center justify-center gap-2 bg-carbon-700 hover:bg-carbon-600 disabled:opacity-40 text-bone-500 text-xs font-medium rounded-lg px-3 py-2 transition-colors"
          >
            <Wand2 size={14} />
            {planning ? 'Proponiendo…' : `Proponer lote de ${autoCount}`}
          </button>

          {planError && <p className="text-[11px] text-neon-red">{planError}</p>}

          {/* Preview editable de pares */}
          {plannedPairs.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-bone-700">
                Preview ({plannedPairs.length})
              </h3>
              <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                {plannedPairs.map((pp, idx) => (
                  <div key={`${pp.phraseId}-${idx}`} className="flex items-center gap-2 bg-carbon-700 rounded-lg p-1.5">
                    <img src={pp.imageUrl} alt="" className="w-9 h-14 object-cover rounded shrink-0 bg-carbon-900" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-bone-500 leading-snug line-clamp-2">{pp.phraseText}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-bone-700">
                        {pp.score > 0 && <span title="Compatibilidad">◈ {pp.score.toFixed(2)}</span>}
                        {pp.audioTrack ? (
                          <span className="flex items-center gap-0.5" title={pp.audioTrack}>
                            <Music size={9} /> {pp.audioMood ?? '—'}{typeof pp.audioEnergia === 'number' ? ` E${pp.audioEnergia}` : ''}
                          </span>
                        ) : (
                          <span className="flex items-center gap-0.5 text-bone-700/60"><Music size={9} /> sin audio</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => rerollPair(idx)} title="Re-rodar imagen" className="p-1 rounded text-bone-700 hover:text-gold-500"><Shuffle size={13} /></button>
                      <button onClick={() => openPicker(idx)} title="Cambiar imagen a mano" className="p-1 rounded text-bone-700 hover:text-gold-500"><Pencil size={13} /></button>
                      <button onClick={() => excludePair(idx)} title="Excluir del lote" className="p-1 rounded text-bone-700 hover:text-neon-red"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ── MODO MANUAL ────────────────────────────────────────────────────────── */}
      {planMode === 'manual' && batchMode === 'phrases' && (
        <>
          <p className="text-[10px] text-bone-700">
            Selecciona las frases — la mejor imagen se asigna automáticamente por compatibilidad semántica.
          </p>
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-bone-700">
                Frases ({selectedPhraseIds.size}/{phrases.length})
              </h3>
              <button onClick={toggleAllPhrases} className="text-xs text-bone-700 hover:text-bone-500 transition-colors">
                {selectedPhraseIds.size === phrases.length ? 'Quitar todas' : 'Todas'}
              </button>
            </div>
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
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
                    <div className="min-w-0 flex-1">
                      <span className="leading-relaxed line-clamp-2">{p.text}</span>
                      {p.author && <p className="text-[10px] text-gold-500/80 mt-0.5">– {p.author} –</p>}
                    </div>
                    {(p.usageCount ?? 0) > 0 && (
                      <span className="shrink-0 text-[10px] text-bone-700 bg-carbon-600 rounded px-1.5 py-0.5">×{p.usageCount}</span>
                    )}
                  </button>
                )
              })}
              {phrases.length === 0 && <p className="text-xs text-bone-700 py-2">No hay frases en el banco.</p>}
            </div>
          </section>
        </>
      )}

      {planMode === 'manual' && batchMode === 'images' && (
        <>
          <p className="text-[10px] text-bone-700">
            Selecciona las imágenes — la mejor frase se asigna automáticamente por compatibilidad semántica.
          </p>
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-bone-700">
                Imágenes ({selectedImageIds.size}/{images.length})
              </h3>
              <button onClick={toggleAllImages} className="text-xs text-bone-700 hover:text-bone-500 transition-colors">
                {selectedImageIds.size === images.length ? 'Quitar todas' : 'Todas'}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5 max-h-52 overflow-y-auto">
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
                    {(img.usageCount ?? 0) > 0 && (
                      <span className="absolute top-0.5 right-0.5 text-[9px] bg-carbon-900/80 text-bone-700 rounded px-1">×{img.usageCount}</span>
                    )}
                    {selected && (
                      <div className="absolute inset-0 bg-neon-red/20 flex items-center justify-center">
                        <CheckSquare size={16} className="text-neon-red" />
                      </div>
                    )}
                  </button>
                )
              })}
              {images.length === 0 && <p className="col-span-4 text-xs text-bone-700 py-2">No hay imágenes.</p>}
            </div>
          </section>
        </>
      )}

      {/* Opciones post-generación */}
      <section className="flex flex-col gap-2">
        <button
          onClick={() => setUploadToDrive((v) => !v)}
          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
            uploadToDrive ? 'bg-gold-500/20 text-gold-500' : 'bg-carbon-700 text-bone-700 hover:bg-carbon-600'
          }`}
        >
          <Upload size={13} />
          Subir a Google Drive
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPublishToN8n((v) => !v)}
            disabled={mode !== 'video'}
            className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
              publishToN8n && mode === 'video'
                ? 'bg-gold-500/20 text-gold-500'
                : 'bg-carbon-700 text-bone-700 hover:bg-carbon-600 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            <Send size={13} />
            Publicar vía n8n
          </button>
          {publishToN8n && mode === 'video' && (
            <select
              value={publishEnv}
              onChange={(e) => setPublishEnv(e.target.value as 'test' | 'prod')}
              className="bg-carbon-700 text-bone-700 text-xs rounded-lg px-2 py-1.5 border border-carbon-600"
            >
              <option value="test">Test</option>
              <option value="prod">Producción</option>
            </select>
          )}
        </div>
      </section>

      {/* Botón generar */}
      {planMode === 'auto' ? (
        <button
          onClick={generatePlan}
          disabled={isRunning || plannedPairs.length === 0}
          className="flex items-center justify-center gap-2 bg-gold-500 hover:bg-gold-600 disabled:bg-carbon-600 disabled:cursor-not-allowed text-bone-500 text-sm font-medium rounded-xl px-4 py-2.5 transition-colors"
        >
          <Layers size={15} />
          {isRunning
            ? `${progress!.phase || 'Generando'} ${progress!.current}/${progress!.total}...`
            : `Generar ${plannedPairs.length} ${mode === 'video' ? 'videos' : 'imágenes'}`}
        </button>
      ) : (
        <button
          onClick={generateManual}
          disabled={isRunning || !canGenerateManual}
          className="flex items-center justify-center gap-2 bg-gold-500 hover:bg-gold-600 disabled:bg-carbon-600 disabled:cursor-not-allowed text-bone-500 text-sm font-medium rounded-xl px-4 py-2.5 transition-colors"
        >
          <Layers size={15} />
          {isRunning
            ? `${progress!.phase || 'Generando'} ${progress!.current}/${progress!.total}...`
            : `Generar ${manualTotal} ${mode === 'video' ? 'videos' : 'imágenes'}`}
        </button>
      )}

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
            {errCount > 0 && <span className="text-neon-red"> · {errCount} error{errCount !== 1 ? 'es' : ''}</span>}
          </p>

          {okCount > 0 && (
            <div className="flex flex-col gap-2 mb-2">
              {mode === 'video' && (
                <button
                  onClick={sendPendingToApproval}
                  disabled={isRunning || pendingQueue === 0}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-gold-500 hover:bg-gold-600 text-bone-500 disabled:bg-carbon-600 disabled:text-bone-700 disabled:cursor-not-allowed transition-colors"
                >
                  <ClipboardCheck size={14} />
                  Enviar a aprobación{pendingQueue > 0 ? ` (${pendingQueue})` : ''}
                </button>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={uploadPendingToDrive}
                  disabled={isRunning || pendingDrive === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs bg-carbon-700 text-bone-700 hover:bg-carbon-600 hover:text-gold-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Upload size={12} />
                  Subir a Drive{pendingDrive > 0 ? ` (${pendingDrive})` : ''}
                </button>
                {mode === 'video' && (
                  <>
                    <button
                      onClick={publishPending}
                      disabled={isRunning || pendingPublish === 0}
                      title="Carril express: publica ya, saltándose la cola"
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs bg-carbon-700 text-bone-700 hover:bg-carbon-600 hover:text-gold-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Send size={12} />
                      Publicar ya{pendingPublish > 0 ? ` (${pendingPublish})` : ''}
                    </button>
                    <select
                      value={publishEnv}
                      onChange={(e) => setPublishEnv(e.target.value as 'test' | 'prod')}
                      disabled={isRunning}
                      className="bg-carbon-700 text-bone-700 text-xs rounded-lg px-1.5 py-1.5 border border-carbon-600 disabled:opacity-40"
                    >
                      <option value="test">Test</option>
                      <option value="prod">Prod</option>
                    </select>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`flex flex-col gap-1 px-2 py-1.5 rounded-lg text-xs ${r.ok ? 'bg-carbon-700' : 'bg-red-900/20'}`}>
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 ${r.ok ? 'text-gold-500' : 'text-neon-red'}`}>{r.ok ? '✓' : '✗'}</span>
                  {r.ok ? (
                    <div className="flex items-center gap-2 min-w-0">
                      {r.mode === 'video' ? (
                        <button
                          onClick={() => setPreview({ src: r.publicUrl, name: r.filename })}
                          className="flex items-center gap-1 text-gold-500 hover:underline truncate"
                        >
                          <Play size={11} className="shrink-0" /> {r.filename}
                        </button>
                      ) : (
                        <a href={r.publicUrl} target="_blank" rel="noreferrer" className="text-gold-500 hover:underline truncate">
                          {r.filename}
                        </a>
                      )}
                      {r.driveUrl && <span title="Subido a Drive" className="shrink-0 inline-flex"><Upload size={11} className="text-bone-700" /></span>}
                      {r.queued && <span title="Enviado a aprobación" className="shrink-0 inline-flex"><ClipboardCheck size={11} className="text-gold-500" /></span>}
                      {r.published && <span title="Publicado vía n8n (express)" className="shrink-0 inline-flex"><Send size={11} className="text-bone-700" /></span>}
                    </div>
                  ) : (
                    <span className="text-neon-red truncate">{r.error || 'Error desconocido'}</span>
                  )}
                </div>
                {(r.driveError || r.publishError || r.queueError) && (
                  <div className="pl-5 flex flex-col gap-0.5">
                    {r.driveError && <span className="text-neon-red/90 text-[10px]">⚠ Drive: {r.driveError}</span>}
                    {r.queueError && <span className="text-neon-red/90 text-[10px]">⚠ Aprobación: {r.queueError}</span>}
                    {r.publishError && <span className="text-neon-red/90 text-[10px]">⚠ n8n: {r.publishError}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mini-picker para cambiar la imagen de un par a mano */}
      {picker !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setPicker(null) }}
        >
          <div className="relative w-full max-w-lg bg-carbon-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-carbon-700 shrink-0">
              <h2 className="text-sm font-semibold text-bone-500">Elegir imagen</h2>
              <span className="text-[11px] text-bone-700">ordenadas por compatibilidad</span>
              <button onClick={() => setPicker(null)} className="ml-auto p-1.5 rounded-lg bg-carbon-700/80 text-bone-700 hover:text-bone-500"><X size={14} /></button>
            </div>
            {pickerLoading ? (
              <p className="p-4 text-xs text-bone-700">Buscando compatibles…</p>
            ) : (
              <div className="overflow-y-auto p-3 grid grid-cols-4 gap-1.5">
                {pickerImages.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => setPairImage(picker, img)}
                    style={{ aspectRatio: '9 / 16' }}
                    className="relative w-full overflow-hidden rounded border-2 border-transparent hover:border-gold-500 transition-all"
                  >
                    <img src={img.url} alt={img.filename} className="absolute inset-0 w-full h-full object-cover" />
                    {(img.usageCount ?? 0) > 0 && (
                      <span className="absolute top-0.5 right-0.5 text-[9px] bg-carbon-900/80 text-bone-700 rounded px-1">×{img.usageCount}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {preview && (
        <VideoResultModal src={preview.src} filename={preview.name} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}
