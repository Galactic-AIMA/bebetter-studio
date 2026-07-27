/**
 * Reescribe la columna `tema` de la cola de carruseles con el TITULAR del
 * carrusel (el texto de su portada).
 *
 * Por qué: al encolar se guardaba el `tema` tal cual, que suele ser el material
 * fuente entero (el resumen de un video, un capítulo…). Eso es lo que se ve en
 * la cola de la app, en el agente de Telegram y en el aviso de publicación —
 * salía un párrafo recortado a mitad de frase. Desde el commit 0f08ed9 se
 * guarda el titular, pero las filas ya escritas siguen con el texto viejo.
 *
 * Solo toca la columna `tema` de las filas cuyo carrusel siga en la DB local.
 *
 * Uso (desde donde sea):
 *     npx tsx server/scripts/fix-carousel-queue-titles.ts            # dry-run
 *     npx tsx server/scripts/fix-carousel-queue-titles.ts --apply
 */

import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(__dirname, '../.env') })
dotenv.config({ path: path.join(__dirname, '../../.env') })

// Las rutas OAuth de driveService son relativas al cwd (./credentials/...)
process.chdir(path.join(__dirname, '..'))

const APPLY = process.argv.includes('--apply')

// La columna `tema` es la 3ª de CAROUSEL_QUEUE_COLUMNS (id, carouselId, tema…)
const COL_TEMA = 'C'

async function main() {
  // Imports dinámicos: src/config lee process.env al cargarse y los imports
  // estáticos se evalúan antes que el dotenv de arriba.
  const { google } = await import('googleapis')
  const { getAuthenticatedClient } = await import('../src/services/driveService')
  const { readCarouselQueueRows, CAROUSEL_SHEET } = await import('../src/services/sheetsService')
  const db = (await import('../src/db')).default

  const spreadsheetId = process.env.GOOGLE_SHEET_ID
  if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID no está configurado en server/.env')

  const rows = await readCarouselQueueRows()
  console.log(`Cola de carruseles: ${rows.length} fila(s)\n`)

  const cambios: { fila: number; antes: string; despues: string }[] = []

  rows.forEach((r, i) => {
    const fila = i + 2 // fila 1 = encabezado
    const carousel = db
      .prepare(`SELECT slides_json FROM carousels WHERE id = ?`)
      .get(r.carouselId) as { slides_json?: string } | undefined

    if (!carousel) {
      console.log(`  fila ${fila}: el carrusel ${r.carouselId?.slice(0, 8)} ya no está en la DB — se deja como está`)
      return
    }

    let titulo = ''
    try {
      const slides = JSON.parse(carousel.slides_json || '[]') as { rol: string; texto: string }[]
      const portada = slides.find((s) => s.rol === 'portada') ?? slides[0]
      titulo = (portada?.texto ?? '').replace(/\s+/g, ' ').trim()
    } catch {
      /* slides_json corrupto: no tocamos la fila */
    }

    if (!titulo) {
      console.log(`  fila ${fila}: sin portada con texto — se deja como está`)
      return
    }
    if (titulo === r.tema) {
      console.log(`  fila ${fila}: ya tiene el titular ✓`)
      return
    }
    cambios.push({ fila, antes: r.tema, despues: titulo })
  })

  if (!cambios.length) {
    console.log('\nNada que corregir.')
    return
  }

  console.log(`\n${cambios.length} fila(s) a corregir:`)
  for (const c of cambios) {
    console.log(`  fila ${c.fila}:`)
    console.log(`    antes:   "${c.antes.slice(0, 90)}${c.antes.length > 90 ? '…' : ''}"`)
    console.log(`    después: "${c.despues}"`)
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — no se escribió nada. Para aplicar: npx tsx server/scripts/fix-carousel-queue-titles.ts --apply')
    return
  }

  const sheets = google.sheets({ version: 'v4', auth: getAuthenticatedClient() })
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: cambios.map((c) => ({
        range: `${CAROUSEL_SHEET}!${COL_TEMA}${c.fila}`,
        values: [[c.despues]],
      })),
    },
  })
  console.log(`\n✓ ${cambios.length} fila(s) actualizada(s) en la pestaña ${CAROUSEL_SHEET}.`)
}

main().catch((err) => {
  console.error('FALLO:', err.message)
  process.exit(1)
})
