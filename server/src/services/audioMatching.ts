import db from '../db'
import { cosine } from '../utils/matching'
import { getAllAudioMeta, getRecentAudio, AudioMeta } from './audioMetadata'
import { getSourcesByTrack, AudioSource } from './audioSources'

/**
 * Emparejamiento pista de audio ↔ frase POR PROCEDENCIA (2026-08-18).
 *
 *   AFINIDAD → coseno entre la frase candidata y las FRASES DE ORIGEN del corte:
 *     las que se leían en pantalla en los reels del nicho de donde se cosechó. Los
 *     dos vectores salen del texto crudo con el mismo taskType, así que comparan.
 *   VARIEDAD → no repetir. Regla dura (las pistas de los últimos reels quedan
 *     fuera) + un desempate mínimo por uso.
 *
 * ⚠️ La ENERGÍA ya no puntúa. Medida sobre 40 publicaciones con pista registrada,
 * no es monótona: desajuste 0–1 → 5,35 s de watch; desajuste 3+ → 5,94 s. Si
 * emparejar por energía sirviera, el orden sería el inverso. La causa está en el
 * origen del número: la «energía» de una frase la infiere un prompt que pide
 * «encontrarle la IMAGEN de fondo ideal», así que describe qué imagen le pega, no
 * qué música. El mismo defecto que jubiló al `mood_category` el 3-ago. Y el
 * inventario lo hacía imposible igualmente: 23 frases de energía 4 y CERO pistas
 * de esa energía.
 *
 * Lo que sustituye a ese eje no es un eje musical mejor: es una señal de nicho.
 * Cuando alguien del nicho usó ese corte para esa frase, ya emparejó por nosotros.
 *
 * ⚠️ Y solo suenan pistas CON procedencia confirmada (decisión de David: corte
 * limpio). Una pista sin frase de origen vectorizada no entra en el pool aunque
 * esté etiquetada — el banco se repuebla cosechando.
 */

// Desempate por uso. El número está MEDIDO sobre las 117 frases activas, no
// elegido a ojo, porque en este dominio el margen real es minúsculo:
//
//   coseno entre frases del banco:  min 0,690 · mediana 0,766 · máx 0,906 (sd 0,025)
//   distancia entre el 1.º y el 2.º con 12 candidatos:  mediana 0,0104
//
// O sea que el ganador le saca al siguiente una centésima. A partir de ahí, cuánto
// del ranking voltearía cada peso:
//
//   0,020 → 78% de las elecciones    0,005 → 31%
//   0,010 → 44%                      0,003 → 15%
//
// Con 0,02 —lo que había puesto primero— el "desempate" habría sido el matcher, que
// es exactamente el fallo del que veníamos. Con 0,003 solo mueve empates de verdad.
// Quien garantiza la rotación es la regla dura de abajo, no este número.
const USAGE_WEIGHT = 0.003

