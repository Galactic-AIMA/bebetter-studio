// Matching semántico frase↔imagen (2026-07-24).
// Centraliza el coseno (antes duplicado en 2 rutas) y el re-rank estructurado.
//
// Diseño (Enfoque C, "manda el símbolo"): el score primario es el coseno de los
// vectores conceptuales-simbólicos; energía y paleta solo AFINAN con pesos
// pequeños, así el concepto/metáfora nunca queda destronado por la atmósfera.

/** Similitud coseno entre dos vectores de embedding. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d === 0 ? 0 : dot / d
}

function normalizeToken(s: string): string {
  return s.trim().toLowerCase()
}

/** Overlap de paleta (Jaccard sobre descriptores). 0 = nada en común, 1 = idénticas. */
export function paletaOverlap(a: string[] = [], b: string[] = []): number {
  if (!a.length || !b.length) return 0
  const setA = new Set(a.map(normalizeToken))
  const setB = new Set(b.map(normalizeToken))
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : inter / union
}

// Pesos del re-rank. Pequeños a propósito: sobre un coseno típico (~0.5–0.9),
// mueven el ranking en los empates sin invertir un buen match conceptual.
export const ENERGY_WEIGHT = 0.10
export const PALETTE_WEIGHT = 0.05

export interface StructuralSignals {
  energiaA?: number | null // 0–10
  energiaB?: number | null
  paletaA?: string[] | null
  paletaB?: string[] | null
}

/** Ajuste estructural: penaliza diferencia de energía, premia paleta compartida. */
export function structuralDelta(s: StructuralSignals): number {
  let delta = 0
  if (typeof s.energiaA === 'number' && typeof s.energiaB === 'number') {
    delta -= ENERGY_WEIGHT * (Math.abs(s.energiaA - s.energiaB) / 10)
  }
  if (s.paletaA?.length && s.paletaB?.length) {
    delta += PALETTE_WEIGHT * paletaOverlap(s.paletaA, s.paletaB)
  }
  return delta
}

/** Score final = coseno conceptual + ajuste estructural fino. */
export function rerankScore(cos: number, signals: StructuralSignals): number {
  return cos + structuralDelta(signals)
}
