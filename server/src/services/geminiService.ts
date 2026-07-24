import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import fs from 'fs'
import path from 'path'
import { config } from '../config'

let client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!config.google.apiKey) throw new Error('GOOGLE_API_KEY no está configurada en el archivo .env del servidor')
  if (!client) client = new GoogleGenerativeAI(config.google.apiKey)
  return client
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 8000): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    const is429 = err?.status === 429 || err?.message?.includes('429')
    if (retries > 0 && is429) {
      await new Promise((r) => setTimeout(r, delayMs))
      return withRetry(fn, retries - 1, delayMs * 1.5)
    }
    throw err
  }
}

export interface ImageAnalysis {
  emocionDominante: string
  nivelEnergia: number
  paletaColores: string[]
  composicion: string
  descripcionMood: string
}

const IMAGE_ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    emocionDominante: {
      type: SchemaType.STRING,
      description: 'Emoción dominante de la imagen: melancolía, tensión, poder, calma, euforia, serenidad, nostalgia, rabia, esperanza, soledad',
    },
    nivelEnergia: {
      type: SchemaType.NUMBER,
      description: 'Nivel de energía visual de 0 (muy serena, quieta) a 10 (muy intensa, dinámica)',
    },
    paletaColores: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Descriptores de paleta: frío, cálido, alto contraste, monocromático, oscuro, vibrante, etc.',
    },
    composicion: {
      type: SchemaType.STRING,
      description: 'Tipo de composición: minimalista, caótica, simétrica, retrato, paisaje, abstracta, urbana',
    },
    descripcionMood: {
      type: SchemaType.STRING,
      description: '1-2 frases en lenguaje natural describiendo la atmósfera y sensación visual de la imagen, en registro descriptivo/perceptual',
    },
  },
  required: ['emocionDominante', 'nivelEnergia', 'paletaColores', 'composicion', 'descripcionMood'],
}

export async function analyzeImageStructured(imagePath: string): Promise<ImageAnalysis> {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: IMAGE_ANALYSIS_SCHEMA as any,
    },
  })

  const ext = path.extname(imagePath).toLowerCase().replace('.', '')
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
    png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    bmp: 'image/bmp', avif: 'image/avif',
  }
  const mimeType = mimeMap[ext] ?? 'image/jpeg'
  const imageData = fs.readFileSync(imagePath).toString('base64')

  const prompt = `Analiza esta imagen y devuelve un objeto JSON con el análisis visual y emocional. Para descripcionMood, escribe 1-2 frases en español describiendo la atmósfera, sensación y mood visual de la imagen en registro perceptual/descriptivo (como si describieras qué se siente al mirarla).`

  const result = await withRetry(() =>
    model.generateContent([
      prompt,
      { inlineData: { mimeType, data: imageData } },
    ])
  )

  return JSON.parse(result.response.text()) as ImageAnalysis
}

export async function extractMoodDescription(phrase: string): Promise<string> {
  const model = getClient().getGenerativeModel({ model: 'gemini-2.5-flash' })

  const prompt = `Dada esta frase motivacional: "${phrase}"

Devuelve únicamente 1-2 frases en español describiendo el mood visual y emocional que debería tener la imagen de fondo ideal para acompañarla. Escríbelo en registro descriptivo/perceptual (atmósfera, sensación, tonos), no imperativo. Sin explicaciones, sin comillas, solo la descripción.`

  const result = await withRetry(() => model.generateContent(prompt))
  return result.response.text().trim()
}

