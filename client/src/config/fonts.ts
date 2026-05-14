export type FontStyleKey = 'Regular' | 'Thin' | 'Italic' | 'Bold'

export interface FontVariantDef {
  weight: string
  italic?: boolean
}

export interface FontFamilyDef {
  key: string
  displayName: string
  googleFamily: string
  variants: Partial<Record<FontStyleKey, FontVariantDef>>
}

export const FONT_FAMILIES: FontFamilyDef[] = [
  {
    key: 'PlayfairDisplay',
    displayName: 'Playfair Display',
    googleFamily: 'Playfair+Display',
    variants: {
      Regular: { weight: '400' },
      // Thin no existe en Playfair Display (peso mínimo 400)
      Italic:  { weight: '400', italic: true },
      Bold:    { weight: '700' },
    },
  },
  {
    key: 'Lato',
    displayName: 'Lato',
    googleFamily: 'Lato',
    variants: {
      Regular: { weight: '400' },
      Thin:    { weight: '100' },
      Italic:  { weight: '400', italic: true },
      Bold:    { weight: '700' },
    },
  },
  {
    key: 'Oswald',
    displayName: 'Oswald',
    googleFamily: 'Oswald',
    variants: {
      Regular: { weight: '400' },
      Thin:    { weight: '300' },
      Bold:    { weight: '700' },
      // Italic no existe para Oswald
    },
  },
  {
    key: 'RobotoCondensed',
    displayName: 'Roboto Condensed',
    googleFamily: 'Roboto+Condensed',
    variants: {
      Regular: { weight: '400' },
      Thin:    { weight: '100' },
      Italic:  { weight: '400', italic: true },
      Bold:    { weight: '700' },
    },
  },
  {
    key: 'Anton',
    displayName: 'Anton',
    googleFamily: 'Anton',
    variants: {
      Regular: { weight: '400' },
      // Anton solo tiene Regular
    },
  },
  {
    key: 'Inter',
    displayName: 'Inter',
    googleFamily: 'Inter',
    variants: {
      Regular: { weight: '400' },
      Thin:    { weight: '100' },
      Italic:  { weight: '400', italic: true },
      Bold:    { weight: '700' },
    },
  },
  {
    key: 'IBMPlexSans',
    displayName: 'IBM Plex Sans',
    googleFamily: 'IBM+Plex+Sans',
    variants: {
      Regular: { weight: '400' },
      Thin:    { weight: '100' },
      Italic:  { weight: '400', italic: true },
      Bold:    { weight: '700' },
    },
  },
]

export function buildFontMap(): Record<string, { weight: string; family: string; italic?: boolean }> {
  const map: Record<string, { weight: string; family: string; italic?: boolean }> = {}
  for (const fam of FONT_FAMILIES) {
    const quotedFamily = fam.displayName.includes(' ')
      ? `"${fam.displayName}"`
      : fam.displayName
    for (const [style, variant] of Object.entries(fam.variants)) {
      map[`${fam.key}-${style}`] = {
        weight: variant.weight,
        family: quotedFamily,
        italic: variant.italic,
      }
    }
  }
  return map
}

export function fontToCSS(fontName: string, sizePx: number): string {
  const map = buildFontMap()
  const entry = map[fontName]
  if (!entry) return `${sizePx}px sans-serif`
  const italic = entry.italic ? 'italic ' : ''
  return `${italic}${entry.weight} ${sizePx}px ${entry.family}, sans-serif`
}

export function parseFontKey(font: string): { family: string; style: FontStyleKey } {
  const lastDash = font.lastIndexOf('-')
  return {
    family: font.slice(0, lastDash),
    style: font.slice(lastDash + 1) as FontStyleKey,
  }
}
