import db from '../db'
import { getAllAudioMeta, AudioMeta } from './audioMetadata'

/**
 * Emparejamiento pista de audio ↔ frase por energía + mood (sin embeddings).
 * Reusa `phrases.nivel_energia` (0–10) y `phrases.mood_category`, comparándolos
 * con las etiquetas de cada pista. Empate → la pista menos usada (variedad).
 */

const ENERGY_WEIGHT = 0.7
const MOOD_WEIGHT = 0.3
const SCORE_EPSILON = 0.05 // dentro de este margen de score, desempata la menos usada

export interface AudioCandidate {
  filename: string
  score: number
  energia: number
  moodCategory: string | null
  usageCount: number
}

/** Score pista↔frase: cercanía de energía (0–10) + coincidencia de mood. */
export function scoreAudio(
  phraseEnergia: number | null,
  phraseMood: string | null,
  audioEnergia: number | null,
  audioMood: string | null
): number {
  const eA = typeof phraseEnergia === 'number' ? phraseEnergia : 5
  const eB = typeof audioEnergia === 'number' ? audioEnergia : 5
  const energyScore = 1 - Math.abs(eA - eB) / 10 // 0..1
  const moodScore = phraseMood && audioMood && phraseMood === audioMood ? 1 : 0
  return ENERGY_WEIGHT * energyScore + MOOD_WEIGHT * moodScore
}

/**
 * Elige la mejor pista de una lista ya cargada, para una frase (energía + mood).
 * Solo considera pistas etiquetadas. Empate dentro de ε → la menos usada.
 * Reutilizable por el auto-pick individual y por el batchPlanner (una sola carga
 * de metadata para todo el lote).
 */
export function bestAudio(
  meta: AudioMeta[],
  phraseEnergia: number | null,
  phraseMood: string | null
): AudioCandidate | null {
  const tagged = meta.filter((m) => m.energia !== null && m.moodCategory)
  if (tagged.length === 0) return null
  const cands: AudioCandidate[] = tagged.map((m) => ({
    filename: m.filename,
    score: scoreAudio(phraseEnergia, phraseMood, m.energia, m.moodCategory),
    energia: m.energia as number,
    moodCategory: m.moodCategory,
    usageCount: m.usageCount,
  }))
  cands.sort((a, b) => {
    if (Math.abs(a.score - b.score) > SCORE_EPSILON) return b.score - a.score
    return a.usageCount - b.usageCount
  })
  return cands[0]
}

/**
 * Elige la mejor pista para una frase (por id). Devuelve null si no hay pistas
 * etiquetadas o la frase no existe.
 */
export function pickAudioForPhrase(phraseId: string): AudioCandidate | null {
  const p = db.prepare(
    `SELECT nivel_energia, mood_category FROM phrases WHERE id = ?`
  ).get(phraseId) as { nivel_energia: number | null; mood_category: string | null } | undefined
  if (!p) return null
  return bestAudio([...getAllAudioMeta().values()], p.nivel_energia, p.mood_category)
}
