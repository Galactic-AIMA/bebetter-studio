import { google } from 'googleapis'
import { getAuthenticatedClient } from '../src/services/driveService'
import { config } from '../src/config'
import { QUEUE_COLUMNS, QueueRow } from '../src/services/sheetsService'

/**
 * Helper de diagnóstico (Fase 4, Etapa 3a): lee la pestaña "Cola" y la imprime.
 * Con `--reping` reenvía el paquete de la última fila `pending` al webhook de aprobación
 * para poder probar los botones ✅/❌ sin regenerar un lote.
 */
async function main() {
  const auth = getAuthenticatedClient()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId!,
    range: 'Cola!A2:L',
  })
  const rows = (res.data.values || []).map((r) => {
    const o: any = {}
    QUEUE_COLUMNS.forEach((c, i) => (o[c] = r[i] ?? ''))
    return o as QueueRow
  })
  console.log(`Filas en la cola: ${rows.length}`)
  for (const r of rows) {
    console.log(`  [${r.status}] id=${r.id} | msgId=${r.telegramMsgId || '-'}`)
    console.log(`      phrase: "${(r.phrase || '').slice(0, 50)}"`)
    console.log(`      captionIG: "${(r.captionIG || '').slice(0, 70)}"`)
  }

  if (process.argv.includes('--reping')) {
    const pend = [...rows].reverse().find((r) => r.status === 'pending' && r.videoUrl)
    if (!pend) {
      console.log('\nNo hay fila `pending` con video para reenviar.')
      return
    }
    const url = process.env.WEBHOOK_APPROVAL_URL
    if (!url) throw new Error('WEBHOOK_APPROVAL_URL no configurado')
    console.log(`\nReenviando paquete de id=${pend.id} a ${url} ...`)
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-galactic-auth': process.env.WEBHOOK_SECRET || '',
      },
      body: JSON.stringify({
        queueId: pend.id,
        videoUrl: pend.videoUrl,
        thumbnailUrl: pend.thumbnailUrl,
        phrase: pend.phrase,
        captionIG: pend.captionIG || '',
      }),
    })
    console.log(`Respuesta webhook: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
