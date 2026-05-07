import { create } from 'zustand'
import { VideoConfig, TextConfig, WatermarkConfig, TextEffect, VisualStyle } from '../types'
import { PRESETS } from '../presets'

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
  textEffect: 'none',
  visualStyle: 'bebetter',
  resolution: { width: 1080, height: 1920 },
  watermark: { enabled: false, position: 'bottomRight' },
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
  setWatermark: (partial: Partial<WatermarkConfig>) => void
  setTextEffect: (effect: TextEffect) => void
  applyPreset: (style: VisualStyle) => void
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
  setWatermark: (partial) =>
    set((s) => ({ config: { ...s.config, watermark: { ...s.config.watermark!, ...partial } } })),
  setTextEffect: (effect) =>
    set((s) => ({ config: { ...s.config, textEffect: effect } })),
  applyPreset: (style) => {
    const { positionY, label: _label, ...textFields } = PRESETS[style]
    set((s) => ({
      config: {
        ...s.config,
        visualStyle: style,
        text: { ...s.config.text, ...textFields, position: { ...s.config.text.position, y: positionY } },
      },
    }))
  },
  reset: () => set({ config: DEFAULT_CONFIG, selectedPhraseId: null }),
}))
