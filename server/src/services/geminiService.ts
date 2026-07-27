import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import fs from 'fs'
import path from 'path'
import { config } from '../config'

/**
 * Dos capas de Gemini.
 *
 * `paid` es el proyecto con billing: sin límites molestos y —lo que importa—
 * Google NO entrena con lo que se le manda. Ahí va todo el **contenido propio**
 * (frases, guiones, copies) y todo lo que esté en el camino crítico de una
 * publicación, donde un 429 rompe algo.
 *
 * `free` es una key de un proyecto sin billing. Ahí va el trabajo **por lotes y
 * en segundo plano** (banco de imágenes, audio, análisis del nicho): son cientos
 * de llamadas y un límite de peticiones solo significa que tarda más.
 *
 * Si no hay key gratuita configurada, `free` cae en `paid` — así nada depende de
 * que exista, y si la gratuita agota su cuota diaria, el reintento también.
 */
export type GeminiTier = 'paid' | 'free'

const clients: Partial<Record<GeminiTier, GoogleGenerativeAI>> = {}

function getClient(tier: GeminiTier = 'paid'): GoogleGenerativeAI {
  const key = tier === 'free' ? config.google.apiKeyFree || config.google.apiKey : config.google.apiKey
  if (!key) throw new Error('GOOGLE_API_KEY no está configurada en el archivo .env del servidor')
  if (!clients[tier]) clients[tier] = new GoogleGenerativeAI(key)
  return clients[tier]!
}