export async function embedText(text: string): Promise<Float32Array> {
  if (!config.google.apiKey) throw new Error('GOOGLE_API_KEY no está configurada')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${config.google.apiKey}`
  const res = await withRetry(async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    })
    if (!r.ok) {
      const err = await r.text()
      const e: any = new Error(err)
      if (r.status === 429) e.status = 429
      throw e
    }
    return r.json()
  })
  return new Float32Array((res as any).embedding.values)
}

// ── Copies de publicación (Fase 4) ────────────────────────────────────────────
// System prompts idénticos a los nodos Gemini nativos del workflow n8n
// "[Pub] bebetter" (gemini-3.5-flash). Al generarlos aquí (beBetterStudio),
// n8n solo manda el paquete a Telegram y no necesita credencial de Sheets.

const IG_COPY_SYSTEM = `Eres un copywriter experto en contenido de alto rendimiento y estoicismo para la marca "BeBetter Path" en Instagram. Tu voz es la de un mentor crudo, directo y autoritario que desprecia la comodidad.

Se te dará una frase o concepto. Tu función es generar el copy para la descripción del Reel.

Sigue este formato EXACTO:

[Frase corta, máximo 6 palabras, golpe al ego o curiosidad masiva]

[Párrafo 1: El problema. Describe una debilidad común de la sociedad o la trampa de la comodidad, 2-3 líneas]

[Párrafo 2: La verdad. La solución estoica o la realidad cruda que el espectador debe aceptar, 2-3 líneas]

[Párrafo 3: Acción. Un llamado a la disciplina interna y a la ejecución inmediata, 2-3 líneas]

[Parrafo 4: El proceso no se negocia.
@bebetter.path ⚔️]

REGLAS OBLIGATORIAS:
- Lenguaje masculino, fuerte y seco.
- NO incluyas hashtags.
- NO uses lenguaje motivacional barato o "mágico".
- Prohibidas: increíble, asombroso, mágico, extraordinario, dale like, suscríbete.
- Permitidas: brutal, crudo, inevitable, deuda, disciplina, proceso, forjar.
- Solo se permite el emoji de la espada (⚔️) al final.
- Responde ÚNICAMENTE con el copy resultante.`

const YT_COPY_SYSTEM = `Eres el Curador Jefe de "BeBetter Path". Tu objetivo es transformar conceptos en metadatos de YouTube Shorts que proyecten autoridad absoluta y "Empatía de Trinchera".

REGLAS DE TONO (Protocolo 80/20):
- 80% Disciplina Cruda: Sentencias secas sobre responsabilidad y esfuerzo.
- 20% Empatía de Trinchera: Reconocimiento del peso del camino (Ej: "Si la soledad te quema...").
- PROHIBICIÓN TOTAL: Nunca inicies con "Sé que", "Entiendo que" o "Te sientes". Usa afirmaciones directas.
- Vocabulario: Ley, código, arquetipo, trinchera, metal, forjar, inevitable, deuda.

REGLAS DE FORMATO:
- Título: Máximo 60 caracteres. Usa la Estructura "La Ley" o "El Arquetipo". Sin caracteres especiales.
- Descripción: Un párrafo denso. Debe usar una de las 4 Estructuras Maestras (La Ley, El Sentido, El Código o El Arquetipo).
- Footer: Firma de marca obligatoria.

Responde ÚNICAMENTE en JSON:
{
  "title": "Sentencia de autoridad de máximo impacto",
  "description": "[Estructura Maestra aplicada al concepto].\\n\\nEl proceso no se negocia.\\n@TheBeBetterPath ⚔️\\n\\n#TheBeBetterPath #Shorts #Estoicismo #Disciplina #Mentalidad",
  "tags": "bebetterpath,estoicismo,disciplina,maestria,shorts,mentalidad,honor,filosofia,autodisciplina"
}`

// Fuerza JSON válido (evita saltos de línea sin escapar dentro de "description")
const YT_META_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    title: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING },
    tags: { type: SchemaType.STRING },
  },
  required: ['title', 'description', 'tags'],
}

export interface VideoCopies {
  captionIG: string
  ytMeta: string // JSON string { title, description, tags }
}

/** Genera el caption de IG y el metadata de YouTube para una frase (Fase 4). */
export async function generateCopies(phrase: string): Promise<VideoCopies> {
  const igModel = getClient().getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: IG_COPY_SYSTEM,
    generationConfig: { temperature: 0.8, topP: 0.9 },
  })
  const ytModel = getClient().getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: YT_COPY_SYSTEM,
    generationConfig: {
      temperature: 0.6,
      responseMimeType: 'application/json',
      responseSchema: YT_META_SCHEMA as any,
    },
  })

  const [ig, yt] = await Promise.all([
    withRetry(() => igModel.generateContent(phrase)),
    withRetry(() => ytModel.generateContent(phrase)),
  ])

  return {
    captionIG: ig.response.text().trim(),
    ytMeta: yt.response.text().trim(),
  }
}

// Mantener compatibilidad con código existente que aún use las funciones anteriores
function parseTags(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(',')
    .map((t) => t.trim().replace(/[^a-záéíóúüñ\s]/gi, ''))
    .filter((t) => t.length > 1 && t.length < 30)
    .slice(0, 8)
}

export async function analyzeImage(imagePath: string): Promise<string[]> {
  const analysis = await analyzeImageStructured(imagePath)
  // Convertir análisis estructurado a tags planos para compatibilidad con UI existente
  return [
    analysis.emocionDominante,
    analysis.composicion,
    ...analysis.paletaColores.slice(0, 3),
    ...analysis.descripcionMood.toLowerCase().split(/[;,.\s]+/).filter(w => w.length > 3).slice(0, 3),
  ].filter(Boolean).slice(0, 8)
}

export async function extractMoodKeywords(phrase: string): Promise<string[]> {
  const description = await extractMoodDescription(phrase)
  return parseTags(description)
}