export interface AudioCandidate {
  filename: string
  /** Máximo coseno frase↔frase de origen (0..1). Afinidad, no orden de elección. */
  score: number
  /** La frase de origen que ganó: el porqué legible de esta elección. */
  sourcePhrase: string | null
  sourceUrl: string | null
  /** Nombre de la canción, si Instagram lo dio al cosechar. */
  audioTitle: string | null
  audioArtist: string | null
  /** Cuántos reels del nicho distintos usaron este tema. Dato, NO puntúa. */
  reelsDelNicho: number
  energia: number | null
  moodCategory: string | null
  textura: string | null
  usageCount: number
  /** Duración del corte. Desde el 18-ago decide cuánto dura el reel. */
  duracionSeg: number | null
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
 * La procedencia que mejor encaja con la frase, dentro de una pista.
 *
 * Se queda con el MÁXIMO y no con la media a propósito: que un tema se haya usado
 * también para frases que no vienen a cuento no lo hace peor para esta. Basta con
 * que UN reel del nicho lo haya usado para algo parecido a lo que vamos a publicar.
 */
function mejorProcedencia(
  phraseVec: Float32Array,
  fuentes: AudioSource[]
): { score: number; fuente: AudioSource } | null {
  let mejor: { score: number; fuente: AudioSource } | null = null
  for (const f of fuentes) {
    if (!f.sourceEmbedding) continue
    const score = cosine(phraseVec, f.sourceEmbedding)
    if (!mejor || score > mejor.score) mejor = { score, fuente: f }
  }
  return mejor
}

/**
 * Elige el mejor corte para una frase ya vectorizada.
 *
 * `phraseVec` es el embedding del TEXTO de la frase (`phrases.embedding_texto`),
 * no `phrases.embedding` — ese vectoriza sus metáforas visuales y sirve para
 * buscar imagen de fondo. Sin él no hay con qué comparar y se devuelve null: mejor
 * un reel sin música que uno emparejado por casualidad.
 */
export function bestAudio(
  meta: AudioMeta[],
  phraseVec: Float32Array | null,
  rotation: RotationState = {},
  sourcesByTrack: Map<string, AudioSource[]> = getSourcesByTrack()
): AudioCandidate | null {
  if (!phraseVec) return null

  // Pool = pistas con al menos una frase de origen vectorizada.
  let pool = meta.filter((m) =>
    (sourcesByTrack.get(m.filename) ?? []).some((f) => f.sourceEmbedding !== null)
  )
  if (pool.length === 0) return null

  const { extraUsage, recentTracks = [] } = rotation

  // Regla dura: las pistas de los últimos reels quedan fuera mientras haya
  // alternativa. Los pesos no bastan — el de uso se calcula sobre un `usage_count`
  // que solo sube al publicar, así que una pista con pocos usos históricos gana una
  // y otra vez. Sin esto la rotación cae en un ciclo de dos pistas.
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

  const ranked: { cand: AudioCandidate; rank: number }[] = []
  for (const m of pool) {
    const fuentes = sourcesByTrack.get(m.filename) ?? []
    const mejor = mejorProcedencia(phraseVec, fuentes)
    if (!mejor) continue
    // 1 = la menos usada del pool, 0 = la más usada. Todas iguales → todas 1.
    const usageVariety = usageSpan > 0 ? 1 - (usageOf(m) - minUsage) / usageSpan : 1
    const cand: AudioCandidate = {
      filename: m.filename,
      score: mejor.score,
      sourcePhrase: mejor.fuente.sourcePhrase,
      sourceUrl: mejor.fuente.sourceUrl,
      audioTitle: mejor.fuente.audioTitle,
      audioArtist: mejor.fuente.audioArtist,
      // Se expone pero NO entra en el ranking. Que cinco cuentas del nicho usen el
      // mismo tema es la señal más fuerte que hay ahí dentro, pero es exactamente
      // el tipo de eje plausible-sin-medir que ya falló dos veces (mood el 3-ago,
      // energía el 18-ago). Se enseña, se acumula y se decide cuando haya datos.
      reelsDelNicho: fuentes.filter((f) => f.sourceEmbedding).length,
      energia: m.energia,
      moodCategory: m.moodCategory,
      textura: m.textura,
      usageCount: m.usageCount,
      duracionSeg: m.duracionSeg,
    }
    ranked.push({ cand, rank: mejor.score + USAGE_WEIGHT * usageVariety })
  }
  if (ranked.length === 0) return null
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

/** Float32Array respetando el byteOffset del BLOB (los slices de SQLite no siempre empiezan en 0). */
function vec(b: Buffer | null): Float32Array | null {
  if (!b || b.byteLength === 0) return null
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

/**
 * Elige el mejor corte para una frase (por id). Devuelve null si la frase no
 * existe, si no está vectorizada por texto o si no hay ninguna pista cosechada con
 * procedencia confirmada. Arranca la rotación con lo que sonó en los últimos reels
 * del historial, para que un reel suelto no repita la pista del anterior.
 */
export function pickAudioForPhrase(phraseId: string): AudioCandidate | null {
  const p = db.prepare(
    `SELECT embedding_texto FROM phrases WHERE id = ?`
  ).get(phraseId) as { embedding_texto: Buffer | null } | undefined
  if (!p) return null
  const reciente = getRecentAudio(3)
  return bestAudio([...getAllAudioMeta().values()], vec(p.embedding_texto), {
    recentTextures: reciente.textures,
    recentTracks: reciente.tracks,
  })
}