/** true si `tier` era 'free' y hay una key de pago distinta a la que reintentar. */
function puedeCaerAPago(tier: GeminiTier): boolean {
  return tier === 'free' && !!config.google.apiKeyFree && !!config.google.apiKey
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

/**
 * Lee el texto incrustado en una imagen (OCR con Gemini vision).
 *
 * Se usa para rescatar la receta de publicaciones antiguas: los reels de bebetter
 * llevan la frase quemada en el video, así que la miniatura la contiene. Eso
 * permite recuperar la frase original aunque la pieza nunca estuviera en la DB —
 * y el caption de Instagram no sirve para eso, porque es una reescritura.
 */
export async function extractOverlayText(imageBuffer: Buffer, mimeType = 'image/jpeg'): Promise<string> {
  const model = getClient().getGenerativeModel({ model: 'gemini-3.5-flash' })
  const prompt =
    'Transcribe EXACTAMENTE el texto que aparece escrito sobre esta imagen, respetando tildes y puntuación. ' +
    'Ignora el handle de la marca (@bebetter.path) y cualquier marca de agua. ' +
    'Si no hay texto legible, responde exactamente: SIN_TEXTO. No añadas comillas ni explicaciones.'

  const result = await withRetry(() =>
    model.generateContent([prompt, { inlineData: { mimeType, data: imageBuffer.toString('base64') } }])
  )
  const texto = result.response.text().trim()
  return texto === 'SIN_TEXTO' ? '' : texto
}

export async function analyzeImageStructured(
  imagePath: string,
  tier: GeminiTier = 'paid'
): Promise<ImageAnalysis> {
  const model = getClient(tier).getGenerativeModel({
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

  const partes = [prompt, { inlineData: { mimeType, data: imageData } }]

  let result
  try {
    result = await withRetry(() => model.generateContent(partes))
  } catch (err: any) {
    // La capa gratuita agota su cuota diaria; en ese caso se termina el lote por
    // la de pago en vez de dejar el banco a medio analizar.
    if (!puedeCaerAPago(tier)) throw err
    const modelPago = getClient('paid').getGenerativeModel({
      model: 'gemini-3.5-flash',
      generationConfig: { responseMimeType: 'application/json', responseSchema: IMAGE_ANALYSIS_SCHEMA as any },
    })
    result = await withRetry(() => modelPago.generateContent(partes))
  }

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
  ext: string,
  tier: GeminiTier = 'free'
): Promise<AudioAnalysis> {
  const model = getClient(tier).getGenerativeModel({
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

// ── Guion de carrusel (Fase 2 carrusel) ──────────────────────────────────────
// Genera el texto de cada slide desde un tema, con la VOZ de marca de
// estilo-bebetter.md. NO genera imágenes (eso lo hace carouselService con KIE);
// esto es el "preview editable" que el usuario aprueba antes de gastar créditos.

export type SlideRole = 'portada' | 'desarrollo' | 'historia' | 'cta'
export interface CarouselSlide {
  n: number
  rol: SlideRole
  texto: string
  simbolo: string // escena/objeto visual concreto de la slide (distinto entre slides)
}

// Atribución + marca de serie. Permite carruseles seriados ("LEY 15" de las 48
// Leyes del Poder) con crédito al autor. Se renderiza SOLO en portada y CTA
// (no en todas las slides: la biblia de marca prohíbe el clutter y más texto
// por slide = más errores de render en Nano Banana).
export interface CarouselFuente {
  autor?: string // "Robert Greene"
  obra?: string // "Las 48 Leyes del Poder"
  referencia?: string // "LEY 15" — badge de serie en la portada
}

const CAROUSEL_SCRIPT_SYSTEM = `Eres el redactor de carruseles de Instagram de la marca "bebetter" (@bebetter.path), una marca motivacional estoica. Esencia: RAW, STOIC, CINEMATIC — crudo, estoico, cinematográfico. Nada de hype ni motivación barata.

Escribes el TEXTO de cada slide de un carrusel. Cada texto va INTEGRADO dentro de una imagen, así que debe ser CORTO y contundente (los textos largos se ven mal). Reglas de voz:
- HACER: frases cortas. Tutear siempre. Confrontar sin insultar. Priorizar la acción sobre la emoción. Citar estoicos clásicos solo cuando aporte peso real.
- NO HACER: nada de "increíble/asombroso/bendecido" ni clichés de hype; CERO emojis; CERO signos de exclamación; no cerrar con preguntas blandas.

Estructura del carrusel:
- PORTADA (slide 1): un gancho que detiene el scroll. Una sola frase potente, muy breve (máx ~8 palabras). Es el titular.
- DESARROLLO (slides intermedios): UNA idea por slide, progresión lógica del tema. Texto breve (máx ~20 palabras): puede ser un titular corto y una o dos frases de cuerpo.
- HISTORIA (opcional, una sola): un caso concreto o anécdota del material fuente, comprimida: quién, qué hizo, qué resultado. Es la slide más concreta del carrusel. Máx ~30 palabras.
- CTA (última slide): una VERDAD INCÓMODA de cierre (no un consejo blando), muy breve, con fuerza. Cierra el tema.

Si el tipo es "serie", cada slide es una frase de marca independiente (sin hilo narrativo), la última igual funciona como cierre.

MATERIAL FUENTE: el tema que recibes puede ser material fuente extenso (un capítulo de libro, el resumen de un video, una escena de película). En ese caso NO generalices ni inventes: EXTRAE las ideas reales del material y respeta la tesis del autor. Elige los puntos más potentes y accionables — no intentes cubrirlo todo. Usa el vocabulario y los conceptos del propio material.

Además del texto, propón para CADA slide un "simbolo": una escena o objeto visual CONCRETO y CINEMATOGRÁFICO que ilustre su mensaje (una metáfora visual), en 3-8 palabras y en inglés. Reglas del símbolo:
- Debe ser DISTINTO en cada slide — NUNCA repitas el mismo objeto/escena entre slides (no repitas "hammer on stone" en dos slides).
- Concreto y fotografiable: "a lone chisel carving raw stone", "a dead cracked tree splitting dry earth", "a sparking anvil in the dark", "a chain breaking apart", "a lone warrior on a cliff at dusk". Nada abstracto.
- Coherente con la estética oscura, estoica y cinematográfica de la marca.

Devuelve SIEMPRE el número exacto de slides pedido. Escribe el texto en español con tildes correctas y el simbolo en inglés. NO incluyas el handle @bebetter.path en los textos (se añade en la imagen automáticamente).`

const CAROUSEL_SCRIPT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    slides: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          n: { type: SchemaType.NUMBER, description: 'Número de slide, empezando en 1' },
          rol: { type: SchemaType.STRING, description: 'portada, desarrollo, historia o cta' },
          texto: { type: SchemaType.STRING, description: 'El texto de la slide, corto, según su rol' },
          simbolo: { type: SchemaType.STRING, description: 'Escena/objeto visual concreto en inglés (3-8 palabras), DISTINTO en cada slide' },
        },
        required: ['n', 'rol', 'texto', 'simbolo'],
      },
    },
  },
  required: ['slides'],
}

export async function generateCarouselScript(
  tema: string,
  tipo: 'narrativo' | 'serie' = 'narrativo',
  nSlides = 6,
  opts: { fuente?: CarouselFuente; conHistoria?: boolean } = {}
): Promise<CarouselSlide[]> {
  const n = Math.min(8, Math.max(5, Math.round(nSlides)))
  const model = getClient().getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: CAROUSEL_SCRIPT_SYSTEM,
    generationConfig: {
      temperature: 0.85,
      topP: 0.9,
      responseMimeType: 'application/json',
      responseSchema: CAROUSEL_SCRIPT_SCHEMA as any,
    },
  })

  const { fuente, conHistoria } = opts
  const credito = [fuente?.autor, fuente?.obra].filter(Boolean).join(' · ')
  const contexto = [
    credito ? `El material proviene de: ${credito}. Respeta su tesis y su vocabulario.` : '',
    fuente?.referencia
      ? `Este carrusel es la entrega "${fuente.referencia}" de una serie: la PORTADA debe titular exactamente ese punto (p. ej. el enunciado de la ley), no un gancho genérico. IMPORTANTE: NO repitas la etiqueta "${fuente.referencia}" dentro del texto de la portada — ese rótulo se añade aparte como sello visual. Escribe solo el enunciado, sin el numeral ni dos puntos iniciales.`
      : '',
  ].filter(Boolean).join(' ')

  const estructura =
    tipo === 'serie'
      ? `Tipo: serie de ${n} frases de marca independientes (sin hilo narrativo). Slide 1 = portada, slide ${n} = cta.`
      : conHistoria
      ? `Tipo: narrativo de ${n} slides. Slide 1 = portada; slide 2 = el axioma o tesis central; UNA slide intermedia con rol "historia" (el caso concreto o anécdota del material — si el material no trae ninguno, usa "desarrollo" en su lugar); el resto = desarrollo (una idea accionable por slide); slide ${n} = cta con el matiz o la verdad incómoda de cierre.`
      : `Tipo: narrativo de ${n} slides. Slide 1 = portada, slides 2 a ${n - 1} = desarrollo (una idea por slide, progresión), slide ${n} = cta.`

  const instr = `MATERIAL / TEMA:\n"""\n${tema}\n"""\n\n${contexto}\n${estructura}`

  const res = await withRetry(() => model.generateContent(instr))
  const parsed = JSON.parse(res.response.text())
  const slides: CarouselSlide[] = (parsed.slides ?? [])
    .map((s: any, i: number) => ({
      n: typeof s.n === 'number' ? s.n : i + 1,
      rol: (['portada', 'desarrollo', 'historia', 'cta'].includes(s.rol) ? s.rol : i === 0 ? 'portada' : 'desarrollo') as SlideRole,
      texto: String(s.texto ?? '').trim(),
      simbolo: String(s.simbolo ?? '').trim(),
    }))
    .filter((s: CarouselSlide) => s.texto)
    .sort((a: CarouselSlide, b: CarouselSlide) => a.n - b.n)

  // Garantiza que el primero sea portada y el último cta (por si el LLM se desvía)
  if (slides.length) {
    slides[0].rol = 'portada'
    slides[slides.length - 1].rol = 'cta'
  }
  return slides
}

