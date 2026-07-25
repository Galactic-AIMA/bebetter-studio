import db from '../db'
import { getAllAudioMeta } from './audioMetadata'

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
 * Elige la mejor pista para una frase. Solo considera pistas etiquetadas (con
 * energia y mood). Empate dentro de ε → la menos usada. Devuelve null si no hay
 * pistas etiquetadas o la frase no existe.
 */
export function pickAudioForPhrase(phraseId: string): AudioCandidate | null {
  const p = db.prepare(
    `SELECT nivel_energia, mood_category FROM phrases WHERE id = ?`
  ).get(phraseId) as { nivel_energia: number | null; mood_category: string | null } | undefined
  if (!p) return null

  const meta = [...getAllAudioMeta().values()].filter(
    (m) => m.energia !== null && m.moodCategory
  )
  if (meta.length === 0) return null

  const cands: AudioCandidate[] = meta.map((m) => ({
    filename: m.filename,
    score: scoreAudio(p.nivel_energia, p.mood_category, m.energia, m.moodCategory),
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
