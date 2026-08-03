import { create } from 'zustand'
import { VideoConfig, TextConfig, WatermarkConfig, TextEffect, VisualStyle, HistoryItem } from '../types'
import { PRESETS } from '../presets'
import { PresetConfig } from '../hooks/usePresets'

// Deriva del preset bebetter para que ambos no vuelvan a divergir: antes los
// valores estaban duplicados a mano aquí y se desincronizaban al tocar el preset.
const { label: _bebetterLabel, positionY: bebetterPositionY, ...bebetterText } = PRESETS.bebetter

const DEFAULT_TEXT: TextConfig = {
  ...bebetterText,
  content: 'Tu frase aquí...',
  position: { x: 50, y: bebetterPositionY },
  letterSpacing: 0,
  strokeWidth: 0,
  strokeColor: '#000000',
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
  grain: false,
  visualStyle: 'bebetter',
  resolution: { width: 1080, height: 1920 },
  watermark: { enabled: false, position: 'right', y: 90, type: 'text', text: '@bebetter.path', opacity: 0.35 },
  source: '',
  audioTrack: '',
}

export type ContentMode = 'video' | 'image' | 'carousel' | 'analytics'

interface VideoStore {
  config: VideoConfig
  selectedPhraseId: string | null
  selectedImageTags: string[]
  selectedImageFilename: string | null
  compatiblePhraseIds: string[]
  isGenerating: boolean
  analyzingImages: boolean
  analyzingPhrases: boolean
  syncingPinterest: boolean
  mode: ContentMode
  setConfig: (partial: Partial<VideoConfig>) => void
  setText: (partial: Partial<TextConfig>) => void
  setSelectedPhraseId: (id: string | null) => void
  setSelectedImageTags: (tags: string[]) => void
  setSelectedImage: (filename: string | null, tags: string[]) => void
  setCompatiblePhraseIds: (ids: string[]) => void
  setGenerating: (v: boolean) => void
  setAnalyzingImages: (v: boolean) => void
  setAnalyzingPhrases: (v: boolean) => void
  setSyncingPinterest: (v: boolean) => void
  setMode: (mode: ContentMode) => void
  setWatermark: (partial: Partial<WatermarkConfig>) => void
  setTextEffect: (effect: TextEffect) => void
  applyPreset: (style: VisualStyle) => void
  applyConfig: (preset: PresetConfig) => void
  loadStyleFromHistory: (item: HistoryItem) => void
  loadFullFromHistory: (item: HistoryItem) => void
  reset: () => void
}

export const useVideoStore = create<VideoStore>((set) => ({
  config: DEFAULT_CONFIG,
  selectedPhraseId: null,
  selectedImageTags: [],
  selectedImageFilename: null,
  compatiblePhraseIds: [],
  isGenerating: false,
  analyzingImages: false,
  analyzingPhrases: false,
  syncingPinterest: false,
  mode: 'video',
  setConfig: (partial) =>
    set((s) => ({ config: { ...s.config, ...partial } })),
  setText: (partial) =>
    set((s) => ({ config: { ...s.config, text: { ...s.config.text, ...partial } } })),
  setSelectedPhraseId: (id) => set({ selectedPhraseId: id }),
  setSelectedImageTags: (tags) => set({ selectedImageTags: tags }),
  setSelectedImage: (filename, tags) => set({ selectedImageFilename: filename, selectedImageTags: tags }),
  setCompatiblePhraseIds: (ids) => set({ compatiblePhraseIds: ids }),
  setGenerating: (v) => set({ isGenerating: v }),
  setAnalyzingImages: (v) => set({ analyzingImages: v }),
  setAnalyzingPhrases: (v) => set({ analyzingPhrases: v }),
  setSyncingPinterest: (v) => set({ syncingPinterest: v }),
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
  applyConfig: (preset) =>
    set((s) => ({
      config: {
        ...s.config,
        text: { ...s.config.text, ...preset.text },
        textEffect: preset.textEffect,
        visualStyle: preset.visualStyle,
        watermark: preset.watermark ?? s.config.watermark,
        duration: preset.duration,
        transition: preset.transition,
        transitionDuration: preset.transitionDuration,
      },
    })),
  loadStyleFromHistory: (item) =>
    set((s) => {
      const c = item.config
      const isVideo = item.kind === 'video'
      return {
        config: {
          ...s.config,
          text: { ...s.config.text, ...c.text, content: s.config.text.content },
          watermark: c.watermark ?? s.config.watermark,
          ...(isVideo && {
            textEffect: (item as any).config.textEffect ?? 'none',
            grain: (item as any).config.grain ?? false,
            visualStyle: (item as any).config.visualStyle ?? 'bebetter',
            duration: (item as any).config.duration,
            transition: (item as any).config.transition,
            transitionDuration: (item as any).config.transitionDuration,
          }),
        },
      }
    }),
  loadFullFromHistory: (item) =>
    set((s) => {
      const c = item.config
      const isVideo = item.kind === 'video'
      return {
        config: {
          ...s.config,
          ...c,
          imagePreviewUrl: (c as any).imagePreviewUrl ?? s.config.imagePreviewUrl,
          ...(isVideo && {
            textEffect: (item as any).config.textEffect ?? 'none',
            grain: (item as any).config.grain ?? false,
            visualStyle: (item as any).config.visualStyle ?? 'bebetter',
            duration: (item as any).config.duration,
            transition: (item as any).config.transition,
            transitionDuration: (item as any).config.transitionDuration,
          }),
        },
        selectedPhraseId: item.phraseId ?? null,
        mode: isVideo ? 'video' : 'image',
      }
    }),
  reset: () => set({ config: DEFAULT_CONFIG, selectedPhraseId: null }),
}))