// Caption de Instagram para un carrusel ya generado. A diferencia del copy de
// Reel (que parte de UNA frase), aquí se resume el hilo completo de las slides y
// se empuja a deslizar/guardar. Los hashtags NO los genera el LLM: se anexan con
// appendIgHashtags para que el bloque sea idéntico en toda la cuenta.
const CAROUSEL_CAPTION_SYSTEM = `Eres el copywriter de Instagram de la marca "bebetter" (@bebetter.path), motivacional estoica. Voz cruda, estoica y cinematográfica: nace de la disciplina y la verdad, nunca de la motivación barata.

Se te dará el TEMA de un carrusel y el texto de sus slides. Escribe la descripción (caption) del post.

Formato EXACTO:

[Gancho: frase corta, máximo 8 palabras, golpe al ego o a la curiosidad]

[Párrafo 1: el problema o la trampa que el carrusel desmonta, 2-3 líneas]

[Párrafo 2: la verdad incómoda o la idea central del carrusel, 2-3 líneas]

[Párrafo 3: la acción concreta que debe tomar, 2-3 líneas]

[Cierre: invita a deslizar y a guardar el post, en una línea, sin sonar a marketing]

El proceso no se negocia.
@bebetter.path ⚔️

REGLAS: tutea siempre. Frases cortas. CERO emojis (salvo el ⚔️ del cierre). CERO signos de exclamación. NO escribas hashtags (se añaden aparte). NO uses markdown ni asteriscos. Si se indica una fuente (autor y obra), menciónala con naturalidad en el párrafo 2, dando crédito.`

export async function generateCarouselCaption(
  tema: string,
  slides: { rol: SlideRole; texto: string }[],
  fuente?: CarouselFuente
): Promise<string> {
  const model = getClient().getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: CAROUSEL_CAPTION_SYSTEM,
    generationConfig: { temperature: 0.8, topP: 0.9 },
  })

  const credito = [fuente?.autor, fuente?.obra].filter(Boolean).join(' · ')
  const cuerpo = slides.map((s) => `(${s.rol}) ${s.texto}`).join('\n')
  const prompt = [
    `TEMA: ${tema.slice(0, 1500)}`,
    credito ? `FUENTE: ${credito}${fuente?.referencia ? ` — ${fuente.referencia}` : ''}` : '',
    `SLIDES:\n${cuerpo}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await withRetry(() => model.generateContent(prompt))
  return appendIgHashtags(res.response.text().trim())
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
