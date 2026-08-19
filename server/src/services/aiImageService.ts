import fs from 'fs'
import path from 'path'
import db from '../db'
import { config } from '../config'
import {
  analyzePhraseStructured,
  analyzeImageStructured,
  buildImageDocument,
  embedText,
  PhraseAnalysis,
} from './geminiService'
import { generateImage as generateImageKie, downloadImage, KieAspect } from './kieService'
import { generateImage as generateImageVertex } from './vertexImageService'
import { subirMedia, CLAVE_IMAGENES } from './mediaStore'
import { logError, logInfo } from './logService'

/**
 * Generar el fondo de una pieza CON IA, a medida de su frase (2026-08-18).
 *
 * Decisión de David: la IA va primero y el banco queda como respaldo. El motivo es
 * de encaje, no de estética — una imagen hecha PARA esa frase gana por definición a
 * la menos mala de 263, que es lo que puede darte un banco por muy bien que
 * empareje. Y el histórico lo acompaña: sobre las publicaciones con insights, las
 * piezas con imagen de IA hacen **5,80 s de watch y 45,4% de skip** contra 5,63 s y
 * 47,7% del banco.
 *
 * Se generá EN EL MOMENTO DE RENDERIZAR, no al planificar. Es la misma regla que
 * gobierna los copies y el contador de uso: no se gasta hasta que se decide sacar la
 * pieza. Planificar un lote sigue siendo gratis.
 *
 * Y el respaldo es de verdad: el planificador SIGUE eligiendo una imagen del banco
 * para cada par. Si la generación falla —cuota, red, filtro de contenido—, la pieza
 * sale igual con la del banco en vez de caerse el lote entero.
 */

const ASPECTO: KieAspect = '9:16'

// Posición vertical por defecto del texto en el reel (0–100). Se le pasa al prompt
// para que reserve esa franja y el fondo no compita con la frase.
const TEXTO_Y = 25

/** ¿Se generan fondos con IA en los lotes? Apagarlo devuelve el banco al mando. */
export function iaPrimeroActivo(): boolean {
  return config.iaPrimero
}

/**
 * Qué piezas de un lote llevan fondo de IA y cuáles se quedan con el banco.
 *
 * David pidió 80/20 para empezar. La parte que no es obvia es CUÁLES son las 2 de
 * cada 10 que van al banco, y sortearlas sería desaprovecharlo: a veces le tocaría
 * una frase para la que el banco solo tiene una imagen mediocre, mientras la IA
 * cubre otra que el banco bordaba.
 *
 * Así que no hay sorteo. Se ordenan las piezas por lo bien que las empareja el
 * banco (`PlannedPair.score`, el coseno conceptual ya calculado por el planificador)
 * y **el banco se queda sus mejores**. La IA cubre el resto, que es justo donde el
 * banco flojea. Ninguna llamada de más y el reparto sale por donde tiene sentido.
 *
 * Devuelve el conjunto de ÍNDICES que deben generarse con IA.
 */
export function repartoIA(scores: number[], proporcion = config.iaProporcion): Set<number> {
  const total = scores.length
  if (total === 0 || proporcion <= 0) return new Set()
  if (proporcion >= 1) return new Set(scores.map((_, i) => i))

  const conIA = Math.round(total * proporcion)
  const alBanco = total - conIA
  if (alBanco <= 0) return new Set(scores.map((_, i) => i))

  // Los `alBanco` índices con MEJOR score se quedan el banco; el resto, IA.
  const mejores = scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score)
    .slice(0, alBanco)
    .map((x) => x.i)
  const sonDelBanco = new Set(mejores)
  return new Set(scores.map((_, i) => i).filter((i) => !sonDelBanco.has(i)))
}

// ── Prompt de marca para FONDOS de reel (imagen simbólica SIN texto) ──────────
// Distinto del carrusel (que integra texto). Aquí la imagen es el fondo sobre el
// que FFmpeg pondrá la frase → debe quedar espacio negativo y NADA de texto.
// Estética RAW · STOIC · CINEMATIC calibrada en estilo-bebetter.md.
function composicion(textY: number): { reserve: string; subject: string } {
  return textY < 50
    ? {
        reserve: 'Keep the TOP third clear and unobstructed for overlaid text.',
        subject: 'The subject sits in the lower two thirds',
      }
    : {
        reserve: 'Keep the BOTTOM third clear and unobstructed for overlaid text.',
        subject: 'The subject sits in the upper two thirds',
      }
}

