/**
 * Puebla `phrases.persona` — el único dato de la norma de marca que no existía
 * en ninguna parte.
 *
 * **Dos jueces, y solo escribe donde coinciden.** Es el patrón que este proyecto
 * ya aprendió a la mala: Gemini ha fallado tres veces etiquetando con vocabulario
 * cerrado (29-jul, 02-ago, 03-ago), y la clasificación de `estructura` acabó
 * haciéndose a mano justo por eso.
 *
 *   1. **Heurística gramatical** — pronombres y clíticos de 2.ª persona, más una
 *      lista de formas verbales. Es determinista y no alucina, pero se le escapa
 *      el imperativo sin pronombre.
 *   2. **Vertex** (`classifyPersona`), que además devuelve la palabra que delata
 *      cada decisión, para poder auditar sin releer las 118.
 *
 * Donde discrepan, la frase se queda **sin marcar** y sale a
 * `persona-desacuerdos.json` para que lo mire David. Un dato de norma a medias
 * es peor que ninguno: el planificador lo usaría para decidir qué se publica.
 *
 *   npx tsx scripts/clasificar-persona.ts [--apply] [--todas]
 */
import fs from 'fs'
import path from 'path'
import db from '../src/db'
import { classifyPersona, PersonaGramatical } from '../src/services/geminiService'

const APLICAR = process.argv.includes('--apply')
const TODAS = process.argv.includes('--todas')  // incluir archivadas
const TANDA = 20

// ── Juez 1: heurística ────────────────────────────────────────────────────────

/** Pronombres, clíticos y posesivos de 2.ª persona. Señal fuerte y sin ambigüedad. */
const PRONOMBRES_2A = /\b(tú|tu|tus|te|ti|contigo|usted|ustedes|vosotros|vuestro|vuestra)\b/i

/**
 * Formas verbales de 2.ª persona del singular frecuentes en el banco.
 * ⚠️ NO se listan imperativos ("deja", "mira", "busca"): son idénticos a la 3.ª
 * persona del presente ("el que deja", "quien mira") y meterlos dispararía falsos
 * positivos. Ese hueco es justo lo que tiene que cazar el segundo juez.
 */
const VERBOS_2A = new RegExp(
  '\\b(eres|estás|estas|tienes|puedes|quieres|sabes|haces|vas|dices|sientes|crees|debes|'
  + 'necesitas|mereces|buscas|esperas|vives|llevas|pides|entras|sales|miras|decides|eliges|'
  + 'elijes|piensas|creíste|tuviste|fuiste|hiciste|serás|tendrás|podrás|harás|verás|estarás)\\b',
  'i'
)

function heuristica(texto: string): { persona: PersonaGramatical; marca: string } {
  const pron = texto.match(PRONOMBRES_2A)
  if (pron) return { persona: 'segunda', marca: pron[0] }
  const verbo = texto.match(VERBOS_2A)
  if (verbo) return { persona: 'segunda', marca: verbo[0] }
  return { persona: 'tercera', marca: '' }
}

// ── Ejecución ─────────────────────────────────────────────────────────────────

interface Fila { id: string; text: string; archived: number }

async function main() {
  const filas = db.prepare(
    `SELECT id, text, archived FROM phrases ${TODAS ? '' : 'WHERE archived = 0'} ORDER BY created_at`
  ).all() as Fila[]

  console.log(`Frases a clasificar: ${filas.length}${TODAS ? ' (incluidas archivadas)' : ' (solo activas)'}\n`)

  const acuerdos: { id: string; persona: PersonaGramatical }[] = []
  const desacuerdos: any[] = []

  for (let i = 0; i < filas.length; i += TANDA) {
    const tanda = filas.slice(i, i + TANDA)
    process.stdout.write(`  tanda ${Math.floor(i / TANDA) + 1} (${tanda.length} frases)… `)
    const llm = await classifyPersona(tanda.map((f) => f.text))

    let coinciden = 0
    tanda.forEach((f, k) => {
      const h = heuristica(f.text)
      if (h.persona === llm[k].persona) {
        acuerdos.push({ id: f.id, persona: h.persona })
        coinciden++
      } else {
        desacuerdos.push({
          id: f.id,
          texto: f.text,
          heuristica: h.persona,
          marcaHeuristica: h.marca,
          llm: llm[k].persona,
          marcaLlm: llm[k].marca,
        })
      }
    })
    console.log(`${coinciden}/${tanda.length} de acuerdo`)
  }

  const reparto = acuerdos.reduce<Record<string, number>>((a, x) => {
    a[x.persona] = (a[x.persona] ?? 0) + 1
    return a
  }, {})

  console.log(`\nDe acuerdo   : ${acuerdos.length}  ${JSON.stringify(reparto)}`)
  console.log(`En desacuerdo: ${desacuerdos.length}`)
  for (const d of desacuerdos) {
    console.log(`\n  ⚠️ ${d.id.slice(0, 8)} — heurística: ${d.heuristica} (${d.marcaHeuristica || '—'}) · IA: ${d.llm} (${d.marcaLlm})`)
    console.log(`     ${d.texto}`)
  }

  const salida = path.join(__dirname, 'persona-desacuerdos.json')
  fs.writeFileSync(salida, JSON.stringify(desacuerdos, null, 2), 'utf-8')
  console.log(`\nDesacuerdos guardados en ${salida}`)

  // Resoluciones a mano de desacuerdos, con el motivo escrito al lado. Se aplican
  // encima de los acuerdos: es el mismo patrón que `estructura`, y evita la
  // tentación de ir ampliando la lista de verbos hasta que la heurística coincida
  // con la IA — eso dejaría al segundo juez de adorno sin haber comprobado nada.
  const manual = require('./persona-manual.json') as { id: string; persona: PersonaGramatical; porque: string }[]
  const porId = new Map(manual.map((m) => [m.id, m]))
  const resueltas = desacuerdos.filter((d) => porId.has(d.id)).map((d) => porId.get(d.id)!)
  const sinResolver = desacuerdos.filter((d) => !porId.has(d.id))

  console.log(`Resueltos a mano: ${resueltas.length} · aún sin resolver: ${sinResolver.length}`)
  for (const s of sinResolver) console.log(`  ⏳ ${s.id.slice(0, 8)} — decide y añádelo a persona-manual.json`)

  if (!APLICAR) {
    console.log('\n(simulacro — relanza con --apply para escribir)')
    return
  }

  const upd = db.prepare('UPDATE phrases SET persona = ? WHERE id = ?')
  const aEscribir = [
    ...acuerdos,
    ...resueltas.map((r) => ({ id: r.id, persona: r.persona })),
  ]
  db.transaction((items: typeof aEscribir) => {
    for (const i of items) upd.run(i.persona, i.id)
  })(aEscribir)
  console.log(`\nEscritas ${aEscribir.length} (${acuerdos.length} por acuerdo + ${resueltas.length} a mano).`)

  const resumen = db.prepare(
    `SELECT persona, COUNT(*) n FROM phrases WHERE archived = 0 GROUP BY persona`
  ).all() as { persona: string | null; n: number }[]
  console.log('\nEscrito. Reparto de las activas:')
  for (const r of resumen) console.log(`  ${r.persona ?? 'SIN DATO'}: ${r.n}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
