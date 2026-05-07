export type TextEffect = 'none' | 'fadeIn' | 'slideUp' | 'glowPulse'
export type WatermarkPosition = 'left' | 'right'

export interface WatermarkConfig {
  enabled: boolean
  position: WatermarkPosition
  y?: number
  type?: 'image' | 'text'
  text?: string
  opacity?: number
}

export interface TextConfig {
  content: string
  font: string
  fontSize: number
  color: string
  position: { x: number; y: number }  // 0-100 percentage of video dimensions
  align: 'left' | 'center' | 'right'
  shadow: boolean
  maxWidth: number  // percentage of video width
  lineHeight: number
}

export interface VideoConfig {
  imageId: string
  imagePath: string
  duration: number  // seconds
  transition: 'fade' | 'fadeBlack' | 'none'
  transitionDuration: number  // seconds
  text: TextConfig
  textEffect?: TextEffect
  grain?: boolean
  resolution: { width: number; height: number }  // default 1080x1920
  outputName?: string
  wrappedLines?: string[]  // pre-calculadas en el cliente con measureText real
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
  createdAt: string
  config: VideoConfig
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

export interface WebhookPayload {
  videoUrl: string
  phrase: string
  filename: string
  createdAt: string
}

export interface GenerateVideoRequest {
  config: VideoConfig
  phraseId?: string
}

export interface ImageConfig {
  imageId: string
  imagePath: string
  text: TextConfig
  resolution: { width: number; height: number }
  watermark?: WatermarkConfig
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
  config: ImageConfig
}
