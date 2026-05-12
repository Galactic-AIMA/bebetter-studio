import axios from 'axios'
import { Phrase, ImageItem, VideoRecord, VideoConfig, ImageRecord, ImageVariant, WatermarkConfig, HistoryItem } from '../types'

const api = axios.create({ baseURL: '/api' })

export const imagesApi = {
  list: () => api.get<ImageItem[]>('/images').then((r) => r.data),
  random: () => api.get<ImageItem>('/images/random').then((r) => r.data),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return api.post<ImageItem>('/upload/image', fd).then((r) => r.data)
  },
}

export const phrasesApi = {
  list: () => api.get<Phrase[]>('/phrases').then((r) => r.data),
  random: () => api.get<Phrase>('/phrases/random').then((r) => r.data),
  create: (data: Omit<Phrase, 'id'>) =>
    api.post<Phrase>('/phrases', data).then((r) => r.data),
  bulkCreate: (texts: string[]) =>
    api.post<Phrase[]>('/phrases/bulk', { texts }).then((r) => r.data),
  update: (id: string, data: Partial<Phrase>) =>
    api.put<Phrase>(`/phrases/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/phrases/${id}`),
}

export interface PinterestSyncResult {
  newImages: number
  totalChecked: number
  status: 'success' | 'error'
  error?: string
}

export interface PinterestStatus {
  isConfigured: boolean
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
  remove: (id: string) => api.delete(`/videos/${id}`),
}
