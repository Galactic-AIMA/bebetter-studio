/**
 * Crea el Google Sheet "Cola bebetter" con la estructura de la Fase 4.
 * Ejecutar UNA vez: npx ts-node scripts/setup-queue-sheet.ts
 *
 * Requisito previo: haber corrido authorize-drive.ts CON el scope de Sheets
 * (si el token no tiene `spreadsheets`, Google devuelve 403 insufficient scopes).
 *
 * Al terminar, imprime el GOOGLE_SHEET_ID para pegar en server/.env
 */

import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(__dirname, '../.env') })

import { google } from 'googleapis'
import { getAuthenticatedClient } from '../src/services/driveService'
import { QUEUE_COLUMNS } from '../src/services/sheetsService'

async function main() {
  const auth = getAuthenticatedClient()
  const sheets = google.sheets({ version: 'v4', auth })

  // Crear el spreadsheet con dos pestañas: "Cola" (encabezado congelado) y "config"
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: 'Cola bebetter' },
      sheets: [
        { properties: { title: 'Cola', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'config' } },
      ],
    },
  })

  const spreadsheetId = created.data.spreadsheetId!
  const url = created.data.spreadsheetUrl

  // Encabezados de la Cola + cadencia por defecto (7am/1pm/7pm, hora Colombia)
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: 'Cola!A1', values: [QUEUE_COLUMNS as string[]] },
        {
          range: 'config!A1',
          values: [
            ['key', 'value'],
            ['cadence_times', '07:00,13:00,19:00'],
            ['timezone', 'America/Bogota'],
          ],
        },
      ],
    },
  })

  console.log('\n─────────────────────────────────────────────────')
  console.log('✓ Sheet "Cola bebetter" creado')
  console.log('  URL:', url)
  console.log('\nAgrega esta línea a server/.env :\n')
  console.log('  GOOGLE_SHEET_ID=' + spreadsheetId)
  console.log('\n─────────────────────────────────────────────────')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err.message)
  if (String(err.message).toLowerCase().includes('scope')) {
    console.error('\n→ Parece falta el scope de Sheets. Re-corre: npx ts-node scripts/authorize-drive.ts')
  }
  process.exit(1)
})