export function buildBrandImagePrompt(a: PhraseAnalysis, textY = TEXTO_Y): string {
  const symbol = (a.metaforasVisuales?.length ? a.metaforasVisuales : a.temas).slice(0, 3).join(', ')
  const e = a.nivelEnergia ?? 5
  const energyDesc =
    e <= 3 ? 'still, quiet, contemplative, intimate'
    : e >= 7 ? 'intense, dramatic, powerful, epic'
    : 'balanced, grounded, serene'
  const { reserve, subject } = composicion(textY)

  return [
    'Cinematic vertical 9:16 background image for a motivational reel. Raw stoic aesthetic, dark and moody.',
    `COMPOSITION (critical): ${subject}. ${reserve} Generous, uncluttered negative space — created by natural depth, fog and shadow, never by flat fill.`,
    'Deep charcoal-black background (#0A0A0A), subtle fog, heavy film grain, volumetric low light, deep shadows.',
    `A single symbolic scene: ${symbol}. Minimalist, one focal concept.`,
    `Atmosphere: ${a.mood || energyDesc}. Feel: ${energyDesc}.`,
    'Color palette: bone-white (#E8E4DC) highlights, a deep muted desaturated blood-red (#8B1A1A) accent, subtle warm faded-gold light. No blue, no neon.',
    'IMPORTANT: absolutely NO text, NO letters, NO words, NO typography, NO watermark, NO logo, NO signature. Photorealistic, high detail, atmospheric.',
  ].join(' ')
}

const insertImage = db.prepare(`
  INSERT INTO images (filename, tags, analysis_json, embedding, analyzed_at, usage_count, origen)
  VALUES (@filename, @tags, @analysis_json, @embedding, @analyzed_at, 0, 'ia')
  ON CONFLICT(filename) DO UPDATE SET
    tags = @tags, analysis_json = @analysis_json, embedding = @embedding,
    analyzed_at = @analyzed_at, origen = 'ia'
`)

export interface ImagenGenerada {
  filename: string
  localPath: string
}

/**
 * Genera el fondo de una frase, lo deja en el banco y lo deja listo para el
 * matching (analizado + vectorizado) y para la nube (subido a R2).
 *
 * Devuelve `null` en vez de lanzar: quien llama está montando una pieza y necesita
 * poder caer al banco sin que se le rompa el lote.
 */
export async function generarFondoParaFrase(
  texto: string,
  textY = TEXTO_Y
): Promise<ImagenGenerada | null> {
  try {
    const analisis = await analyzePhraseStructured(texto)
    const prompt = buildBrandImagePrompt(analisis, textY)

    const filename = `ia-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`
    const outPath = path.join(path.resolve(config.paths.images), filename)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })

    if (config.imageBackend === 'vertex') {
      const { buffer } = await generateImageVertex({ prompt, aspectRatio: ASPECTO })
      fs.writeFileSync(outPath, buffer)
    } else {
      const url = await generateImageKie({ prompt, aspectRatio: ASPECTO, resolution: '2K', outputFormat: 'png' })
      await downloadImage(url, outPath)
    }
    if (!fs.existsSync(outPath)) throw new Error('la imagen no llegó a escribirse')

    // A R2, para que el render en la nube la encuentre. Best-effort: en local la
    // pieza se hace igual, y `subir-banco-a-r2.ts` la recoge después.
    try {
      await subirMedia(CLAVE_IMAGENES, filename, outPath)
    } catch (e: any) {
      logError('s3', `Fondo IA ${filename} generado pero no subido a R2`, e.message)
    }

    // Analizar + vectorizar aquí mismo. Sin `embedding` y `analysis_json` la imagen
    // quedaría fuera del matching para siempre: no volvería a elegirla nadie, ni
    // como respaldo de otra pieza.
    try {
      const ia = await analyzeImageStructured(outPath)
      insertImage.run({
        filename,
        tags: JSON.stringify([ia.emocionDominante, ia.composicion, ...ia.paletaColores].slice(0, 8)),
        analysis_json: JSON.stringify(ia),
        embedding: Buffer.from((await embedText(buildImageDocument(ia))).buffer),
        analyzed_at: new Date().toISOString(),
      })
    } catch (e: any) {
      // La imagen sirve para ESTA pieza aunque no se haya podido analizar; se
      // registra sin vector para que exista y se pueda re-analizar desde el banco.
      insertImage.run({ filename, tags: '[]', analysis_json: null, embedding: null, analyzed_at: null })
      logError('generate', `Fondo IA ${filename} sin analizar`, e.message)
    }

    logInfo('generate', `Fondo IA generado: ${filename}`)
    return { filename, localPath: outPath }
  } catch (e: any) {
    logError('generate', 'No se pudo generar el fondo con IA; se usa el banco', e.message)
    return null
  }
}
