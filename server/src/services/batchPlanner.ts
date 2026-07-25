import db from '../db'
import { cosine, rerankScore } from '../utils/matching'
import { ImageAnalysis } from './geminiService'
import { getAllAudioMeta } from './audioMetadata'
import { bestAudio } from './audioMatching'

/**
 * Planificador del batch "por cantidad" (rediseño 2026-07-25).
 * - Etapa 1 (rotación): toma las `count` menos usadas del driver. SIN matching.
 * - Etapa 2 (compatibilidad): empareja por score (el uso solo desempata dentro
 *   de ε); asignación global greedy, imágenes únicas salvo `allowRepeat`.
 * - Audio: a cada par le asigna la pista que mejor encaja con el mood de la frase
 *   (misma lógica que el auto-pick individual). Todo editable en el preview.
 */

export type BatchDriver = 'phrases' | 'images'

export interface PlannedPair {
  phraseId: string
  phraseText: string
  author?: string
  imageId: string        // filename (PK de images)
  imageUrl: string
  score: number
  audioTrack?: string     // filename de la pista (o ausente si no hay etiquetadas)
  audioMood?: string
  audioEnergia?: number
}

const SCORE_EPSILON = 0.02 // dentro de este margen de score, desempata el uso

interface PhraseRow {
  id: string
  text: string
  author?: string
  usage_count: number
  embedding: Buffer
  nivel_energia: number | null
  paleta: string | null
  mood_category: string | null
}
interface ImageRow {
  filename: string
  usage_count: number
  embedding: Buffer
  analysis_json: string | null
}

/** Ruta pública con la que el server sirve las imágenes (coincide con /api/images). */
function imageUrl(filename: string): string {
  return `/api/images/file/${encodeURIComponent(filename)}`
}

/** Float32Array respetando el byteOffset del BLOB (los slices de SQLite no siempre empiezan en 0). */
function vec(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

/**
 * Arma un lote de `count` piezas emparejando frases↔imágenes (+ audio por mood).
 */
export function planBatch(driver: BatchDriver, count: number, allowRepeat: boolean): PlannedPair[] {
  const phrases = db.prepare(
    `SELECT id, text, author, usage_count, embedding, nivel_energia, paleta, mood_category
     FROM phrases WHERE embedding IS NOT NULL ORDER BY usage_count ASC, created_at DESC`
  ).all() as PhraseRow[]
  const images = db.prepare(
    `SELECT filename, usage_count, embedding, analysis_json
     FROM images WHERE embedding IS NOT NULL ORDER BY usage_count ASC`
  ).all() as ImageRow[]

  if (phrases.length === 0 || images.length === 0) return []

  const driverIsPhrases = driver === 'phrases'
  // Etapa 1: los `count` del driver menos usados.
  const drivers = (driverIsPhrases ? phrases : images).slice(0, count)

  // Etapa 2: candidatos frase×imagen con score; asignación global greedy.
  type Cand = { pIdx: number; iIdx: number; score: number; imgUsage: number }
  const cands: Cand[] = []
  const pList = driverIsPhrases ? drivers as PhraseRow[] : phrases
  const iList = driverIsPhrases ? images : drivers as ImageRow[]
  for (let pi = 0; pi < pList.length; pi++) {
    const p = pList[pi]
    const pPal = p.paleta ? safeJson<string[]>(p.paleta) : null
    for (let ii = 0; ii < iList.length; ii++) {
      const img = iList[ii]
      const imgAnalysis = img.analysis_json ? safeJson<ImageAnalysis>(img.analysis_json) : null
      const s = rerankScore(cosine(vec(p.embedding), vec(img.embedding)), {
        energiaA: p.nivel_energia, energiaB: imgAnalysis?.nivelEnergia,
        paletaA: pPal, paletaB: imgAnalysis?.paletaColores,
      })
      cands.push({ pIdx: pi, iIdx: ii, score: s, imgUsage: img.usage_count })
    }
  }

  // Orden: score desc; dentro de ε, la imagen menos usada primero.
  cands.sort((a, b) => {
    if (Math.abs(a.score - b.score) > SCORE_EPSILON) return b.score - a.score
    return a.imgUsage - b.imgUsage
  })

  // Greedy global: cada driver 1 vez; imágenes únicas salvo allowRepeat.
  const pairsByDriver = new Map<number, Cand>()
  const usedImg = new Set<number>()
  const targetCount = drivers.length
  for (const c of cands) {
    const dIdx = driverIsPhrases ? c.pIdx : c.iIdx
    const imgKey = driverIsPhrases ? c.iIdx : c.pIdx
    if (pairsByDriver.has(dIdx)) continue
    if (!allowRepeat && usedImg.has(imgKey)) continue
    pairsByDriver.set(dIdx, c)
    usedImg.add(imgKey)
    if (pairsByDriver.size === targetCount) break
  }

  // Audio: cargar metadata una sola vez para todo el lote.
  const audioMeta = [...getAllAudioMeta().values()]

  const out: PlannedPair[] = []
  for (const [, c] of pairsByDriver) {
    const p = pList[c.pIdx]
    const img = iList[c.iIdx]
    const audio = bestAudio(audioMeta, p.nivel_energia, p.mood_category)
    out.push({
      phraseId: p.id, phraseText: p.text, author: p.author,
      imageId: img.filename, imageUrl: imageUrl(img.filename), score: c.score,
      audioTrack: audio?.filename,
      audioMood: audio?.moodCategory ?? undefined,
      audioEnergia: audio?.energia,
    })
  }
  return out
}

function safeJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T } catch { return null }
}
