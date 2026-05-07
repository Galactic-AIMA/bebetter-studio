import { create } from 'zustand'
import { VideoConfig, TextConfig } from '../types'

const DEFAULT_TEXT: TextConfig = {
  content: 'Tu frase aquí...',
  font: 'Montserrat-Bold',
  fontSize: 42,
  color: '#ffffff',
  position: { x: 50, y: 25 },
  align: 'center',
  shadow: true,
  maxWidth: 60,
  lineHeight: 1.4,
}

const DEFAULT_CONFIG: VideoConfig = {
  imageId: '',
  imagePath: '',
  imagePreviewUrl: '',
  duration: 10,
  transition: 'fadeBlack',
  transitionDuration: 1.0,
  text: DEFAULT_TEXT,
  resolution: { width: 1080, height: 1920 },
}

export type ContentMode = 'video' | 'image'

interface VideoStore {
  config: VideoConfig
  selectedPhraseId: string | null
  isGenerating: boolean
  mode: ContentMode
  setConfig: (partial: Partial<VideoConfig>) => void
  setText: (partial: Partial<TextConfig>) => void
  setSelectedPhraseId: (id: string | null) => void
  setGenerating: (v: boolean) => void
  setMode: (mode: ContentMode) => void
  reset: () => void
}

export const useVideoStore = create<VideoStore>((set) => ({
  config: DEFAULT_CONFIG,
  selectedPhraseId: null,
  isGenerating: false,
  mode: 'video',
  setConfig: (partial) =>
    set((s) => ({ config: { ...s.config, ...partial } })),
  setText: (partial) =>
    set((s) => ({ config: { ...s.config, text: { ...s.config.text, ...partial } } })),
  setSelectedPhraseId: (id) => set({ selectedPhraseId: id }),
  setGenerating: (v) => set({ isGenerating: v }),
  setMode: (mode) => set({ mode }),
  reset: () => set({ config: DEFAULT_CONFIG, selectedPhraseId: null }),
}))
