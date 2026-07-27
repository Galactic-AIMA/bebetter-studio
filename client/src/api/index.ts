import axios from 'axios'
import { Phrase, ImageItem, VideoRecord, VideoConfig, ImageRecord, ImageVariant, WatermarkConfig, HistoryItem, ImageRecommendation } from '../types'

const api = axios.create({ baseURL: '/api' })

export const imagesApi = {
  list: () => api.get<ImageItem[]>('/images').then((r) => r.data),
  random: () => api.get<ImageItem>('/images/random').then((r) => r.data),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return api.post<ImageItem>('/upload/image', fd).then((r) => r.data)
  },
  analyzeAll: () =>
    api.post<{ processed: number; skipped: number; errors: string[] }>('/images/analyze-all').then((r) => r.data),
  analyzeProgress: () =>
    api
      .get<{ running: boolean; done: number; total: number; ok: number; skipped: number; remaining: number }>(
        '/images/analyze-progress'
      )
      .then((r) => r.data),
  recommend: (phraseId: string, phrase?: string, topN?: number) =>
    api.post<{ descripcionMood: string; recommendations: ImageRecommendation[] }>('/images/recommend', { phraseId, phrase, topN }).then((r) => r.data),
}

export const aiImagesApi = {
  // Propone un prompt de marca editable a partir de la frase activa.
  // textY (0–100) = posición vertical del texto en el editor, para reservar su franja.
  proposePrompt: (phraseId?: string, phrase?: string, textY?: number) =>
    api.post<{ prompt: string; analysis: unknown }>('/ai-images/prompt', { phraseId, phrase, textY }).then((r) => r.data),
  // Genera la imagen con KIE, la guarda en el banco y la devuelve (tarda ~40-100s)
  generate: (prompt: string, aspectRatio?: string) =>
    api.post<{ image: ImageItem }>('/ai-images/generate', { prompt, aspectRatio }).then((r) => r.data.image),
}

export type SlideRole = 'portada' | 'desarrollo' | 'historia' | 'cta'

// Atribución + marca de serie (se rinde solo en portada y CTA)
export interface CarouselFuente {
  autor?: string // "Robert Greene"
  obra?: string // "Las 48 Leyes del Poder"
  referencia?: string // "LEY 15" — badge de serie en la portada
}
export interface CarouselSlide {
  n: number
  rol: SlideRole
  texto: string
  simbolo?: string // escena visual concreta de la slide (varía entre slides)
  publicUrl?: string // presente cuando la slide ya se generó
}
export interface Carousel {
  id: string
  tema: string
  tipo: 'narrativo' | 'serie'
  aspect: string
  fuente?: CarouselFuente
  slides: CarouselSlide[]
  status: 'draft' | 'partial' | 'done' | 'queued' | 'published'
  createdAt: string
}

// Carrusel en cola + cuándo saldría según la cadencia semanal
export interface CarouselUpcomingItem {
  id: string
  carouselId: string
  tema: string
  referencia?: string
  firstImage?: string
  createdAt: string
  etaIso?: string
}
export interface CarouselUpcoming {
  days: number[] // ISO 1=lunes … 7=domingo
  times: string[]
  timezone: string
  count: number
  items: CarouselUpcomingItem[]
}

export const carouselsApi = {
  // Propone el guion editable (no gasta créditos de KIE)
  script: (
    tema: string,
    tipo: 'narrativo' | 'serie' = 'narrativo',
    nSlides = 6,
    fuente?: CarouselFuente,
    conHistoria = true
  ) =>
    api
      .post<{ slides: CarouselSlide[] }>('/carousels/script', { tema, tipo, nSlides, fuente, conHistoria })
      .then((r) => r.data.slides),
  // Crea el registro (draft) con el guion aprobado/editado
  create: (
    tema: string,
    tipo: 'narrativo' | 'serie',
    aspect: string,
    slides: CarouselSlide[],
    fuente?: CarouselFuente
  ) => api.post<Carousel>('/carousels', { tema, tipo, aspect, slides, fuente }).then((r) => r.data),
  // Genera (o regenera) la slide n con KIE — tarda ~40-100s
  generateSlide: (id: string, n: number) =>
    api.post<{ n: number; url: string }>(`/carousels/${id}/slides/${n}`).then((r) => r.data),
  // Sube las slides a R2, genera el caption y encola el carrusel; el scheduler de
  // n8n lo publica en Instagram en la próxima franja de la cadencia de carruseles.
  queue: (id: string) =>
    api
      .post<{ success: boolean; queueId: string; imageUrls: string[]; caption: string }>(`/carousels/${id}/queue`)
      .then((r) => r.data),
  // Carril express: publica en Instagram AHORA (no espera a la cadencia)
  publish: (id: string) =>
    api
      .post<{ success: boolean; mediaId: string; caption: string }>(`/carousels/${id}/publish`)
      .then((r) => r.data),
  // Proyección de la cola: qué carruseles salen y cuándo
  upcoming: () => api.get<CarouselUpcoming>('/carousels/queue/upcoming').then((r) => r.data),
  // Cadencia semanal de carruseles (días ISO 1=lunes…7=domingo + horas en punto).
  // Para LEERLA se usa upcoming(), que ya devuelve days/times/timezone.
  saveCadence: (days: number[], times: string[]) =>
    api
      .post<{ success: boolean; days: number[]; times: string[] }>('/carousels/cadence', { days, times })
      .then((r) => r.data),
  list: () => api.get<Carousel[]>('/carousels').then((r) => r.data),
  get: (id: string) => api.get<Carousel>(`/carousels/${id}`).then((r) => r.data),
  remove: (id: string) => api.delete(`/carousels/${id}`),
}

