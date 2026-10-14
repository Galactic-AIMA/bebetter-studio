import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import { subirMedia, CLAVE_IMAGENES } from '../services/mediaStore'
import db from '../db'
import {
  analyzePhraseStructured,
  analyzeImageStructured,
  buildImageDocument,
  embedText,
  PhraseAnalysis,
} from '../services/geminiService'
import { generateImage, downloadImage, KieAspect } from '../services/kieService'
import { generateImage as generateImageVertex } from '../services/vertexImageService'
import { invalidateImageCache } from './imageTags'
import { logError } from '../services/logService'

const router = Router()

const ASPECTS: KieAspect[] = ['9:16', '4:5', '1:1', '16:9', '3:4']

// Composición según dónde va el texto (textY = posición vertical del texto 0–100).
// La franja donde caerá la frase debe quedar despejada, y el sujeto en la zona
// opuesta — si no, el modelo suele meter el foco justo donde va el texto.
// OJO: no pedir "empty/dark third". Nano Banana lo toma al pie de la letra y pinta
// un rectángulo plano con borde recto justo en 1/3 de la altura (banda visible,
// se veía en ia-1785139935021.png: corte duro en y=917 de 2752). Hay que pedir
// espacio despejado PERO como continuación de la misma escena.
const NO_BAND =
  'The image must be ONE single continuous photograph: haze, light falloff, grain and depth flow smoothly across the entire frame. Never paint a flat block of solid color, never a hard horizontal edge, band, border or split — no letterboxing.'

function composition(textY: number): { reserve: string; subject: string } {
  if (textY <= 40) {
    return {
      reserve: `keep the TOP third free of any detail or object — only open air, haze, soft shadow and out-of-focus depth there, gradually falling off into darkness (a caption will be placed there). ${NO_BAND}`,
      subject: 'Place the main subject in the LOWER two-thirds; nothing important should reach into the top third',
    }
  }
  if (textY >= 60) {
    return {
      reserve: `keep the BOTTOM third free of any detail or object — only ground haze, soft shadow and out-of-focus depth there, gradually falling off into darkness (a caption will be placed there). ${NO_BAND}`,
      subject: 'Place the main subject in the UPPER two-thirds, clear of the bottom third',
    }
  }
  return {
    reserve: `keep the vertical CENTER band relatively free of detail — only atmosphere, haze and soft shadow there (a caption will be placed there). ${NO_BAND}`,
    subject: 'Place the main subject off-center (toward the top or to one side), keeping the middle band clear',
  }
}

