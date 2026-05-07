import { useState, useCallback } from 'react'
import { TextConfig, TextEffect, VisualStyle, WatermarkConfig, TransitionType } from '../types'

export interface PresetConfig {
  text: Omit<TextConfig, 'content'>
  textEffect: TextEffect
  visualStyle?: VisualStyle
  watermark?: WatermarkConfig
  duration: number
  transition: TransitionType
  transitionDuration: number
}

export interface SavedPreset {
  id: string
  name: string
  createdAt: string
  config: PresetConfig
}

const STORAGE_KEY = 'bebetter_presets'

function load(): SavedPreset[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function persist(presets: SavedPreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

export function usePresets() {
  const [presets, setPresets] = useState<SavedPreset[]>(load)

  const savePreset = useCallback((name: string, config: PresetConfig) => {
    const next = [
      ...presets,
      { id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), config },
    ]
    setPresets(next)
    persist(next)
  }, [presets])

  const removePreset = useCallback((id: string) => {
    const next = presets.filter((p) => p.id !== id)
    setPresets(next)
    persist(next)
  }, [presets])

  return { presets, savePreset, removePreset }
}
