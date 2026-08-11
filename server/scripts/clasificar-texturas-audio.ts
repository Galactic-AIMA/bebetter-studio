/**
 * Puebla la columna `audio_tracks.textura` de las 12 pistas actuales y repara la
 * descripción corrupta de `1784786063829`.
 *
 * POR QUÉ A MANO: la textura la clasificó el asistente leyendo la instrumentación
 * que describe cada pista, no Gemini con una etiqueta. Motivo: en el etiquetado
 * original Gemini marcó `1784955140743` como "tenso" mientras su propia descripción
 * la llamaba "cálida […] optimismo, nuevos comienzos" — se contradijo dentro del
 * mismo JSON, y esa pista ya salió en 4 reels publicados.
 *
 * David valida oyéndolas en el panel 🎵 (botón ▶) y corrige lo que no cuadre; este
 * script solo deja el punto de partida.
 *
 *   npx tsx scripts/clasificar-texturas-audio.ts          # dry-run
 *   npx tsx scripts/clasificar-texturas-audio.ts --apply
 */
import db from '../src/db'
import { TEXTURE_CATEGORIES } from '../src/services/geminiService'

const APPLY = process.argv.includes('--apply')

/** clave corta (el nombre real es `reelsvideo.io_<clave>.mp3`) → textura */
const TEXTURAS: Record<string, string> = {
  // acústico — guitarra o instrumento real, cercanía
  '1784955048226': 'acustico',   // guitarra pausada, íntima, nostálgica
  '1784786063829': 'acustico',   // guitarra acústica cálida, ritmo suave
  '1785739985940': 'acustico',   // guitarra acústica + percusión sutil
  // etéreo — sintes lentos, arpegios, pads, eco espacial
  '1784785920630': 'etereo',     // etérea minimalista, acordes suspendidos
  '1784955239607': 'etereo',     // arpegios sintetizados, eco espacial
  '1784786192781': 'etereo',     // atmosférico cálido, sintes flotantes
  '1784955140743': 'etereo',     // ⚠️ estaba como "tenso"; es cálida, sintes + cuerdas
  // pulsante — latido rítmico marcado, hipnótico
  '1785202296567': 'pulsante',   // sinte analógico, pulso sci-fi retro
  '1784955082601': 'pulsante',   // sintes pulsantes, latido constante
  // orquestal — metales, cuerdas, fanfarria
  '1784785841026': 'orquestal',  // oscura dramática, vientos de metal pesados
  '1784954982677': 'orquestal',  // melodía ascendente, vientos + sintes
  '1784954942287': 'orquestal',  // fanfarria orquestal, metales, triunfo
}

/**
 * La descripción guardada tiene las tildes rotas y rellenas con miles de espacios
 * (mismo tipo de corrupción de encoding que hubo en el banco de frases). Se reescribe
 * con el mismo contenido, ya legible.
 */
const DESCRIPCION_REPARADA: Record<string, string> = {
  '1784786063829':
    'Una melodía cálida de guitarra acústica con un ritmo suave y constante que transmite paz, cercanía e inspiración.',
}

const key = (filename: string) => filename.replace('reelsvideo.io_', '').replace('.mp3', '')

const rows = db.prepare(
  `SELECT filename, energia, mood_category, textura, descripcion FROM audio_tracks`
).all() as { filename: string; energia: number | null; mood_category: string | null; textura: string | null; descripcion: string | null }[]

console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN'} — ${rows.length} pistas en la DB\n`)

const faltan = rows.filter((r) => !(key(r.filename) in TEXTURAS))
if (faltan.length) {
  console.log(`⚠️  ${faltan.length} pista(s) sin textura definida en este script (se dejan intactas):`)
  for (const r of faltan) console.log(`     ${r.filename}`)
  console.log('   Etiquétalas en el panel 🎵 o añádelas aquí.\n')
}

// Salvaguarda: un slug mal escrito dejaría la pista fuera de toda rotación.
for (const [k, tex] of Object.entries(TEXTURAS)) {
  if (!TEXTURE_CATEGORIES.includes(tex as any)) {
    console.error(`❌ textura inválida para ${k}: "${tex}". Abortado.`)
    process.exit(1)
  }
}

const upd = db.prepare(`UPDATE audio_tracks SET textura = ? WHERE filename = ?`)
const updDesc = db.prepare(`UPDATE audio_tracks SET descripcion = ? WHERE filename = ?`)

let cambios = 0
const aplicar = db.transaction(() => {
  for (const r of rows) {
    const k = key(r.filename)
    const tex = TEXTURAS[k]
    if (!tex) continue
    const marca = r.textura === tex ? '=' : r.textura ? '~' : '+'
    if (marca !== '=') cambios++
    const nota = r.mood_category && r.mood_category !== tex ? `  (mood: ${r.mood_category})` : ''
    console.log(` ${marca} ${k}  e${r.energia}  → ${tex}${nota}`)
    if (APPLY) upd.run(tex, r.filename)

    const desc = DESCRIPCION_REPARADA[k]
    if (desc && r.descripcion !== desc) {
      console.log(`     ↳ descripción reparada (tenía ${r.descripcion?.length ?? 0} caracteres corruptos)`)
      if (APPLY) updDesc.run(desc, r.filename)
    }
  }
})
aplicar()

console.log(`\n${cambios} pista(s) con textura nueva o distinta.`)

if (APPLY) {
  const resumen = db.prepare(
    `SELECT COALESCE(textura,'(sin textura)') AS textura, COUNT(*) AS pistas,
            GROUP_CONCAT('e' || energia, ' ') AS energias
     FROM audio_tracks GROUP BY textura ORDER BY pistas DESC`
  ).all()
  console.log('\nVERIFICACIÓN — reparto final:')
  console.table(resumen)
  const sin = db.prepare(`SELECT COUNT(*) c FROM audio_tracks WHERE textura IS NULL`).get() as { c: number }
  console.log(sin.c === 0 ? '✅ todas las pistas tienen textura' : `⚠️ quedan ${sin.c} sin textura`)
} else {
  console.log('Nada escrito. Repite con --apply para aplicarlo.')
}
