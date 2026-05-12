export interface TextConfig {
  content: string
  font: string
  fontSize: number
  color: string
  position: { x: number; y: number }
  align: 'left' | 'center' | 'right'
  shadow: boolean
  maxWidth: number
  lineHeight: number
  letterSpacing?: number
  strokeWidth?: number
  strokeColor?: string
}

export interface VideoConfig {
  imageId: string
  imagePath: string
  imagePreviewUrl: string
  duration: number
  transition: 'fade' | 'fadeBlack' | 'none'
  transitionDuration: number
  text: TextConfig
  textEffect?: TextEffect
  grain?: boolean
  visualStyle?: VisualStyle
  resolution: { width: number; height: number }
  outputName?: string
  wrappedLines?: string[]  // calculadas en el cliente con measureText para que el servidor las use directamente
  watermark?: WatermarkConfig
}

export interface Phrase {
  id: string
  text: string
  category?: string
  author?: string
  usageCount?: number
}

export interface ImageItem {
  id: string
  filename: string
  path: string
  url: string
  usageCount?: number
}

export interface ImageConfig {
  imageId: string
  imagePath: string
  text: TextConfig
  resolution: { width: number; height: number }
  watermark?: WatermarkConfig
}

export interface VideoRecord {
  id: string
  filename: string
  title: string
  description: string
  tags: string[]
  localPath: string
  publicUrl: string
  s3Url?: string
  driveUrl?: string
  phraseId?: string
  viral?: boolean
  createdAt: string
  config: VideoConfig
}

export type TransitionType = 'fade' | 'fadeBlack' | 'none'
export type TextAlign = 'left' | 'center' | 'right'
export type TextEffect = 'none' | 'fadeIn' | 'slideUp' | 'glowPulse'
export type WatermarkPosition = 'left' | 'center' | 'right'
export type VisualStyle = 'bebetter' | 'serene' | 'raw' | 'minimal' | 'cinematic' | 'bold'

export interface WatermarkConfig {
  enabled: boolean
  position: WatermarkPosition
  y?: number
  type?: 'image' | 'text'
  text?: string
  opacity?: number
}

export type ImageVariant = 'combined' | 'hook' | 'punchline'

export interface ImageRecord {
  id: string
  filename: string
  localPath: string
  publicUrl: string
  driveUrl?: string
  phraseId?: string
  variant: ImageVariant
  viral?: boolean
  createdAt: string
  config: ImageConfig
}

export type HistoryItem =
  | (VideoRecord & { kind: 'video' })
  | (ImageRecord & { kind: 'image' })
