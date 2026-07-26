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
  // Capa semántica/simbólica (matching conceptual — 2026-07-24)
  elementos: string[] // qué HAY, literal: prisionero, barrotes, montaña, mar
  temas: string[] // qué EVOCA, metáfora: encierro, falta de libertad, superación
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
    elementos: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Sujetos/objetos/símbolos CONCRETOS visibles en la imagen (qué HAY, literal): prisionero, barrotes, cadenas, cumbre, mar, silueta, puerta, camino. 3-6 items.',
    },
    temas: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Conceptos, metáforas o ideas abstractas que la imagen EVOCA (qué significa, simbólico): encierro, falta de libertad, esclavitud, superación, soledad, lucha, renacer. 3-6 items.',
    },
  },
  required: ['emocionDominante', 'nivelEnergia', 'paletaColores', 'composicion', 'descripcionMood', 'elementos', 'temas'],
}

export async function analyzeImageStructured(imagePath: string): Promise<ImageAnalysis> {
  const model = getClient().getGenerativeModel({
    model: 'gemini-3.5-flash',
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

  const prompt = `Analiza esta imagen y devuelve un objeto JSON con el análisis visual, emocional y SIMBÓLICO.
- descripcionMood: 1-2 frases en español sobre la atmósfera y sensación (qué se siente al mirarla).
- elementos: los sujetos/objetos/símbolos CONCRETOS que se ven (qué HAY, literal).
- temas: las ideas abstractas o metáforas que la imagen EVOCA (qué significa). Ej: una celda con barrotes → temas "encierro, falta de libertad". Una cumbre nevada → temas "superación, meta, esfuerzo". Piensa qué mensaje motivacional podría ilustrar esta imagen.`

  const result = await withRetry(() =>
    model.generateContent([
      prompt,
      { inlineData: { mimeType, data: imageData } },
    ])
  )

  return JSON.parse(result.response.text()) as ImageAnalysis
}

// ── Análisis conceptual de frase (matching simbólico — 2026-07-24) ─────────────
// Simétrico al análisis de imagen: extrae los temas/metáforas de la frase para
// que el embedding conecte por concepto (esclavitud emocional ↔ imagen de preso),
// no solo por atmósfera.

export interface PhraseAnalysis {
  temas: string[] // conceptos/ideas de la frase: libertad, disciplina, miedo
  metaforasVisuales: string[] // imágenes que la representarían: cadenas, cumbre, tormenta
  nivelEnergia: number // 0 (quieta, íntima) a 10 (intensa, épica) — para el re-rank
  paletaIdeal: string[] // paleta que le calzaría: oscuro, frío, alto contraste
  mood: string // 1-2 frases de atmósfera visual ideal
  moodCategory: string // slug de MOOD_CATEGORIES — para el emparejamiento de audio
}

const PHRASE_ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    temas: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Conceptos/ideas abstractas centrales de la frase: libertad, esclavitud emocional, disciplina, miedo, soledad, superación. 3-6 items.',
    },
    metaforasVisuales: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Símbolos u objetos visuales concretos que REPRESENTARÍAN la frase: cadenas, prisión, jaula, cumbre, tormenta, camino, amanecer. 3-6 items.',
    },
    nivelEnergia: {
      type: SchemaType.NUMBER,
      description: 'Energía que pide la frase, de 0 (quieta, íntima, reflexiva) a 10 (intensa, épica, de combate).',
    },
    paletaIdeal: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Descriptores de la paleta que le calzaría: oscuro, frío, cálido, alto contraste, monocromático, vibrante. 1-3 items.',
    },
    mood: {
      type: SchemaType.STRING,
      description: '1-2 frases en español sobre la atmósfera visual ideal para acompañar la frase (registro perceptual).',
    },
    moodCategory: {
      type: SchemaType.STRING,
      description: 'Mood dominante de la frase. UNO de: reflexivo, melancolico, esperanzador, motivador, epico, tenso.',
    },
  },
  required: ['temas', 'metaforasVisuales', 'nivelEnergia', 'paletaIdeal', 'mood', 'moodCategory'],
}

/** Analiza una frase en su capa conceptual+simbólica (para matching con imágenes). */
export async function analyzePhraseStructured(phrase: string): Promise<PhraseAnalysis> {
  const model = getClient().getGenerativeModel({
    model: 'gemini-3.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: PHRASE_ANALYSIS_SCHEMA as any,
    },
  })

  const prompt = `Frase motivacional: "${phrase}"

Analízala para encontrarle la imagen de fondo ideal. Extrae sus temas/conceptos, las metáforas visuales que la representarían (símbolos concretos que un banco de imágenes podría tener), la energía que pide, la paleta ideal y su mood. Piensa qué se VE en una imagen que ilustre esta frase, no solo qué se siente.`

  const result = await withRetry(() => model.generateContent(prompt))
  const out = JSON.parse(result.response.text()) as PhraseAnalysis
  if (!MOOD_CATEGORIES.includes(out.moodCategory as any)) out.moodCategory = 'motivador'
  return out
}

