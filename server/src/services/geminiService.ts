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
