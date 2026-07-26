/**
 * Verifica contra la Graph API qué se publicó de verdad en @bebetter.path y
 * contrasta con la cola de carruseles del Sheet. Solo LECTURA.
 *
 * Uso (desde donde sea):
 *     npx tsx server/scripts/check-ig-carousel.ts
 */

import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(__dirname, '../.env') })
dotenv.config({ path: path.join(__dirname, '../../.env') })
process.chdir(path.join(__dirname, '..'))

import axios from 'axios'

const IG = 'https://graph.instagram.com/v21.0'
const UID = process.env.IG_USER_ID || '17841425527150540'

async function main() {
  // Import DINÁMICO: src/config lee process.env al cargarse, y los imports
  // estáticos se evalúan antes que el dotenv de arriba → cargarlo aquí garantiza
  // que ya tenga GOOGLE_SHEET_ID.
  const { readConfigMap, readCarouselQueueRows } = await import('../src/services/sheetsService')

  const cfg = await readConfigMap()
  const token = cfg.get('ig_access_token')
  if (!token) throw new Error('No hay ig_access_token en la pestaña config del Sheet')

  const { data } = await axios.get(`${IG}/${UID}/media`, {
    params: {
      fields: 'id,media_type,permalink,timestamp,caption',
      limit: 3,
      access_token: token,
    },
  })

  console.log('=== Últimas publicaciones en @bebetter.path ===')
  for (const m of data.data) {
    console.log(`  ${m.timestamp}  ${String(m.media_type).padEnd(14)} ${m.permalink}`)
  }

  const m0 = data.data[0]
  if (m0) {
    console.log(`\n=== Más reciente (${m0.media_type}) ===`)
    console.log('  id       :', m0.id)
    console.log('  permalink:', m0.permalink)
    if (m0.media_type === 'CAROUSEL_ALBUM') {
      const ch = await axios.get(`${IG}/${m0.id}/children`, {
        params: { fields: 'id,media_type', access_token: token },
      })
      console.log(`  imágenes : ${ch.data.data.length}`)
    }
    console.log('  caption  :', String(m0.caption || '').split('\n')[0])
  }

  const rows = await readCarouselQueueRows()
  console.log(`\n=== ColaCarruseles (${rows.length} filas) ===`)
  for (const r of rows) {
    let alts: string[] = []
    try {
      alts = JSON.parse(r.altTexts || '[]')
    } catch {
      /* fila vieja sin la columna */
    }
    let urls: string[] = []
    try {
      urls = JSON.parse(r.imageUrls || '[]')
    } catch {
      /* ignora */
    }
    console.log(
      `  ${String(r.status).padEnd(10)} | ${r.tema.slice(0, 28).padEnd(28)} | ${urls.length} imgs | ${
        alts.filter(Boolean).length
      } alt texts`
    )
  }
}

main().catch((e) => {
  const g = e?.response?.data?.error
  console.error('Error:', g ? `${g.message}` : e.message)
  process.exit(1)
})
