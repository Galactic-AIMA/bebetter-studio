import fs from 'fs'
import path from 'path'
import * as fontkit from 'fontkit'
import { config } from '../config'
import { MeasureText, wrapWith, WrapOptions } from './wrap'

/**
 * Medición tipográfica en el servidor, contra el MISMO archivo TTF que luego
 * usa FFmpeg en `drawtext:fontfile=`.
 *
 * Hasta ahora el servidor solo sabía estimar (`length * fontSize * 0.55`) y
 * dependía de que el navegador le mandase las líneas ya cortadas. Eso ataba la
 * generación a que hubiera una pestaña abierta, y —lo grave— la división por
 * tiempos viaja DENTRO de esas líneas: un lote pedido sin navegador salía con
 * el giro partido a mitad de línea y sin avisar.
 *
 * Se mide con fontkit (JS puro, sin binarios nativos): abre el TTF, aplica el
 * layout OpenType real y devuelve el avance en unidades de la fuente.
 *
 * ⚠️ Este módulo es SOLO de servidor (usa `fs`). El cliente importa `./wrap` y
 * `./splitByTiempos`, que no tocan Node.
 */

/**
 * Todas las fuentes que el selector puede pedir tienen su TTF en `data/fonts`
 * (23 claves, 23 archivos, comprobado el 2026-08-18). Antes había un mapa de
 * reserva a `C:/Windows/Fonts` —arial, georgia, calibri— que ya no sirve para
 * nada y sí hacía daño: en el contenedor esas rutas no existen, así que una
 * fuente que faltara se habría pintado con otra tipografía **sin avisar**, y el
 * corte de línea medido contra el TTF correcto habría dejado de cuadrar con lo
 * pintado. Mejor romper con un mensaje claro.
 */

/** Ruta real del TTF de una clave de fuente ('Inter-Bold'). Sin escapar. */
export function resolveFontFile(fontName: string): string {
  const propia = path.join(config.paths.fonts, `${fontName}.ttf`)
  if (fs.existsSync(propia)) return propia
  throw new Error(
    `No existe la fuente ${fontName}.ttf en ${config.paths.fonts}. ` +
    'Genérala con `python scripts/download-fonts.py --force` (FONTS_PATH apunta ahí).'
  )
}

/** Ruta del TTF en cursiva de la familia, si existe (para el pie de autor). */
export function resolveItalicFontFile(fontName: string): string | null {
  const italic = path.join(config.paths.fonts, `${fontName.split('-')[0]}-Italic.ttf`)
  return fs.existsSync(italic) ? italic : null
}

/**
 * Fuente de la marca de agua en modo texto. Era el Arial de Windows; pasa a ser
 * la Inter propia (Fase 1). Cambia levemente el trazo del handle, que va a
 * `fontsize=22` y viene desactivado por defecto en la config del editor.
 */
export function watermarkFontFile(): string {
  return resolveFontFile('Inter-Regular')
}

/** Escapa una ruta para meterla en un filtro de FFmpeg (`C:` → `C\:`). */
export function toFFmpegPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:')
}

// Abrir y parsear un TTF cuesta milisegundos, pero un lote de 30 frases mide
// cientos de veces. Se cachea por ruta.
const cache = new Map<string, fontkit.Font>()

function openFont(file: string): fontkit.Font {
  const hit = cache.get(file)
  if (hit) return hit
  const font = fontkit.openSync(file) as fontkit.Font
  cache.set(file, font)
  return font
}

/**
 * Devuelve un medidor para una fuente y un tamaño concretos.
 *
 * `font.layout()` aplica el layout OpenType completo —incluido el kerning de
 * GPOS—, que es lo que hace el navegador al medir con `canvas.measureText` y lo
 * que hace FFmpeg al pintar (`drawtext` trae `text_shaping=true` y el build va
 * con libharfbuzz). Los tres coinciden.
 *
 * ⚠️ **La imagen del contenedor necesita un FFmpeg con libharfbuzz.** Sin él,
 * `drawtext` deja de aplicar el kerning y el texto se pinta ~0,15% más ancho de
 * lo medido: el corte de línea seguiría siendo el mismo, pero la composición se
 * movería respecto a lo publicado hasta hoy.
 *
 * Residuo conocido, medido el 2026-08-18 sobre las 118 frases × 6 presets:
 * **705/708 idénticas al navegador**, y el preset de marca 118/118 (Inter mide
 * 962,616 aquí frente a 962,610 en Chrome). Las 3 que fallan son de Playfair y
 * Lato, donde fontkit sale ~0,2% más estrecho que HarfBuzz; en las tres, una
 * palabra caía a menos de 2 px del límite. Si algún día molesta, la salida es
 * medir con harfbuzzjs; hoy no compensa el peso.
 */
export function measurerFor(fontName: string, fontSize: number): MeasureText {
  const font = openFont(resolveFontFile(fontName))
  const escala = fontSize / font.unitsPerEm
  return (text: string) => (text ? font.layout(text).advanceWidth * escala : 0)
}

export interface ServerWrapOptions extends Omit<WrapOptions, 'maxPx'> {
  /** Clave de fuente del proyecto, p. ej. 'Inter-Bold'. */
  font: string
  fontSize: number
  /** Ancho máximo del texto en % del ancho de resolución. */
  maxWidth: number
  /** Ancho de la resolución de salida, en px. */
  resolutionWidth: number
}

/** Envuelve un texto midiendo con el TTF real. Mismo algoritmo que el cliente. */
export function wrapTextServer(opts: ServerWrapOptions): string[] {
  const { text, font, fontSize, maxWidth, resolutionWidth, splitBlocks } = opts
  return wrapWith(measurerFor(font, fontSize), {
    text,
    maxPx: (maxWidth / 100) * resolutionWidth,
    splitBlocks,
  })
}
