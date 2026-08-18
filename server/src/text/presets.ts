/**
 * Los presets visuales de la marca, compartidos por cliente y servidor.
 *
 * Vivían solo en el cliente, y con eso bastaba mientras la única forma de
 * generar fuera el editor. Deja de bastar en cuanto el lote lo pide un bot: el
 * servidor necesita saber cómo se ve un reel de bebetter sin que haya un
 * navegador que se lo diga. Duplicar aquí los valores de marca era la receta
 * conocida para que se desincronizaran, así que se comparten por `@shared`,
 * igual que el word-wrap.
 *
 * ⚠️ Los tipos también viven aquí: `client/src/types` los reexporta.
 */

export type TextAlign = 'left' | 'center' | 'right'
export type VisualStyle = 'bebetter' | 'serene' | 'raw' | 'minimal' | 'cinematic' | 'bold'

export type PresetDef = {
  label: string
  font: string
  fontSize: number
  color: string
  shadow: boolean
  align: TextAlign
  positionY: number
  maxWidth: number
  lineHeight: number
}

export const PRESETS: Record<VisualStyle, PresetDef> = {
  // Hueso #E8E4DC sobre el degradado de carbón; interlineado apretado (1.2).
  // La fuente se queda en Inter-Bold por decisión explícita (2026-08-02).
  bebetter:  { label: 'BeBetter',  font: 'Inter-Bold',           fontSize: 42, color: '#E8E4DC', shadow: true,  align: 'center', positionY: 25, maxWidth: 60, lineHeight: 1.2 },
  serene:    { label: 'Serene',    font: 'PlayfairDisplay-Bold',  fontSize: 38, color: '#f5f0e8', shadow: false, align: 'center', positionY: 50, maxWidth: 65, lineHeight: 1.5 },
  raw:       { label: 'Raw',       font: 'RobotoCondensed-Bold', fontSize: 52, color: '#ffffff', shadow: true,  align: 'left',   positionY: 80, maxWidth: 75, lineHeight: 1.3 },
  minimal:   { label: 'Minimal',   font: 'Lato-Regular',         fontSize: 32, color: '#e0e0e0', shadow: false, align: 'center', positionY: 50, maxWidth: 55, lineHeight: 1.6 },
  cinematic: { label: 'Cinematic', font: 'Oswald-Bold',          fontSize: 56, color: '#ffffff', shadow: true,  align: 'center', positionY: 70, maxWidth: 70, lineHeight: 1.2 },
  bold:      { label: 'Bold',      font: 'Inter-Bold',            fontSize: 64, color: '#FFD600', shadow: true,  align: 'center', positionY: 50, maxWidth: 75, lineHeight: 1.3 },
}

