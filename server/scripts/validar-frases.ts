/**
 * La puerta de norma: comprueba que un texto cumple el perfil de marca ANTES de
 * que entre al banco. Sirve para las reconversiones a mano y para las candidatas
 * que salgan de la generación o de la ingesta.
 *
 * Cuatro comprobaciones, todas medidas contra las publicaciones reales:
 *
 *   1. **Dos tiempos** — `splitByTiempos` tiene que dar 2 bloques. Es condición
 *      necesaria, no suficiente: que parta no garantiza que el segundo tiempo
 *      REINTERPRETE al primero, y eso solo lo ve una persona.
 *   2. **Tercera persona** — heurística gramatical + `classifyPersona` (Vertex).
 *      Se exige que coincidan: es el patrón que dio 118/118 el 2026-08-18.
 *   3. **Longitud 90-130** — la franja que mejor rinde: skip 44,5% frente a 49,9%
 *      de las cortas, con las fechas controladas. Por debajo de ~90 no cabe una
 *      observación concreta más su giro, y lo que se cae siempre es el giro.
 *   4. **Que no repita** — coseno contra los embeddings del banco. Es lo que caza
 *      el tic de apertura que arruinó las reescrituras de Gemini de julio.
 *
 *   npx tsx scripts/validar-frases.ts <archivo.json> [--sin-ia] [--sin-coseno]
 *
 * El JSON puede ser un array de strings o de objetos con `nuevo` (o `texto`).
 */
import fs from 'fs'
import path from 'path'
import db from '../src/db'
import { splitByTiempos } from '../src/text/splitByTiempos'
import { classifyPersona, embedText } from '../src/services/geminiService'
import { cosine } from '../src/utils/matching'

export const MIN_LARGO = 90
export const MAX_LARGO = 130

/** Pronombres y clíticos de 2.ª persona: señal fuerte y sin ambigüedad. */
const PRON_2A = /\b(tú|tu|tus|te|ti|contigo|usted|ustedes|vosotros|vuestro|vuestra)\b/i
/** Formas verbales de 2.ª frecuentes. Sin imperativos: chocan con la 3.ª del presente. */
const VERBOS_2A = new RegExp(
  '\\b(eres|estás|estas|tienes|puedes|quieres|sabes|haces|vas|dices|sientes|crees|debes|'
  + 'necesitas|mereces|buscas|esperas|vives|llevas|pides|entras|sales|miras|decides|eliges|'
  + 'elijes|piensas|presionas|terminas|intentas|enfrentas|aprendas|ves|tomas|cambias|dejas)\\b',
  'i'
)

export interface Veredicto {
  texto: string
  largo: number
  bloques: number
  personaHeuristica: 'segunda' | 'tercera'
  personaIA?: 'segunda' | 'tercera'
  parecidoMax?: number
  parecidoCon?: string
  problemas: string[]
}

function heuristicaPersona(t: string): 'segunda' | 'tercera' {
  return PRON_2A.test(t) || VERBOS_2A.test(t) ? 'segunda' : 'tercera'
}

export async function validar(textos: string[], opts: { ia?: boolean; coseno?: boolean } = {}): Promise<Veredicto[]> {
  const usarIa = opts.ia !== false
  const usarCos = opts.coseno !== false

  const personasIA = usarIa ? await classifyPersona(textos) : []

  // Banco vectorizado, para el chequeo de repetición
  const banco = usarCos
    ? ((await db.prepare(`SELECT text, embedding FROM phrases WHERE archived = 0 AND embedding IS NOT NULL`).all()) as any[])
    : []

  const out: Veredicto[] = []
  for (let i = 0; i < textos.length; i++) {
    const texto = textos[i]
    const v: Veredicto = {
      texto,
      largo: texto.length,
      bloques: splitByTiempos(texto).length,
      personaHeuristica: heuristicaPersona(texto),
      personaIA: usarIa ? personasIA[i]?.persona : undefined,
      problemas: [],
    }

    if (v.bloques < 2) v.problemas.push('no parte en dos tiempos')
    if (v.largo < MIN_LARGO) v.problemas.push(`corta (${v.largo} < ${MIN_LARGO})`)
    if (v.largo > MAX_LARGO) v.problemas.push(`larga (${v.largo} > ${MAX_LARGO})`)
    if (v.personaHeuristica === 'segunda') v.problemas.push('2.ª persona (heurística)')
    if (usarIa && v.personaIA === 'segunda') v.problemas.push('2.ª persona (IA)')
    if (usarIa && v.personaIA && v.personaIA !== v.personaHeuristica) {
      v.problemas.push(`⚠️ jueces en desacuerdo (heur. ${v.personaHeuristica} / IA ${v.personaIA})`)
    }

    if (usarCos && banco.length) {
      // El embedding de Vertex tiene cuota POR PROYECTO (a diferencia de los
      // modelos de imagen, que van a cuota compartida): una ráfaga de llamadas
      // seguidas devuelve 429. Se espacian, y si aun así falla se degrada a
      // "no comprobado" en vez de tumbar la validación entera — el resto de la
      // puerta (norma y longitud) no depende de esto.
      try {
        if (i > 0) await new Promise((r) => setTimeout(r, 1500))
        const emb = await embedText(texto)
        let max = -1, con = ''
        for (const b of banco) {
          const c = cosine(emb, new Float32Array((b.embedding as Buffer).buffer))
          if (c > max) { max = c; con = b.text }
        }
        v.parecidoMax = max
        v.parecidoCon = con
        if (max > 0.93) v.problemas.push(`repite demasiado (coseno ${max.toFixed(3)})`)
      } catch (e: any) {
        v.problemas.push(`repetición sin comprobar (${String(e.message).slice(0, 60)})`)
      }
    }

    out.push(v)
  }
  return out
}

async function main() {
  const archivo = process.argv[2]
  if (!archivo) { console.error('Uso: npx tsx scripts/validar-frases.ts <archivo.json>'); process.exit(1) }
  const crudo = JSON.parse(fs.readFileSync(path.resolve(archivo), 'utf-8')) as any[]
  const textos = crudo.map((x) => (typeof x === 'string' ? x : x.nuevo ?? x.texto))

  const res = await validar(textos, {
    ia: !process.argv.includes('--sin-ia'),
    coseno: !process.argv.includes('--sin-coseno'),
  })

  let limpias = 0
  res.forEach((v, i) => {
    const marca = v.problemas.length ? '❌' : '✅'
    if (!v.problemas.length) limpias++
    console.log(`${marca} ${String(i + 1).padStart(2)}. ${v.largo} car · ${v.bloques} bloques · ${v.personaIA ?? v.personaHeuristica}`
      + (v.parecidoMax !== undefined ? ` · max coseno ${v.parecidoMax.toFixed(3)}` : ''))
    console.log(`     ${v.texto}`)
    if (v.problemas.length) console.log(`     ⇒ ${v.problemas.join(' · ')}`)
    if (v.parecidoMax !== undefined && v.parecidoMax > 0.90) console.log(`     ~ se parece a: ${v.parecidoCon?.slice(0, 80)}`)
  })
  console.log(`\n${limpias}/${res.length} pasan la puerta`)
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1) })
