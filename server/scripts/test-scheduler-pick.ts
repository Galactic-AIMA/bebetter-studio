import { randomUUID } from 'crypto'
import { google } from 'googleapis'
import { getAuthenticatedClient } from '../src/services/driveService'
import { appendQueueRows, QueueRow, QUEUE_COLUMNS } from '../src/services/sheetsService'
import { config } from '../src/config'

/**
 * Prueba SEGURA (sin publicar) de la Etapa 4: siembra una fila `approved` con un video real,
 * lee la cola y ejecuta la MISMA lógica de selección del nodo `🎯 Elegir aprobado`, e imprime
 * el payload que el scheduler enviaría a /videopublish. NO dispara ninguna publicación.
 * Usa --seed para insertar la fila de prueba; sin flag solo lee y selecciona.
 */
async function readCola(): Promise<QueueRow[]> {
  const auth = getAuthenticatedClient()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId!,
    range: 'Cola!A2:L',
  })
  return (res.data.values || []).map((r) => {
    const o: any = {}
    QUEUE_COLUMNS.forEach((c, i) => (o[c] = r[i] ?? ''))
    return o as QueueRow
  })
}

async function main() {
  if (process.argv.includes('--seed')) {
    const key = 'videos/La última libertad humana es elegir tu actitud frente a las circunstancias inevitables.mp4'
    const videoUrl = `${config.aws.publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`
    const queueId = randomUUID()
    const row: QueueRow = {
      id: queueId,
      videoUrl,
      phrase: 'La última libertad humana es elegir tu actitud frente a las circunstancias inevitables.',
      captionIG: '🧪 [TEST E4] Caption APROBADO — este es el texto que debe publicarse. #bebetter',
      ytMeta: JSON.stringify({
        title: '[TEST E4] La última libertad humana',
        description: 'Prueba Etapa 4.\n@bebetter.path ⚔️',
        tags: 'bebetter,test,estoicismo',
      }),
      status: 'approved',
      createdAt: new Date().toISOString(),
      telegramMsgId: '999',
    }
    await appendQueueRows([row])
    console.log('Sembrada fila APPROVED de prueba. queueId =', queueId)
  }

  const rows = await readCola()
  // === Misma lógica que el nodo `🎯 Elegir aprobado` ===
  const approved = rows.filter(
    (r) => String(r.status || '').trim() === 'approved' && !String(r.publishedAt || '').trim()
  )
  approved.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  const pick = approved[0]

  console.log(`\nFilas totales: ${rows.length} | approved sin publicar: ${approved.length}`)
  if (!pick) {
    console.log('→ Nada que publicar en esta franja (cola vacía de approved).')
    return
  }
  const payload = {
    videoUrl: pick.videoUrl,
    phrase: pick.phrase,
    filename: pick.phrase,
    createdAt: pick.createdAt,
    thumbnailUrl: pick.thumbnailUrl,
    captionIG: pick.captionIG,
    ytMeta: pick.ytMeta,
    queueId: pick.id,
    preApproved: true,
  }
  console.log('\n→ El scheduler publicaría (payload a /videopublish):')
  console.log(JSON.stringify(payload, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
