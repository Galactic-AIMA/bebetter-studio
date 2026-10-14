import { useEffect, useState } from 'react'
import { CheckSquare, Square, Stack, UploadSimple, PaperPlaneTilt, Play, Queue, MagicWand, Shuffle, PencilSimple, X, Check, WarningCircle } from '@phosphor-icons/react'
import { splitByTiempos } from '@shared/splitByTiempos'
import { Segmentos, Interruptor, Progreso } from '../ui/mesa'
import { phrasesApi, imagesApi, videosApi, imagesOutputApi, batchApi, BatchPair } from '../../api'
import { Phrase, ImageItem } from '../../types'
import { useVideoStore } from '../../store/videoStore'
import { wrapText } from '../../lib/wrapText'
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

export default function BatchGenerator() {
  const { config, mode: rawMode } = useVideoStore()
  // El batch solo aplica a video/imagen (no se monta en modo carrusel).
  const mode: 'video' | 'image' = rawMode === 'video' ? 'video' : 'image'

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
          const wrappedLines = wrapText({
            text: phrase.text,
            font: itemConfig.text.font,
            fontSize: itemConfig.text.fontSize,
            maxWidth: itemConfig.text.maxWidth,
            resolutionWidth: itemConfig.resolution.width,
          })
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
    runPostAction('Enviando a la cola', (r) => r.mode === 'video' && !r.queued, (r) => queuePatch(r.id))

  const okCount = results.filter((r) => r.ok).length
  const errCount = results.filter((r) => !r.ok).length
  const pendingDrive = results.filter((r) => r.ok && r.id && !r.driveUrl).length
  const pendingPublish = results.filter((r) => r.ok && r.id && r.mode === 'video' && !r.published).length
  const pendingQueue = results.filter((r) => r.ok && r.id && r.mode === 'video' && !r.queued).length

  const canGenerateManual = batchMode === 'phrases' ? selectedPhrases.length > 0 : selectedImages.length > 0
  const manualTotal = batchMode === 'phrases' ? selectedPhrases.length : selectedImages.length

  if (loadingData) {
    return <p className="px-5 py-6 text-ui text-hueso-3">Cargando el banco…</p>
  }

  const total = planMode === 'auto' ? plannedPairs.length : manualTotal
  const puedeGenerar = planMode === 'auto' ? plannedPairs.length > 0 : canGenerateManual
  const pieza = mode === 'video' ? 'video' : 'imagen'
  const piezas = mode === 'video' ? 'videos' : 'imágenes'

  return (
    <div className="flex flex-col">

      {/* Cómo se arma el lote */}
      <div className="flex flex-col gap-3 border-b border-linea px-5 pb-4 pt-4 lg:pt-3">
        <Segmentos
          value={planMode}
          options={[{ value: 'auto', label: 'Automático' }, { value: 'manual', label: 'Manual' }]}
          onChange={setPlanMode}
        />
        <Segmentos
          label="Parte de"
          value={batchMode}
          options={[{ value: 'phrases', label: 'Frases' }, { value: 'images', label: 'Imágenes' }]}
          onChange={setBatchMode}
        />
        <p className="text-ui text-hueso-2">
          {planMode === 'auto'
            ? <>Toma las {batchMode === 'phrases' ? 'frases' : 'imágenes'} menos usadas, las empareja por afinidad y les pone audio por mood. Revisa la propuesta antes de generar.</>
            : batchMode === 'phrases'
              ? 'Elige las frases. A cada una se le asigna el fondo más afín.'
              : 'Elige los fondos. A cada uno se le asigna la frase más afín.'}
        </p>
      </div>

      {/* ── AUTOMÁTICO ─────────────────────────────────────────────────────────── */}
      {planMode === 'auto' && (
        <div className="flex flex-col gap-3 border-b border-linea px-5 py-4">
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-ui text-hueso-3">Piezas</span>
              <input
                type="number" min={1} max={50} value={autoCount}
                onChange={(e) => setAutoCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                className="campo w-20 font-mono text-ui tabular-nums"
              />
            </label>
            <button onClick={proposePlan} disabled={planning || isRunning} className="btn-sec flex-1">
              <MagicWand size={16} />
              {planning ? 'Proponiendo…' : `Proponer ${autoCount}`}
            </button>
          </div>
          <Interruptor
            label="Repetir fondo si faltan afines"
            checked={allowRepeat}
            onChange={setAllowRepeat}
          />
          {planError && (
            <p role="alert" className="flex items-start gap-1.5 text-ui text-lacre">
              <WarningCircle size={16} className="mt-0.5 shrink-0" /> {planError}
            </p>
          )}
        </div>
      )}

      {planMode === 'auto' && plannedPairs.length > 0 && (
        <section aria-label="Propuesta del lote" className="border-b border-linea">
          <p className="rotulo px-5 pb-1 pt-4">Propuesta · <span className="font-mono">{plannedPairs.length}</span></p>
          <ul>
            {plannedPairs.map((pp, idx) => {
              const [a, b] = splitByTiempos(pp.phraseText)
              return (
                <li key={`${pp.phraseId}-${idx}`} className="group flex items-start gap-3 border-b border-linea px-5 py-3 last:border-0">
                  <img src={pp.imageUrl} alt="" className="h-16 w-9 shrink-0 rounded-control border border-linea-2 bg-sala object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-3 text-ui text-hueso">
                      {a}
                      {b && <><span aria-hidden="true" className="mx-1 font-mono text-meta text-lacre">//</span><span className="text-hueso-2">{b}</span></>}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-meta text-hueso-3">
                      {pp.score > 0 && <span title="Afinidad entre frase y fondo">afinidad {pp.score.toFixed(2)}</span>}
                      <span title={pp.audioTrack} className="truncate">
                        {pp.audioTrack
                          ? `${pp.audioTextura ?? pp.audioMood ?? pp.audioTrack.replace(/\.[^.]+$/, '').slice(0, 24)}${typeof pp.audioEnergia === 'number' ? ` · e${pp.audioEnergia}` : ''}`
                          : 'sin audio'}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 opacity-60 transition-opacity duration-rapido ease-mesa focus-within:opacity-100 group-hover:opacity-100">
                    <button onClick={() => rerollPair(idx)} aria-label="Otro fondo afín" title="Otro fondo afín" className="btn-fantasma p-1.5"><Shuffle size={16} /></button>
                    <button onClick={() => openPicker(idx)} aria-label="Elegir fondo a mano" title="Elegir fondo a mano" className="btn-fantasma p-1.5"><PencilSimple size={16} /></button>
                    <button onClick={() => excludePair(idx)} aria-label="Quitar del lote" title="Quitar del lote" className="btn-fantasma p-1.5 hover:text-lacre"><X size={16} /></button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* ── MANUAL ─────────────────────────────────────────────────────────────── */}
      {planMode === 'manual' && batchMode === 'phrases' && (
        <section aria-label="Frases del lote" className="border-b border-linea">
          <div className="flex items-center justify-between px-5 pb-1 pt-4">
            <p className="rotulo">Frases · <span className="font-mono">{selectedPhraseIds.size}/{phrases.length}</span></p>
            <button onClick={toggleAllPhrases} className="btn-fantasma">
              {selectedPhraseIds.size === phrases.length ? 'Ninguna' : 'Todas'}
            </button>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {phrases.map((p) => {
              const selected = selectedPhraseIds.has(p.id)
              const usos = p.usageCount ?? 0
              return (
                <li key={p.id} className="border-b border-linea last:border-0">
                  <button
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => togglePhrase(p.id)}
                    className={`flex w-full items-start gap-2.5 px-5 py-2.5 text-left transition-colors duration-rapido ease-mesa hover:bg-s2 ${selected ? 'bg-s2' : ''}`}
                  >
                    {selected
                      ? <CheckSquare size={16} weight="fill" className="mt-0.5 shrink-0 text-oro" />
                      : <Square size={16} className="mt-0.5 shrink-0 text-hueso-3" />}
                    <span className="min-w-0 flex-1">
                      <span className={`line-clamp-2 text-ui ${selected ? 'text-hueso' : 'text-hueso-2'}`}>{p.text}</span>
                      <span className="mt-0.5 block font-mono text-meta text-hueso-3">
                        {usos === 0 ? 'sin usar' : `${usos} uso${usos !== 1 ? 's' : ''}`}{p.author ? ` · ${p.author}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
            {phrases.length === 0 && <li className="px-5 py-4 text-ui text-hueso-3">No hay frases en el banco.</li>}
          </ul>
        </section>
      )}

      {planMode === 'manual' && batchMode === 'images' && (
        <section aria-label="Fondos del lote" className="border-b border-linea">
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <p className="rotulo">Fondos · <span className="font-mono">{selectedImageIds.size}/{images.length}</span></p>
            <button onClick={toggleAllImages} className="btn-fantasma">
              {selectedImageIds.size === images.length ? 'Ninguno' : 'Todos'}
            </button>
          </div>
          <div className="grid max-h-80 grid-cols-4 gap-1.5 overflow-y-auto px-5 pb-4">
            {images.map((img) => {
              const selected = selectedImageIds.has(img.id)
              return (
                <button
                  key={img.id}
                  role="checkbox"
                  aria-checked={selected}
                  aria-label={img.filename}
                  onClick={() => toggleImage(img.id)}
                  className={`relative aspect-[9/16] overflow-hidden rounded-control border transition-colors duration-rapido ease-mesa ${
                    selected ? 'border-oro ring-1 ring-oro' : 'border-linea-2 hover:border-borde-control'
                  }`}
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  {(img.usageCount ?? 0) > 0 && (
                    <span className="absolute right-0.5 top-0.5 rounded-[4px] bg-velo px-1 font-mono text-meta text-hueso-2">×{img.usageCount}</span>
                  )}
                  {selected && (
                    <CheckSquare size={18} weight="fill" className="absolute bottom-1 left-1 text-oro" />
                  )}
                </button>
              )
            })}
            {images.length === 0 && <p className="col-span-4 py-2 text-ui text-hueso-3">No hay fondos en el banco.</p>}
          </div>
        </section>
      )}

      {/* Al terminar cada pieza */}
      <div className="flex flex-col gap-1 border-b border-linea px-5 py-3">
        <p className="rotulo pb-1">Al terminar cada pieza</p>
        <Interruptor label="Subir a Google Drive" checked={uploadToDrive} onChange={setUploadToDrive} />
        <Interruptor
          label="Publicar ya vía n8n"
          checked={publishToN8n && mode === 'video'}
          onChange={setPublishToN8n}
          disabled={mode !== 'video'}
          title="Carril express: publica sin pasar por la cola"
        >
          {publishToN8n && mode === 'video' && (
            <select
              value={publishEnv}
              onChange={(e) => setPublishEnv(e.target.value as 'test' | 'prod')}
              aria-label="Entorno de publicación"
              className="campo w-auto py-1 text-ui"
            >
              <option value="test">Test</option>
              <option value="prod">Producción</option>
            </select>
          )}
        </Interruptor>
      </div>

      {/* Generar el lote. Secundario a propósito: el único relleno de la pantalla
          es «Generar reel» del escenario (DESIGN.md §6). */}
      <div className="flex flex-col gap-2 border-b border-linea px-5 py-4">
        <button
          onClick={planMode === 'auto' ? generatePlan : generateManual}
          disabled={isRunning || !puedeGenerar}
          className="btn-sec h-10 w-full text-body"
        >
          <Stack size={18} />
          {isRunning
            ? <>{progress!.phase || 'Generando'} <span className="font-mono">{progress!.current}/{progress!.total}</span></>
            : total > 0 ? `Generar ${total} ${total === 1 ? pieza : piezas}` : `Generar ${piezas}`}
        </button>
        {isRunning && <Progreso actual={progress!.current} total={progress!.total} label="Progreso del lote" />}
      </div>

      {/* Resultados */}
      {results.length > 0 && (
        <section aria-label="Resultado del lote" className="flex flex-col gap-3 px-5 py-4">
          <p className="text-ui text-hueso-2">
            <span className="font-mono">{okCount}</span> generada{okCount !== 1 ? 's' : ''}
            {errCount > 0 && <span className="text-lacre"> · <span className="font-mono">{errCount}</span> con error</span>}
          </p>

          {okCount > 0 && (
            <div className="flex flex-wrap gap-2">
              {mode === 'video' && (
                <button onClick={sendPendingToApproval} disabled={isRunning || pendingQueue === 0} className="btn-sec">
                  <Queue size={16} /> Enviar a la cola{pendingQueue > 0 && <span className="font-mono text-meta text-hueso-3">{pendingQueue}</span>}
                </button>
              )}
              <button onClick={uploadPendingToDrive} disabled={isRunning || pendingDrive === 0} className="btn-sec">
                <UploadSimple size={16} /> Drive{pendingDrive > 0 && <span className="font-mono text-meta text-hueso-3">{pendingDrive}</span>}
              </button>
              {mode === 'video' && (
                <div className="flex gap-1">
                  <button
                    onClick={publishPending}
                    disabled={isRunning || pendingPublish === 0}
                    title="Carril express: publica ya, saltándose la cola"
                    className="btn-sec"
                  >
                    <PaperPlaneTilt size={16} /> Publicar ya{pendingPublish > 0 && <span className="font-mono text-meta text-hueso-3">{pendingPublish}</span>}
                  </button>
                  <select
                    value={publishEnv}
                    onChange={(e) => setPublishEnv(e.target.value as 'test' | 'prod')}
                    disabled={isRunning}
                    aria-label="Entorno de publicación"
                    className="campo w-auto py-1 text-ui"
                  >
                    <option value="test">Test</option>
                    <option value="prod">Prod</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <ul className="max-h-64 overflow-y-auto">
            {results.map((r, i) => (
              <li key={i} className="flex flex-col gap-0.5 border-b border-linea py-2 last:border-0">
                <div className="flex items-center gap-2 text-ui">
                  {r.ok
                    ? <Check size={16} className="shrink-0 text-hueso-2" aria-label="Generada" />
                    : <WarningCircle size={16} className="shrink-0 text-lacre" aria-label="Error" />}
                  {r.ok ? (
                    <>
                      {r.mode === 'video' ? (
                        <button
                          onClick={() => setPreview({ src: r.publicUrl, name: r.filename })}
                          className="flex min-w-0 items-center gap-1 text-hueso transition-colors duration-rapido ease-mesa hover:text-oro"
                        >
                          <Play size={14} className="shrink-0" /> <span className="truncate font-mono text-meta">{r.filename}</span>
                        </button>
                      ) : (
                        <a href={r.publicUrl} target="_blank" rel="noreferrer" className="truncate font-mono text-meta text-hueso hover:text-oro">
                          {r.filename}
                        </a>
                      )}
                      <span className="ml-auto flex shrink-0 gap-1.5 text-hueso-3">
                        {r.driveUrl && <UploadSimple size={14} aria-label="En Drive" />}
                        {r.queued && <Queue size={14} className="text-oro" aria-label="En la cola" />}
                        {r.published && <PaperPlaneTilt size={14} aria-label="Publicada" />}
                      </span>
                    </>
                  ) : (
                    <span className="truncate text-lacre">{r.error || 'Falló sin decir por qué'}</span>
                  )}
                </div>
                {(r.driveError || r.publishError || r.queueError) && (
                  <div className="flex flex-col pl-6 text-meta text-lacre">
                    {r.driveError && <span>Drive: {r.driveError}</span>}
                    {r.queueError && <span>Cola: {r.queueError}</span>}
                    {r.publishError && <span>n8n: {r.publishError}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Elegir el fondo de un par a mano */}
      {picker !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-velo p-2 sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setPicker(null) }}
          onKeyDown={(e) => { if (e.key === 'Escape') setPicker(null) }}
        >
          <div role="dialog" aria-modal="true" aria-label="Elegir fondo" className="relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-panel border border-linea-2 bg-s1">
            <div className="flex shrink-0 items-center gap-2.5 border-b border-linea px-4 py-3">
              <h2 className="text-body font-medium text-hueso">Elegir fondo</h2>
              <span className="font-mono text-meta text-hueso-3">por afinidad</span>
              <button autoFocus onClick={() => setPicker(null)} aria-label="Cerrar" className="btn-fantasma ml-auto p-1.5"><X size={16} /></button>
            </div>
            {pickerLoading ? (
              <p className="p-4 text-ui text-hueso-3">Buscando los más afines…</p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5 overflow-y-auto p-3">
                {pickerImages.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => setPairImage(picker, img)}
                    aria-label={img.filename}
                    className="relative aspect-[9/16] w-full overflow-hidden rounded-control border border-linea-2 transition-colors duration-rapido ease-mesa hover:border-oro"
                  >
                    <img src={img.url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
                    {(img.usageCount ?? 0) > 0 && (
                      <span className="absolute right-0.5 top-0.5 rounded-[4px] bg-velo px-1 font-mono text-meta text-hueso-2">×{img.usageCount}</span>
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
