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
  source?: string  // texto de atribución/autor que se muestra bajo la frase
  audioTrack?: string  // nombre del archivo de audio de fondo (vacío = sin audio)
}

export interface Phrase {
  id: string
  text: string
  category?: string
  author?: string
  usageCount?: number
  moodKeywords?: string[]
  createdAt?: string
  archived?: boolean  // retirada de la rotación, sin borrar (ver db.ts)
  // Las dos columnas de NORMA de marca (2026-08-18). Una frase que no sea
  // 'dos_tiempos' + 'tercera' no entra en el pool de publicación: ni /random, ni
  // /recommend, ni el planificador del lote la proponen. Se muestran en el banco
  // para que se vea cuál hay que reconvertir — sin el aviso, desaparecerían de la
  // rotación en silencio. `undefined` = sin clasificar, que tampoco cumple.
  estructura?: 'dos_tiempos' | 'un_golpe'
  persona?: 'segunda' | 'tercera'
}

export interface ImageItem {
  id: string
  filename: string
  path: string
  url: string
  usageCount?: number
  tags?: string[]
  analyzedAt?: string
  createdAt?: string
  origen?: string  // 'ia' = generada con IA (KIE); si no, banco/Pinterest
}

export interface ImageRecommendation {
  imageId: string
  score: number
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
