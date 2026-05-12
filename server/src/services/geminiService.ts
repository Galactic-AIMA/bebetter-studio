import { GoogleGenerativeAI } from '@google/generative-ai'
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

function parseTags(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(',')
    .map((t) => t.trim().replace(/[^a-záéíóúüñ\s]/gi, ''))
    .filter((t) => t.length > 1 && t.length < 30)
    .slice(0, 8)
}

export async function analyzeImage(imagePath: string): Promise<string[]> {
  const model = getClient().getGenerativeModel({ model: 'gemini-2.0-flash' })

  const ext = path.extname(imagePath).toLowerCase().replace('.', '')
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
    png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    bmp: 'image/bmp', avif: 'image/avif',
  }
  const mimeType = mimeMap[ext] ?? 'image/jpeg'
  const imageData = fs.readFileSync(imagePath).toString('base64')

  const prompt = `Analiza esta imagen y devuelve entre 5 y 8 tags emocionales o visuales en español, en minúsculas, separados por comas. Enfócate en: el mood o atmósfera (oscuro, esperanzador, tenso, sereno...), elementos visuales dominantes (fuego, agua, montaña, ciudad, naturaleza...) y la sensación que transmite (poder, soledad, libertad, lucha...). Solo los tags, sin explicación, sin puntos al final.`

  const result = await withRetry(() =>
    model.generateContent([
      prompt,
      { inlineData: { mimeType, data: imageData } },
    ])
  )

  return parseTags(result.response.text())
}

export async function extractMoodKeywords(phrase: string): Promise<string[]> {
  const model = getClient().getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `Dada esta frase motivacional: "${phrase}"
Devuelve entre 3 y 5 palabras clave en español que describan el mood visual o emocional que debería tener la imagen de fondo para acompañarla. Enfócate en atmósfera y sensación, no en el tema literal. En minúsculas, separadas por comas, sin explicación, sin puntos al final.`

  const result = await withRetry(() => model.generateContent(prompt))
  return parseTags(result.response.text())
}