// ── Documentos a embeber (SOLO lo concreto — "manda el símbolo") ───────────────
// Validado en subset (2026-07-24): embeber solo los elementos concretos de la
// imagen contra las metáforas visuales concretas de la frase discrimina mejor y
// hace el matching simbólico real (frase de guerrero → imagen de guerrero). Meter
// los `temas` abstractos aplanaba el ranking (todos convergían a "superación").
// El mood/atmósfera entra por el re-rank de energía+paleta, no por el vector.

/** Texto que se vectoriza por una imagen: sus elementos visuales concretos. */
export function buildImageDocument(a: ImageAnalysis): string {
  const concreto = (a.elementos ?? []).join(', ')
  return concreto || a.descripcionMood // fallback si el análisis no trae elementos
}

/** Texto que se vectoriza por una frase: las metáforas visuales que la representan. */
export function buildPhraseDocument(a: PhraseAnalysis): string {
  const concreto = (a.metaforasVisuales ?? []).join(', ')
  return concreto || a.mood // fallback si no trae metáforas
}

export async function extractMoodDescription(phrase: string): Promise<string> {
  const model = getClient().getGenerativeModel({ model: 'gemini-3.5-flash' })

  const prompt = `Dada esta frase motivacional: "${phrase}"

Devuelve únicamente 1-2 frases en español describiendo el mood visual y emocional que debería tener la imagen de fondo ideal para acompañarla. Escríbelo en registro descriptivo/perceptual (atmósfera, sensación, tonos), no imperativo. Sin explicaciones, sin comillas, solo la descripción.`

  const result = await withRetry(() => model.generateContent(prompt))
  return result.response.text().trim()
}

// ── Análisis de audio (emparejamiento por energía + mood — 2026-07-25) ─────────
// Taxonomía de mood compartida entre pistas de audio y frases. Slugs sin acento
// (claves de matching); la etiqueta bonita vive en el frontend.
export const MOOD_CATEGORIES = [
  'reflexivo', 'melancolico', 'esperanzador', 'motivador', 'epico', 'tenso',
] as const
export type MoodCategory = (typeof MOOD_CATEGORIES)[number]

export interface AudioAnalysis {
  energia: number // 0–10 (misma escala que phrase.nivel_energia)
  moodCategory: MoodCategory
  descripcion: string // 1-2 frases
}

const AUDIO_ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    energia: {
      type: SchemaType.NUMBER,
      description: 'Energía/intensidad de la música de 0 (muy calmada, íntima, lenta) a 10 (muy intensa, épica, rápida).',
    },
    moodCategory: {
      type: SchemaType.STRING,
      description:
        'Mood dominante. UNO de exactamente estos slugs: reflexivo (calmado, introspectivo), melancolico (triste, nostálgico), esperanzador (luminoso, positivo), motivador (impulso, decisión), epico (grandioso, heroico, triunfal), tenso (oscuro, dramático, inquietante).',
    },
    descripcion: {
      type: SchemaType.STRING,
      description: '1-2 frases en español describiendo la atmósfera de la pista (instrumentación, ritmo, sensación).',
    },
  },
  required: ['energia', 'moodCategory', 'descripcion'],
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mp3', mpeg: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
  wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
}

/**
 * Analiza una pista de audio (mood/energía) con Gemini. `audioBuffer` debe ser
 * una MUESTRA corta (~30-45s) para acotar tokens; ver el recorte en la ruta.
 */
export async function analyzeAudioStructured(
  audioBuffer: Buffer,
  ext: string
): Promise<AudioAnalysis> {
  const model = getClient().getGenerativeModel({
    model: 'gemini-3.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: AUDIO_ANALYSIS_SCHEMA as any,
    },
  })
  const mimeType = AUDIO_MIME[ext.toLowerCase().replace('.', '')] ?? 'audio/mpeg'
  const prompt = `Analiza esta pista musical instrumental (para fondo de un Reel motivacional). Devuelve su energía (0-10), su mood dominante (uno de los slugs indicados) y una descripción breve. Es música sin voz; juzga por ritmo, instrumentación y atmósfera.`

  const result = await withRetry(() =>
    model.generateContent([prompt, { inlineData: { mimeType, data: audioBuffer.toString('base64') } }])
  )
  const parsed = JSON.parse(result.response.text()) as AudioAnalysis
  // Normaliza: energía a [0,10]; mood a un slug conocido (fallback 'motivador').
  parsed.energia = Math.max(0, Math.min(10, Math.round(Number(parsed.energia) || 0)))
  if (!MOOD_CATEGORIES.includes(parsed.moodCategory)) parsed.moodCategory = 'motivador'
  return parsed
}