// ── Prompt de marca para FONDOS de reel (imagen simbólica SIN texto) ──────────
// Distinto del carrusel (que integra texto). Aquí la imagen es el fondo sobre el
// que FFmpeg/canvas pondrá la frase → debe quedar espacio negativo y NADA de texto.
// Estética RAW · STOIC · CINEMATIC calibrada en estilo-bebetter.md.
// textY: posición vertical del texto en el editor (0–100) para reservar su franja.
function buildBrandImagePrompt(a: PhraseAnalysis, textY = 25): string {
  const symbol = (a.metaforasVisuales?.length ? a.metaforasVisuales : a.temas)
    .slice(0, 3)
    .join(', ')

  const e = a.nivelEnergia ?? 5
  const energyDesc =
    e <= 3
      ? 'still, quiet, contemplative, intimate'
      : e >= 7
      ? 'intense, dramatic, powerful, epic'
      : 'balanced, grounded, serene'

  const { reserve, subject } = composition(textY)

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

// POST /api/ai-images/prompt — propone un prompt editable desde la frase activa.
// Body: { phraseId?: string, phrase?: string }
router.post('/prompt', async (req, res) => {
  const { phraseId, phrase, textY } = req.body ?? {}
  if (!phraseId && !phrase) return res.status(400).json({ error: 'phraseId o phrase requerido' })
  const y = typeof textY === 'number' && textY >= 0 && textY <= 100 ? textY : 25

  try {
    let text: string = phrase
    if (phraseId && !phrase) {
      const row = (await db.prepare(`SELECT text FROM phrases WHERE id = ?`).get(phraseId)) as any
      text = row?.text
      if (!text) return res.status(404).json({ error: 'Frase no encontrada' })
    }

    const analysis = await analyzePhraseStructured(text)
    const prompt = buildBrandImagePrompt(analysis, y)
    res.json({ prompt, analysis })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

const insertImage = db.prepare(`
  INSERT INTO images (filename, tags, analysis_json, embedding, analyzed_at, usage_count, origen, modelo)
  VALUES (@filename, @tags, @analysis_json, @embedding, @analyzed_at, 0, 'ia', @modelo)
  ON CONFLICT(filename) DO UPDATE SET
    tags = @tags, analysis_json = @analysis_json, embedding = @embedding,
    analyzed_at = @analyzed_at, origen = 'ia', modelo = @modelo
`)

// POST /api/ai-images/generate — genera la imagen con KIE, la guarda en el banco
// y la analiza+vectoriza (reusa el pipeline de matching existente).
// Body: { prompt: string, aspectRatio?: string, phraseId?: string }
router.post('/generate', async (req, res) => {
  const { prompt, aspectRatio } = req.body ?? {}
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt requerido' })
  const aspect: KieAspect = ASPECTS.includes(aspectRatio) ? aspectRatio : '9:16'

  try {
    // 1-2. Generar y dejar la imagen en el banco.
    // El backend lo decide IMAGE_BACKEND: 'vertex' (directo, con cargo a los
    // créditos del ensayo) o 'kie' (revendedor). Cambiar la variable es todo el
    // rollback: kieService sigue intacto.
    const filename = `ia-${Date.now()}.png`
    const outPath = path.join(config.paths.images, filename)

    // El modelo que RESPONDIÓ, no el que se pidió: la cadena de respaldo puede
    // haber cambiado a otro, y anotar el configurado falsearía la comparación.
    let modelo = 'kie:nano-banana-pro'
    if (config.imageBackend === 'vertex') {
      // Vertex es síncrono y devuelve la imagen en base64: no hay URL que descargar.
      const r = await generateImageVertex({ prompt, aspectRatio: aspect })
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, r.buffer)
      modelo = r.modelo
    } else {
      const resultUrl = await generateImage({ prompt, aspectRatio: aspect, resolution: '2K', outputFormat: 'png' })
      await downloadImage(resultUrl, outPath)
    }

    // 2b. Subir al banco de R2 (Fase 1). Sin esto la imagen solo existe en el disco
    // de David: el lote en la nube la elegiría —la fila está en la base compartida—
    // y luego no encontraría el archivo para renderizar. Best-effort a propósito: si
    // R2 falla, la imagen ya está generada y en local, y la sube después el script
    // `subir-banco-a-r2.ts`, que es idempotente.
    try {
      await subirMedia(CLAVE_IMAGENES, filename, outPath)
    } catch (e: any) {
      logError('s3', `No se pudo subir ${filename} a R2`, e.message)
    }

    // 3. Analizar + vectorizar (mismo pipeline que el banco) para que entre al matching
    let tags: string[] = []
    try {
      const analysis = await analyzeImageStructured(outPath)
      const embedding = await embedText(buildImageDocument(analysis))
      tags = [analysis.emocionDominante, analysis.composicion, ...analysis.paletaColores].slice(0, 8)
      await insertImage.run({
        filename,
        tags: JSON.stringify(tags),
        analysis_json: JSON.stringify(analysis),
        embedding: Buffer.from(embedding.buffer),
        analyzed_at: new Date().toISOString(),
        modelo,
      })
      invalidateImageCache()
    } catch (analyzeErr: any) {
      // La imagen se generó y guardó; el análisis es best-effort (se puede
      // re-analizar luego desde el banco). Igual devolvemos la imagen.
      await insertImage.run({
        filename, tags: '[]', analysis_json: null, embedding: null,
        analyzed_at: null, modelo,
      })
    }

    res.json({
      image: {
        id: filename,
        filename,
        path: outPath,
        url: `/api/images/file/${encodeURIComponent(filename)}`,
        usageCount: 0,
        tags,
        origen: 'ia',
      },
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
