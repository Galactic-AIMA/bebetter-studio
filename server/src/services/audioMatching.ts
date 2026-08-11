import db from '../db'
import { getAllAudioMeta, getRecentAudio, AudioMeta } from './audioMetadata'

/**
 * Emparejamiento pista de audio ↔ frase (sin embeddings). Dos ejes con trabajos
 * distintos:
 *
 *   COMPATIBILIDAD → energía. `phrases.nivel_energia` vs `audio_tracks.energia`,
 *     misma escala 0–10 preguntada explícitamente en ambos lados. El pool son las
 *     pistas dentro de ±ENERGY_BAND puntos de la frase.
 *   VARIEDAD → textura + uso. Dentro del pool manda no repetir: se penaliza la
 *     pista más usada y la familia sonora de los últimos reels.
 *
 * ⚠️ El `mood_category` YA NO FILTRA (2026-08-03). Filtrar por mood colapsaba el
 * pool a 2 pistas y una sola cubría 56 de las 118 frases activas. Y el eje estaba
 * mal construido en los dos lados: el mood de las frases sale de un análisis cuyo
 * prompt pide "la imagen de fondo ideal" (es visual, y acaba duplicando la energía),
 * y en las pistas Gemini llegó a etiquetar "tenso" una que su propia descripción
 * llamaba cálida y optimista. Se conserva como dato informativo.
 */

const ENERGY_WEIGHT = 0.7
const MOOD_WEIGHT = 0.3
// Cuánta diferencia de energía se tolera dentro del pool. Con ±2 el desajuste medio
// medido sobre el banco es de 0,77 puntos y las 12 pistas entran en rotación.
const ENERGY_BAND = 2
// Pesos de variedad. Por encima de la energía a propósito: entre dos pistas que
// encajan en intensidad, importa más que no suene lo mismo dos veces seguidas que
// afinar una décima el emparejamiento — para lo segundo no hay datos (n=1..7
// publicaciones por pista, y los reels sin audio son todos de mayo-junio).
const USAGE_WEIGHT = 0.25
const TEXTURE_WEIGHT = 0.35

export interface AudioCandidate {
  filename: string
  score: number
  energia: number
  moodCategory: string | null
  textura: string | null
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

/** Estado de rotación que se arrastra entre elecciones consecutivas. */
export interface RotationState {
  /** Usos ya comprometidos y aún no escritos en la DB (`usage_count` solo sube al
   *  publicar/encolar, así que las N frases de un lote verían el mismo contador). */
  extraUsage?: Map<string, number>
  /** Texturas de los últimos reels, de la más reciente a la más antigua. */
  recentTextures?: string[]
  /** Pistas de los últimos reels, de la más reciente a la más antigua. */
  recentTracks?: string[]
}

/**
 * Elige la mejor pista de una lista ya cargada, para una frase. Solo considera
 * pistas etiquetadas con energía.
 *
 * El `score` devuelto es la AFINIDAD (0..1), no el orden con el que se eligió: es
 * lo que se muestra en la UI y en los logs, y mezclarlo con la variedad lo volvería
 * ilegible.
 */
export function bestAudio(
  meta: AudioMeta[],
  phraseEnergia: number | null,
  phraseMood: string | null,
  rotation: RotationState = {}
): AudioCandidate | null {
  const tagged = meta.filter((m) => m.energia !== null)
  if (tagged.length === 0) return null

  const e = typeof phraseEnergia === 'number' ? phraseEnergia : 5
  const distance = (m: AudioMeta) => Math.abs(e - (m.energia as number))

  // Pool por banda de energía. Si ninguna pista cae dentro (frase muy extrema),
  // se usan las más cercanas que haya en vez de quedarse sin música.
  let pool = tagged.filter((m) => distance(m) <= ENERGY_BAND)
  if (pool.length === 0) {
    const min = Math.min(...tagged.map(distance))
    pool = tagged.filter((m) => distance(m) === min)
  }

  const { extraUsage, recentTextures = [], recentTracks = [] } = rotation

  // Regla dura: las pistas de los últimos reels quedan fuera mientras haya
  // alternativa. Los pesos no bastan — el de textura penaliza la FAMILIA, y el de
  // uso se calcula sobre un `usage_count` que solo sube al publicar, así que una
  // pista con pocos usos históricos gana una y otra vez. Sin esta regla la rotación
  // cae en un ciclo de dos pistas cuando llegan frases de energía parecida.
  //
  // Se descartan tantas recientes como el pool permita, empezando por la última: si
  // excluirlas todas lo dejaría vacío, se van readmitiendo las más antiguas.
  for (let n = recentTracks.length; n > 0; n--) {
    const excluidas = new Set(recentTracks.slice(0, n))
    const filtrado = pool.filter((m) => !excluidas.has(m.filename))
    if (filtrado.length > 0) { pool = filtrado; break }
  }
  const usageOf = (m: AudioMeta) => m.usageCount + (extraUsage?.get(m.filename) ?? 0)
  const usages = pool.map(usageOf)
  const minUsage = Math.min(...usages)
  const usageSpan = Math.max(...usages) - minUsage

  const ranked = pool.map((m) => {
    // 1 = la menos usada del pool, 0 = la más usada. Todas iguales → todas 1.
    const usageVariety = usageSpan > 0 ? 1 - (usageOf(m) - minUsage) / usageSpan : 1
    // 1 = su textura no ha sonado en los últimos reels; baja cuanto más reciente.
    const since = m.textura ? recentTextures.indexOf(m.textura) : -1
    const textureVariety = since === -1 ? 1 : since / recentTextures.length

    const cand: AudioCandidate = {
      filename: m.filename,
      score: scoreAudio(phraseEnergia, phraseMood, m.energia, m.moodCategory),
      energia: m.energia as number,
      moodCategory: m.moodCategory,
      textura: m.textura,
      usageCount: m.usageCount,
    }
    const energyScore = 1 - distance(m) / 10
    return {
      cand,
      rank: energyScore + USAGE_WEIGHT * usageVariety + TEXTURE_WEIGHT * textureVariety,
    }
  })
  ranked.sort((a, b) => b.rank - a.rank)
  return ranked[0].cand
}

/** Anota en el estado de rotación la pista que se acaba de elegir. */
export function noteChosen(rotation: RotationState, chosen: AudioCandidate, keep = 3): void {
  if (rotation.extraUsage) {
    rotation.extraUsage.set(chosen.filename, (rotation.extraUsage.get(chosen.filename) ?? 0) + 1)
  }
  if (chosen.textura) {
    rotation.recentTextures = [chosen.textura, ...(rotation.recentTextures ?? [])].slice(0, keep)
  }
  rotation.recentTracks = [chosen.filename, ...(rotation.recentTracks ?? [])].slice(0, keep)
}

/**
 * Elige la mejor pista para una frase (por id). Devuelve null si no hay pistas
 * etiquetadas o la frase no existe. Arranca la rotación con lo que sonó en los
 * últimos reels del historial, para que un reel suelto no repita la textura del
 * anterior.
 */
export function pickAudioForPhrase(phraseId: string): AudioCandidate | null {
  const p = db.prepare(
    `SELECT nivel_energia, mood_category FROM phrases WHERE id = ?`
  ).get(phraseId) as { nivel_energia: number | null; mood_category: string | null } | undefined
  if (!p) return null
  const reciente = getRecentAudio(3)
  return bestAudio([...getAllAudioMeta().values()], p.nivel_energia, p.mood_category, {
    recentTextures: reciente.textures,
    recentTracks: reciente.tracks,
  })
}
