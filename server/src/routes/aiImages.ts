import { Router } from 'express'
import path from 'path'
import { config } from '../config'
import db from '../db'
import {
  analyzePhraseStructured,
  analyzeImageStructured,
  buildImageDocument,
  embedText,
  PhraseAnalysis,
} from '../services/geminiService'
import { generateImage, downloadImage, KieAspect } from '../services/kieService'
import { invalidateImageCache } from './imageTags'

const router = Router()

const ASPECTS: KieAspect[] = ['9:16', '4:5', '1:1', '16:9', '3:4']

// ── Prompt de marca para FONDOS de reel (imagen simbólica SIN texto) ──────────
// Distinto del carrusel (que integra texto). Aquí la imagen es el fondo sobre el
// que FFmpeg/canvas pondrá la frase → debe quedar espacio negativo y NADA de texto.
// Estética RAW · STOIC · CINEMATIC calibrada en estilo-bebetter.md.
function buildBrandImagePrompt(a: PhraseAnalysis): string {
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

  return [
    'Cinematic vertical 9:16 background image for a motivational reel. Raw stoic aesthetic, dark and moody.',
    'Deep charcoal-black background (#0A0A0A), subtle fog, heavy film grain, volumetric low light, deep shadows.',
    `A single symbolic scene: ${symbol}. Minimalist, one focal concept, lots of empty negative space.`,
    `Atmosphere: ${a.mood || energyDesc}. Feel: ${energyDesc}.`,
    'Color palette: bone-white (#E8E4DC) highlights, a deep muted desaturated blood-red (#8B1A1A) accent, subtle warm faded-gold light. No blue, no neon.',
    'IMPORTANT: absolutely NO text, NO letters, NO words, NO typography, NO watermark, NO logo, NO signature.',
    'Leave the center and lower third as calm dark negative space so a caption can be added later. Photorealistic, high detail, atmospheric.',
  ].join(' ')
}

// POST /api/ai-images/prompt — propone un prompt editable desde la frase activa.
// Body: { phraseId?: string, phrase?: string }
router.post('/prompt', async (req, res) => {
  const { phraseId, phrase } = req.body ?? {}
  if (!phraseId && !phrase) return res.status(400).json({ error: 'phraseId o phrase requerido' })

  try {
    let text: string = phrase
    if (phraseId && !phrase) {
      const row = db.prepare(`SELECT text FROM phrases WHERE id = ?`).get(phraseId) as any
      text = row?.text
      if (!text) return res.status(404).json({ error: 'Frase no encontrada' })
    }

    const analysis = await analyzePhraseStructured(text)
    const prompt = buildBrandImagePrompt(analysis)
    res.json({ prompt, analysis })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

const insertImage = db.prepare(`
  INSERT INTO images (filename, tags, analysis_json, embedding, analyzed_at, usage_count, origen)
  VALUES (@filename, @tags, @analysis_json, @embedding, @analyzed_at, 0, 'ia')
  ON CONFLICT(filename) DO UPDATE SET
    tags = @tags, analysis_json = @analysis_json, embedding = @embedding,
    analyzed_at = @analyzed_at, origen = 'ia'
`)

// POST /api/ai-images/generate — genera la imagen con KIE, la guarda en el banco
// y la analiza+vectoriza (reusa el pipeline de matching existente).
// Body: { prompt: string, aspectRatio?: string, phraseId?: string }
router.post('/generate', async (req, res) => {
  const { prompt, aspectRatio } = req.body ?? {}
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt requerido' })
  const aspect: KieAspect = ASPECTS.includes(aspectRatio) ? aspectRatio : '9:16'

  try {
    // 1. Generar en KIE (async con polling)
    const resultUrl = await generateImage({ prompt, aspectRatio: aspect, resolution: '2K', outputFormat: 'png' })

    // 2. Descargar al banco de imágenes
    const filename = `ia-${Date.now()}.png`
    const outPath = path.join(config.paths.images, filename)
    await downloadImage(resultUrl, outPath)

    // 3. Analizar + vectorizar (mismo pipeline que el banco) para que entre al matching
    let tags: string[] = []
    try {
      const analysis = await analyzeImageStructured(outPath)
      const embedding = await embedText(buildImageDocument(analysis))
      tags = [analysis.emocionDominante, analysis.composicion, ...analysis.paletaColores].slice(0, 8)
      insertImage.run({
        filename,
        tags: JSON.stringify(tags),
        analysis_json: JSON.stringify(analysis),
        embedding: Buffer.from(embedding.buffer),
        analyzed_at: new Date().toISOString(),
      })
      invalidateImageCache()
    } catch (analyzeErr: any) {
      // La imagen se generó y guardó; el análisis es best-effort (se puede
      // re-analizar luego desde el banco). Igual devolvemos la imagen.
      insertImage.run({
        filename, tags: '[]', analysis_json: null, embedding: null,
        analyzed_at: null,
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
