/**
 * Fase 0.1 — ¿corta el servidor las líneas igual que el navegador?
 *
 * Dos modos, según haya o no una base medida en el navegador
 * (`wrap-baseline-navegador.json`, que genera `client/wrap-baseline.html`):
 *
 *   · CON base  → compara caso a caso y saca las diferencias. Es la verificación
 *                 acordada: las líneas del servidor deben salir idénticas.
 *   · SIN base  → mide el banco con el TTF y lo enfrenta a la ESTIMACIÓN vieja
 *                 (`length * fontSize * 0.55`), que es con lo que el servidor
 *                 cortaba cuando el cliente no mandaba líneas. Sirve para ver el
 *                 tamaño del fallo que esta fase cierra.
 *
 *   npx tsx scripts/comparar-wrap.ts [preset]
 */
import fs from 'fs'
import db from '../src/db'
import { measurerFor, wrapTextServer } from '../src/text/fontMeasure'
import { wrapWith } from '../src/text/wrap'
import { BASELINE_FILE, compararCasos, CasoWrap } from '../src/routes/devWrap'

const ANCHO = 1080

// Mismos valores que client/src/presets.ts. El editor arranca en 'bebetter'.
const PRESETS: Record<string, { font: string; fontSize: number; maxWidth: number }> = {
  bebetter:  { font: 'Inter-Bold',           fontSize: 42, maxWidth: 60 },
  serene:    { font: 'PlayfairDisplay-Bold', fontSize: 38, maxWidth: 65 },
  raw:       { font: 'RobotoCondensed-Bold', fontSize: 52, maxWidth: 75 },
  minimal:   { font: 'Lato-Regular',         fontSize: 32, maxWidth: 55 },
  cinematic: { font: 'Oswald-Bold',          fontSize: 56, maxWidth: 70 },
  bold:      { font: 'Inter-Bold',           fontSize: 64, maxWidth: 75 },
}

const presetKey = process.argv[2] || 'bebetter'
const preset = PRESETS[presetKey]
if (!preset) {
  console.error(`Preset desconocido: ${presetKey}. Opciones: ${Object.keys(PRESETS).join(', ')}`)
  process.exit(1)
}

// ── Modo 1: contra la base del navegador ───────────────────────────────────────
if (fs.existsSync(BASELINE_FILE)) {
  const base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')) as { generado: string; casos: CasoWrap[] }
  const { total, iguales, diffs } = compararCasos(base.casos)

  console.log(`Base del navegador: ${base.generado}`)
  console.log(`Casos: ${total} · idénticos: ${iguales} · diferencias: ${diffs.length}\n`)
  for (const d of diffs) {
    console.log(`── ${d.id}`)
    console.log(`   ${d.text}`)
    console.log(`   navegador: ${JSON.stringify(d.navegador)}`)
    console.log(`   servidor : ${JSON.stringify(d.servidor)}\n`)
  }
  process.exit(diffs.length === 0 ? 0 : 1)
}

// ── Modo 2: TTF real contra la estimación vieja ────────────────────────────────
console.log(`Sin base del navegador (${BASELINE_FILE}).`)
console.log(`Comparando la medición real contra la estimación vieja. Preset: ${presetKey}\n`)

interface Frase { id: string; text: string; usage_count: number }
const frases = db.prepare(
  `SELECT id, text, usage_count FROM phrases WHERE archived = 0 ORDER BY usage_count ASC, created_at DESC`
).all() as Frase[]

const { font, fontSize, maxWidth } = preset
const maxPx = (maxWidth / 100) * ANCHO
const medirReal = measurerFor(font, fontSize)
const medirViejo = (t: string) => t.length * fontSize * 0.55

let distintas = 0
let desbordes = 0
for (const f of frases) {
  const real = wrapTextServer({ text: f.text, font, fontSize, maxWidth, resolutionWidth: ANCHO })
  const viejo = wrapWith(medirViejo, { text: f.text, maxPx })
  if (real.length !== viejo.length || real.some((l, i) => l !== viejo[i])) {
    distintas++
    if (distintas <= 5) {
      console.log(`── ${f.id} (usos ${f.usage_count})`)
      console.log(`   real  : ${JSON.stringify(real)}`)
      console.log(`   viejo : ${JSON.stringify(viejo)}\n`)
    }
  }
  // Una línea que se pasa del ancho máximo es una palabra suelta más larga que
  // el hueco: no es un fallo del wrap, pero conviene saber cuántas hay.
  if (real.some((l) => l && medirReal(l) > maxPx)) desbordes++
}

console.log(`Frases activas          : ${frases.length}`)
console.log(`Cortan distinto         : ${distintas} (${((distintas / frases.length) * 100).toFixed(0)}%)`)
console.log(`Con alguna línea ancha  : ${desbordes}`)
console.log(`\nPara la verificación de verdad, abre client/wrap-baseline.html con el server levantado.`)
