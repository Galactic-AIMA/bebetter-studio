import db from '../db'
import { cosine, rerankScore } from '../utils/matching'
import { ImageAnalysis } from './geminiService'
import { getAllAudioMeta, getRecentAudio } from './audioMetadata'
import { bestAudio, noteChosen, RotationState } from './audioMatching'
import { getSourcesByTrack } from './audioSources'
import { duracionSegunAudio } from '../utils/duracionReel'
import { EN_NORMA_SQL } from '../utils/norma'

/**
 * Planificador del batch "por cantidad" (rediseño 2026-07-25).
 * - Etapa 1 (rotación): toma las `count` menos usadas del driver. SIN matching.
 * - Etapa 2 (compatibilidad): empareja por score (el uso solo desempata dentro
 *   de ε); asignación global greedy, imágenes únicas salvo `allowRepeat`.
 * - Audio: a cada par le asigna una pista que encaje en energía con la frase y que
 *   no repita lo último que sonó (misma lógica que el auto-pick individual). Todo
 *   editable en el preview.
 */

export type BatchDriver = 'phrases' | 'images'

export interface PlannedPair {
  phraseId: string
  phraseText: string
  author?: string
  imageId: string        // filename (PK de images)
  imageUrl: string
  score: number
  audioTrack?: string     // filename del corte (ausente si no hay ninguno cosechado)
  audioMood?: string
  audioTextura?: string   // familia sonora — dato informativo desde el 18-ago
  audioEnergia?: number
  /** Frase del reel del que salió el corte: el porqué visible de la elección. */
  audioSourcePhrase?: string
  /** Coseno frase↔frase de origen (0..1). */
  audioScore?: number
  /**
   * Duración de ESTA pieza, sacada de la del corte (2026-08-18). Va por par y no por
   * lote porque cada frase se lleva un corte distinto: con una duración común, los
   * cortes más cortos que el vídeo darían la vuelta al bucle y la costura se oye.
   */
  duracionSeg?: number
}

// Jitter al score para dar VARIEDAD entre "Proponer lote" sucesivos: mueve el
// ranking en los matches cercanos sin destronar a uno claramente mejor.
const SCORE_JITTER = 0.05

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface PhraseRow {
  id: string
  text: string
  author?: string
  usage_count: number
  embedding: Buffer
  embedding_texto: Buffer | null
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
export async function planBatch(
  driver: BatchDriver,
  count: number,
  allowRepeat: boolean,
  /** Duración de reserva, solo para los cortes cuya duración no esté medida. */
  duracionLote = 10
): Promise<PlannedPair[]> {
  // Solo frases EN NORMA: es el planificador del que tira la automatizacion, y
  // una frase fuera de norma no se publicaria nunca. Ver `utils/norma.ts`.
  const phrases = (await db.prepare(
    `SELECT id, text, author, usage_count, embedding, embedding_texto, nivel_energia, paleta, mood_category
     FROM phrases WHERE embedding IS NOT NULL AND archived = 0 AND ${EN_NORMA_SQL}
     ORDER BY usage_count ASC, created_at DESC`
  ).all()) as PhraseRow[]
  const images = (await db.prepare(
    `SELECT filename, usage_count, embedding, analysis_json
     FROM images WHERE embedding IS NOT NULL ORDER BY usage_count ASC`
  ).all()) as ImageRow[]

  if (phrases.length === 0 || images.length === 0) return []

  const driverIsPhrases = driver === 'phrases'
  // Etapa 1: rotación con variedad — toma un POOL de las menos usadas y muestrea
  // `count` al azar (así "Proponer lote" da combinaciones distintas sin dejar de
  // priorizar las poco usadas). El driver se muestrea; el otro lado va completo.
  const poolSize = Math.min(
    (driverIsPhrases ? phrases : images).length,
    Math.max(count + 12, count * 4)
  )
  const pList: PhraseRow[] = driverIsPhrases ? shuffle(phrases.slice(0, poolSize)).slice(0, count) : phrases
  const iList: ImageRow[] = driverIsPhrases ? images : shuffle(images.slice(0, poolSize)).slice(0, count)
  const targetCount = driverIsPhrases ? pList.length : iList.length

  // Etapa 2: candidatos frase×imagen con score; asignación global greedy.
  type Cand = { pIdx: number; iIdx: number; score: number; jitter: number }
  const cands: Cand[] = []
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
      cands.push({ pIdx: pi, iIdx: ii, score: s, jitter: s + Math.random() * SCORE_JITTER })
    }
  }

  // Orden por score CON jitter: los matches cercanos rotan entre propuestas; un
  // match claramente mejor sigue arriba.
  cands.sort((a, b) => b.jitter - a.jitter)

  // Greedy global: cada driver 1 vez; imágenes únicas salvo allowRepeat.
  const pairsByDriver = new Map<number, Cand>()
  const usedImg = new Set<number>()
  for (const c of cands) {
    const dIdx = driverIsPhrases ? c.pIdx : c.iIdx
    const imgKey = driverIsPhrases ? c.iIdx : c.pIdx
    if (pairsByDriver.has(dIdx)) continue
    if (!allowRepeat && usedImg.has(imgKey)) continue
    pairsByDriver.set(dIdx, c)
    usedImg.add(imgKey)
    if (pairsByDriver.size === targetCount) break
  }

  // Audio: cargar metadata una sola vez para todo el lote, pero llevando la cuenta
  // de lo ya asignado AQUÍ. El usage_count de la DB solo sube al publicar/encolar,
  // así que sin este estado las N frases del lote verían contadores idénticos y
  // saldrían todas con la misma pista. Se siembra con lo que sonó en los últimos
  // reels para que el primero del lote tampoco repita.
  const audioMeta = [...(await getAllAudioMeta()).values()]
  const reciente = await getRecentAudio(3)
  // Las procedencias se cargan UNA vez por lote, no una por pieza: `bestAudio` es
  // pura y las recibe ya cargadas.
  const fuentes = await getSourcesByTrack()
  const rotation: RotationState = {
    extraUsage: new Map<string, number>(),
    recentTextures: reciente.textures,
    recentTracks: reciente.tracks,
  }

  const out: PlannedPair[] = []
  for (const [, c] of pairsByDriver) {
    const p = pList[c.pIdx]
    const img = iList[c.iIdx]
    const audio = bestAudio(audioMeta, p.embedding_texto ? vec(p.embedding_texto) : null, rotation, fuentes)
    if (audio) noteChosen(rotation, audio)
    out.push({
      phraseId: p.id, phraseText: p.text, author: p.author,
      imageId: img.filename, imageUrl: imageUrl(img.filename), score: c.score,
      audioTrack: audio?.filename,
      audioMood: audio?.moodCategory ?? undefined,
      audioTextura: audio?.textura ?? undefined,
      audioEnergia: audio?.energia ?? undefined,
      audioSourcePhrase: audio?.sourcePhrase ?? undefined,
      audioScore: audio?.score,
      duracionSeg: audio ? duracionSegunAudio(audio.duracionSeg, duracionLote) : undefined,
    })
  }
  return out
}

function safeJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T } catch { return null }
}