// taskType SEMANTIC_SIMILARITY = correcto para matching simétrico frase↔imagen
// (ambos lados describen "lo mismo" en registro comparable). Cambiarlo invalida
// los vectores guardados → hay que re-vectorizar todo el banco.
export async function embedText(
  text: string,
  taskType: 'SEMANTIC_SIMILARITY' | 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'SEMANTIC_SIMILARITY',
): Promise<Float32Array> {
  if (!config.google.apiKey) throw new Error('GOOGLE_API_KEY no está configurada')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${config.google.apiKey}`
  const res = await withRetry(async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] }, taskType }),
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

const IG_COPY_SYSTEM = `Eres un copywriter experto en contenido de alto rendimiento y estoicismo para la marca "BeBetter Path" en Instagram. Tu voz nace de la disciplina y la verdad, nunca de la motivación barata.

ANTES DE ESCRIBIR, identifica el registro emocional de la frase y adapta tu tono a ella:
- Frase cruda, confrontativa o sobre la comodidad → directo, seco y autoritario (tu tono por defecto).
- Frase reflexiva, serena o filosófica → pausado, íntimo y contemplativo; menos imperativos, más hondura.
- Frase épica, de superación o esperanza → aspiracional y con fuerza, sin caer en lo cursi.
El copy debe sentirse como una EXTENSIÓN de la frase, jamás contradecir su emoción.

Se te dará una frase o concepto. Tu función es generar el copy para la descripción del Reel.

Sigue este formato EXACTO:

[Frase corta, máximo 6 palabras, golpe al ego o curiosidad masiva]

[Párrafo 1: El problema. Describe una debilidad común de la sociedad o la trampa de la comodidad, 2-3 líneas]

[Párrafo 2: La verdad. La solución estoica o la realidad cruda que el espectador debe aceptar, 2-3 líneas]

[Párrafo 3: Acción. Un llamado a la disciplina interna y a la ejecución inmediata, 2-3 líneas]

[Parrafo 4: El proceso no se negocia.
@bebetter.path ⚔️]

REGLAS OBLIGATORIAS:
- La intensidad la marca el registro de la frase; NO fuerces dureza en frases reflexivas o serenas.
- NO incluyas hashtags.
- NO uses lenguaje motivacional barato o "mágico".
- Prohibidas: increíble, asombroso, mágico, extraordinario, dale like, suscríbete.
- Vocabulario duro (brutal, crudo, inevitable, deuda, disciplina, forjar): SOLO en el registro duro; en registros reflexivos o épicos usa el léxico que pida la emoción.
- Solo se permite el emoji de la espada (⚔️) al final.
- Responde ÚNICAMENTE con el copy resultante.`

// Bloque fijo de hashtags de marca + nicho que se añade al final de cada caption
// de Instagram. Deterministas (el LLM NO los genera → constantes garantizados).
// Editá esta lista para ajustar el set. El system prompt sigue prohibiendo que
// Gemini genere hashtags, así el bloque no se duplica.
const IG_HASHTAGS = [
  '#BeBetterPath',
  '#Estoicismo',
  '#Disciplina',
  '#Mentalidad',
  '#Motivacion',
  '#Mindset',
  '#Estoico',
  '#DesarrolloPersonal',
]

/** Añade el bloque fijo de hashtags al final del caption de IG. */
function appendIgHashtags(caption: string): string {
  return `${caption.trim()}\n\n${IG_HASHTAGS.join(' ')}`
}

const YT_COPY_SYSTEM = `Eres el Curador Jefe de "BeBetter Path". Tu objetivo es transformar conceptos en metadatos de YouTube Shorts que proyecten autoridad absoluta y "Empatía de Trinchera".

REGLAS DE TONO:
- Identifica el registro emocional del concepto y adapta el tono. Por defecto: Disciplina Cruda (sentencias secas sobre responsabilidad y esfuerzo). Si el concepto es reflexivo, sereno o esperanzador, modula hacia un registro más pausado y hondo, SIN perder autoridad ni caer en motivación barata.
- Mantén siempre la Empatía de Trinchera: reconocimiento del peso del camino (Ej: "Si la soledad te quema...").
- PROHIBICIÓN TOTAL: Nunca inicies con "Sé que", "Entiendo que" o "Te sientes". Usa afirmaciones directas.
- Vocabulario duro (Ley, código, arquetipo, trinchera, metal, forjar, inevitable, deuda) para el registro de disciplina; ajústalo cuando el registro sea más reflexivo.

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
    captionIG: appendIgHashtags(ig.response.text().trim()),
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
