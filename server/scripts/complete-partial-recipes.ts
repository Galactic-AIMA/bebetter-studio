/**
 * Completa la receta de las publicaciones `partial`: las anteriores al historial,
 * de las que se recuperó la frase pero no la pieza.
 *
 * Lo que se puede recuperar y lo que no:
 *  - **Frase** → ya está (se leyó de la miniatura en el backfill).
 *  - **Imagen de fondo** → SÍ: se reconoce comparando la miniatura contra el
 *    banco vectorizado. Es lo que hace este script.
 *  - **Estilo, fuente, efecto, audio** → NO. No están en ninguna parte y
 *    deducirlos "a ojo" de la miniatura sería inventar datos que luego se
 *    analizarían como si fueran reales. Se quedan vacíos a propósito.
 *
 * Por eso estas publicaciones siguen marcadas como `partial` aunque se les
 * identifique la imagen: la receta sigue incompleta, solo que menos.
 *
 * Uso:
 *   npx tsx server/scripts/complete-partial-recipes.ts           # dry-run
 *   npx tsx server/scripts/complete-partial-recipes.ts --apply
 *   npx tsx server/scripts/complete-partial-recipes.ts --all     # incluye las ya identificadas
 */
import path from 'path'
import os from 'os'
import fs from 'fs'
import dotenv from 'dotenv'

const APPLY = process.argv.includes('--apply')
const ALL = process.argv.includes('--all')

async function main() {
  process.chdir(path.join(__dirname, '..'))
  dotenv.config()

  const db = (await import('../src/db')).default
  const axios = (await import('axios')).default
  const { analyzeImageStructured, embedText } = await import('../src/services/geminiService')
  const { cosine } = await import('../src/utils/matching')
  const { fetchPublishedMedia } = await import('../src/services/instagramService')
  const { identifyBackgroundImage, saveImageMatch, IMAGE_MATCH_MIN } = await import(
    '../src/services/publicationsService'
  )

  const pendientes = db
    .prepare(
      `SELECT media_id, permalink, published_at FROM v_publication_recipe
       WHERE has_image = 0 ${ALL ? "OR image_filename IS NOT NULL" : ''}
       ORDER BY published_at DESC`
    )
    .all() as { media_id: string; permalink: string | null; published_at: string }[]

  console.log(`\n${APPLY ? 'APPLY' : 'DRY-RUN'} — completar recetas parciales`)
  console.log(`   ${pendientes.length} publicaciones a procesar (umbral de identificación ${IMAGE_MATCH_MIN})\n`)
  if (!pendientes.length) return

  const media = await fetchPublishedMedia(200)
  const thumbs = new Map(media.map((m) => [m.id, m.thumbnailUrl]))

  // Analiza la miniatura con el MISMO pipeline del banco, para que los vectores
  // sean comparables (si no, se compararían dos representaciones distintas).
  const analizar = async (url: string): Promise<Float32Array> => {
    const buf = Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 60_000 })).data)
    const tmp = path.join(os.tmpdir(), `bb_thumb_${Date.now()}.jpg`)
    fs.writeFileSync(tmp, buf)
    try {
      const a: any = await analyzeImageStructured(tmp)
      const doc = [...(a.elementos ?? []), ...(a.temas ?? [])].join(', ')
      return await embedText(doc)
    } finally {
      fs.existsSync(tmp) && fs.unlinkSync(tmp)
    }
  }

  let identificadas = 0
  let sin = 0

  for (const p of pendientes) {
    const url = thumbs.get(p.media_id)
    if (!url) {
      console.log(`   ${p.published_at.slice(0, 10)}  sin miniatura disponible`)
      sin++
      continue
    }
    try {
      const m = await identifyBackgroundImage(p.media_id, url, analizar, cosine)
      console.log(`   ${p.published_at.slice(0, 10)}  ${m.filename ? '✔' : '·'} ${m.reason}`)
      if (m.filename) {
        identificadas++
        if (APPLY) saveImageMatch(m)
      } else {
        sin++
      }
    } catch (err: any) {
      console.log(`   ${p.published_at.slice(0, 10)}  ✕ ${err.message}`)
      sin++
    }
  }

  console.log(`\n   identificadas: ${identificadas} · sin identificar: ${sin}`)
  console.log(
    APPLY
      ? '\n💾 Guardado. Siguen marcadas como `partial`: se recuperó la imagen, no el estilo ni el audio.'
      : '\n(dry-run — nada escrito. Añade --apply.)'
  )
}

main().catch((err) => {
  console.error('\n❌', err.message)
  process.exit(1)
})