export const phrasesApi = {
  list: () => api.get<Phrase[]>('/phrases').then((r) => r.data),
  random: () => api.get<Phrase>('/phrases/random').then((r) => r.data),
  create: (data: Omit<Phrase, 'id'>) =>
    api.post<Phrase>('/phrases', data).then((r) => r.data),
  bulkCreate: (phrases: { text: string; author?: string }[]) =>
    api.post<Phrase[]>('/phrases/bulk', { phrases }).then((r) => r.data),
  update: (id: string, data: Partial<Phrase>) =>
    api.put<Phrase>(`/phrases/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/phrases/${id}`),
  embedAll: () =>
    api.post<{ processed: number; total: number; errors: string[] }>('/phrases/embed-all').then((r) => r.data),
  recommendForImage: (imageFilename: string, topN?: number) =>
    api.post<{ recommendations: { phraseId: string; score: number }[] }>('/phrases/recommend', { imageFilename, topN }).then((r) => r.data),
  reorder: (ids: string[]) => api.put('/phrases/reorder', { ids }).then((r) => r.data),
}

export interface PinterestSyncResult {
  newImages: number
  totalChecked: number
  status: 'success' | 'error'
  error?: string
}

export interface PinterestStatus {
  galleryDlConfigured: boolean
  pinterestApiConfigured: boolean
  lastSync: {
    timestamp: string
    newImages: number
    totalChecked: number
    status: 'success' | 'error'
    error?: string
  } | null
}

export const pinterestApi = {
  status: () => api.get<PinterestStatus>('/pinterest/status').then((r) => r.data),
  sync: () => api.post<PinterestSyncResult>('/pinterest/sync').then((r) => r.data),
  syncApi: () => api.post<PinterestSyncResult>('/pinterest/sync/api').then((r) => r.data),
  boards: () => api.get('/pinterest/boards').then((r) => r.data),
}

export interface ImageGenerateConfig {
  imageId: string
  imagePath: string
  text: {
    content: string
    font: string
    fontSize: number
    color: string
    position: { x: number; y: number }
    align: 'left' | 'center' | 'right'
    shadow: boolean
    maxWidth: number
    lineHeight: number
  }
  resolution: { width: number; height: number }
  watermark?: WatermarkConfig
  source?: string
}

export const imagesOutputApi = {
  list: () => api.get<ImageRecord[]>('/images-output').then((r) => r.data),
  generate: (config: ImageGenerateConfig, phraseId?: string, variant?: ImageVariant) =>
    api
      .post<{ image: ImageRecord }>('/images-output/generate', { config, phraseId, variant })
      .then((r) => r.data.image),
  uploadToDrive: (id: string) =>
    api.post<{ driveUrl: string }>(`/images-output/${id}/upload-drive`).then((r) => r.data),
  remove: (id: string) => api.delete(`/images-output/${id}`),
}

export interface AudioTrack {
  filename: string
  name: string
  energia?: number | null
  moodCategory?: string | null
  descripcion?: string | null
  analyzed?: boolean
}

export interface AudioProposal {
  filename: string
  energia: number
  moodCategory: string
  descripcion: string
}

export interface AutoPick {
  filename: string
  name: string
  moodCategory: string | null
  energia: number
  score: number
}

export const audioApi = {
  list: () => api.get<AudioTrack[]>('/audio').then((r) => r.data),
  // Pista que elegiría el auto-pick para una frase (preview antes de generar)
  pick: (phraseId: string) =>
    api.get<{ pick: AutoPick | null }>('/audio/pick', { params: { phraseId } }).then((r) => r.data.pick),
  analyze: (filenames?: string[]) =>
    api
      .post<{ proposals: AudioProposal[]; errors: string[] }>('/audio/analyze', { filenames })
      .then((r) => r.data),
  saveTags: (filename: string, energia: number, moodCategory: string, descripcion: string) =>
    api
      .put(`/audio/${encodeURIComponent(filename)}/tags`, { energia, moodCategory, descripcion })
      .then((r) => r.data),
}

