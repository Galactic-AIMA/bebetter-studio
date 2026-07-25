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
  analyzeAll: () =>
    api.post<{ processed: number; skipped: number; errors: string[] }>('/phrases/analyze-all').then((r) => r.data),
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

export const audioApi = {
  list: () => api.get<AudioTrack[]>('/audio').then((r) => r.data),
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
