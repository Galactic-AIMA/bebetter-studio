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
}

export interface VideoConfig {
  imageId: string
  imagePath: string
  imagePreviewUrl: string
  duration: number
  transition: 'fade' | 'fadeBlack' | 'none'
  transitionDuration: number
  text: TextConfig
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
  createdAt: string
  config: VideoConfig
}

export type TransitionType = 'fade' | 'fadeBlack' | 'none'
export type TextAlign = 'left' | 'center' | 'right'
export type WatermarkPosition = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

export interface WatermarkConfig {
  enabled: boolean
  position: WatermarkPosition
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
  createdAt: string
}
