import { google } from 'googleapis'
import { getAuthenticatedClient } from '../src/services/driveService'
import { config } from '../src/config'

/** Borra del Sheet la fila cuyo id == process.argv[2] (limpieza de filas de prueba). */
async function main() {
  const targetId = process.argv[2]
  if (!targetId) throw new Error('Uso: tsx scripts/clean-test-row.ts <queueId>')
  const auth = getAuthenticatedClient()
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = config.google.sheetId!

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Cola!A2:A' })
  const ids = (res.data.values || []).map((r) => r[0])
  const idx = ids.indexOf(targetId)
  if (idx === -1) {
    console.log('No se encontró la fila', targetId)
    return
  }
  const rowNumber = idx + 2 // +1 header, +1 base-1
  const COLA_GID = 1637724194
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId: COLA_GID, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
          },
        },
      ],
    },
  })
  console.log(`Fila ${rowNumber} (id=${targetId}) borrada.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