export const historyApi = {
  list: () => api.get<HistoryItem[]>('/history').then((r) => r.data),
  setViral: (kind: 'video' | 'image', id: string, viral: boolean) =>
    api.patch<{ viral: boolean }>(`/history/${kind}s/${id}/viral`, { viral }).then((r) => r.data),
}

export const videosApi = {
  list: () => api.get<VideoRecord[]>('/videos').then((r) => r.data),
  generate: (config: VideoConfig, phraseId?: string) =>
    api
      .post<{ video: VideoRecord }>('/videos/generate', { config, phraseId })
      .then((r) => r.data.video),
  uploadToDrive: (id: string) =>
    api.post<{ driveUrl: string }>(`/videos/${id}/upload-drive`).then((r) => r.data),
  publish: (id: string, env: 'test' | 'prod') =>
    api.post(`/videos/${id}/publish`, { env }).then((r) => r.data),
  queue: (id: string) =>
    api.post<{ success: boolean; queueId: string }>(`/videos/${id}/queue`).then((r) => r.data),
  remove: (id: string) => api.delete(`/videos/${id}`),
}

export interface CadenceConfig {
  times: string[]
  timezone: string
}

export interface UpcomingItem {
  id: string
  phrase: string
  thumbnailUrl?: string
  createdAt: string
  etaIso?: string
  dayOffset?: number
  time?: string
}

export interface ScheduleResult {
  times: string[]
  timezone: string
  count: number
  items: UpcomingItem[]
}

export const cadenceApi = {
  get: () => api.get<CadenceConfig>('/cadence').then((r) => r.data),
  save: (times: string[]) =>
    api.post<{ success: boolean; times: string[] }>('/cadence', { times }).then((r) => r.data),
  schedule: () => api.get<ScheduleResult>('/cadence/schedule').then((r) => r.data),
}

export interface BatchPair {
  phraseId: string
  phraseText: string
  author?: string
  imageId: string
  imageUrl: string
  score: number
  audioTrack?: string
  audioMood?: string
  audioEnergia?: number
}

export const batchApi = {
  plan: (driver: 'phrases' | 'images', count: number, allowRepeat = false) =>
    api
      .post<{ pairs: BatchPair[]; requested: number; produced: number }>('/batch/plan', {
        driver,
        count,
        allowRepeat,
      })
      .then((r) => r.data),
}

export type LogLevel = 'info' | 'error'
export type LogCategory = 'generate' | 'drive' | 'publish' | 's3' | 'system'
export interface LogEntry {
  id: number
  ts: string
  level: LogLevel
  category: LogCategory
  message: string
  detail?: string
}

export const logsApi = {
  list: (params?: { limit?: number; level?: LogLevel; category?: LogCategory }) =>
    api.get<LogEntry[]>('/logs', { params }).then((r) => r.data),
  clear: () => api.delete('/logs').then((r) => r.data),
}

// --- Analítica -------------------------------------------------------------

export interface PieceStats {
  mediaId: string
  permalink?: string
  publishedAt: string
  mediaType?: string
  recipeStatus: 'full' | 'partial' | 'none'
  recipeBlocks: number
  hasPhrase: boolean
  hasImage: boolean
  hasAudio: boolean
  hasRender: boolean
  imagenArchivo?: string
  texto?: string
  moodCategory?: string
  nivelEnergia?: number
  imagenOrigen?: string
  estilo?: string
  efecto?: string
  audio?: string
  reach?: number
  likes?: number
  comments?: number
  saved?: number
  shares?: number
  views?: number
  follows?: number
  avgWatchTime?: number
  skipRate?: number
  viewsPerReach?: number
  saveRate?: number
  shareRate?: number
  engagementRate?: number
}

export interface DimensionSummary {
  dimension: string
  valor: string
  n: number
  reachMedio: number
  saveRate: number
  shareRate: number
  engagementRate: number
}

export const analyticsApi = {
  pieces: () => api.get<PieceStats[]>('/analytics/pieces').then((r) => r.data),
  summary: () =>
    api
      .get<{ minN: number; dimensions: DimensionSummary[] }>('/analytics/summary')
      .then((r) => r.data),
  collect: () =>
    api
      .post<{ total: number; ok: number; fallidas: { mediaId: string; error: string }[] }>(
        '/analytics/collect'
      )
      .then((r) => r.data),
}
