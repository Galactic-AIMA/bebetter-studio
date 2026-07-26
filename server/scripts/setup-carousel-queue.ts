/**
 * Añade la pestaña "ColaCarruseles" al Sheet existente ("Cola bebetter") y
 * siembra la cadencia de carruseles en la pestaña `config`.
 *
 * Los carruseles NO comparten cola con los videos: llevan N imágenes (no una
 * URL) y su cadencia es semanal (días + horas) en vez de diaria, así el
 * scheduler de videos `[Sched]` queda intacto.
 *
 * Idempotente: si la pestaña ya existe, no la recrea (solo reporta).
 *
 * Uso (desde beBetterStudio/):
 *     npx tsx server/scripts/setup-carousel-queue.ts
 */

import * as path from 'path'
import * as dotenv from 'dotenv'

// OJO: los imports se evalúan ANTES que el cuerpo del módulo, así que src/config
// ya corrió su propio dotenv.config() (basado en cwd) para cuando llegamos aquí.
// Por eso NO usamos `config.google.sheetId`: leemos process.env dentro de main(),
// cuando estos dotenv ya se aplicaron. Cargamos server/.env y, de respaldo, la raíz.
dotenv.config({ path: path.join(__dirname, '../.env') })
dotenv.config({ path: path.join(__dirname, '../../.env') })

// Las rutas OAuth de driveService son relativas al cwd (./credentials/...) y los
// archivos viven en server/. Nos plantamos ahí para poder correr el script desde
// cualquier directorio.
process.chdir(path.join(__dirname, '..'))

import { google } from 'googleapis'
import { getAuthenticatedClient } from '../src/services/driveService'
import { CAROUSEL_QUEUE_COLUMNS, CAROUSEL_SHEET } from '../src/services/sheetsService'

// Cadencia por defecto: martes y viernes a las 19:00 (2 carruseles/semana).
const DEFAULT_DAYS = '2,5'
const DEFAULT_TIMES = '19:00'

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID
  if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID no está configurado en server/.env')

  const auth = getAuthenticatedClient()
  const sheets = google.sheets({ version: 'v4', auth })

  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const titles = (meta.data.sheets || []).map((s) => s.properties?.title)
  console.log('Pestañas actuales:', titles.join(', '))

  let gid: number | null | undefined

  if (titles.includes(CAROUSEL_SHEET)) {
    gid = (meta.data.sheets || []).find((s) => s.properties?.title === CAROUSEL_SHEET)?.properties?.sheetId
    console.log(`\n✓ La pestaña "${CAROUSEL_SHEET}" ya existe — no se recrea.`)

    // Sincroniza el encabezado si el código añadió columnas nuevas (p. ej. altTexts)
    const head = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${CAROUSEL_SHEET}!1:1`,
    })
    const actuales = (head.data.values?.[0] || []).map((c) => String(c).trim())
    const esperadas = CAROUSEL_QUEUE_COLUMNS as string[]
    if (actuales.join('|') !== esperadas.join('|')) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${CAROUSEL_SHEET}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [esperadas] },
      })
      const nuevas = esperadas.filter((c) => !actuales.includes(c))
      console.log(`  ↻ Encabezado actualizado${nuevas.length ? ` (columnas nuevas: ${nuevas.join(', ')})` : ''}`)
      if (actuales.length && nuevas.length) {
        console.log('  ⚠ Las filas ya existentes quedan sin valor en las columnas nuevas (es correcto).')
      }
    }
  } else {
    const added = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: CAROUSEL_SHEET, gridProperties: { frozenRowCount: 1 } },
            },
          },
        ],
      },
    })
    gid = added.data.replies?.[0]?.addSheet?.properties?.sheetId
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${CAROUSEL_SHEET}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [CAROUSEL_QUEUE_COLUMNS as string[]] },
    })
    console.log(`\n✓ Pestaña "${CAROUSEL_SHEET}" creada con encabezados:`)
    console.log('   ', CAROUSEL_QUEUE_COLUMNS.join(' | '))
  }

  // Cadencia de carruseles en `config` (solo si no existe ya)
  const cfg = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'config!A:B' })
  const keys = new Set((cfg.data.values || []).map((r) => String(r[0] ?? '').trim()))
  const faltan: string[][] = []
  if (!keys.has('carousel_cadence_days')) faltan.push(['carousel_cadence_days', DEFAULT_DAYS])
  if (!keys.has('carousel_cadence_times')) faltan.push(['carousel_cadence_times', DEFAULT_TIMES])

  if (faltan.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'config!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: faltan },
    })
    console.log('\n✓ Cadencia de carruseles sembrada en `config`:')
    faltan.forEach(([k, v]) => console.log(`    ${k} = ${v}`))
    console.log('    (2 = martes, 5 = viernes; 1=lunes … 7=domingo)')
  } else {
    console.log('\n✓ La cadencia de carruseles ya estaba en `config`.')
  }

  console.log('\nListo. Sheet:', meta.data.spreadsheetUrl)
  console.log('\n─────────────────────────────────────────────────')
  console.log(`GID de "${CAROUSEL_SHEET}": ${gid}`)
  console.log('\nSiguiente paso — crear el scheduler en n8n:')
  console.log(`    python server/scripts/add-carousel-scheduler.py --cola-gid ${gid}          # dry-run`)
  console.log(`    python server/scripts/add-carousel-scheduler.py --cola-gid ${gid} --apply  # aplica`)
  console.log('─────────────────────────────────────────────────')
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
