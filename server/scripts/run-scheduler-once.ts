import { google } from 'googleapis'
import { getAuthenticatedClient } from '../src/services/driveService'
import { QUEUE_COLUMNS, QueueRow } from '../src/services/sheetsService'
import { config } from '../src/config'

/**
 * Ejecuta UNA vez la lógica del workflow [Sched] bebetter, on-demand (sin esperar al cron):
 * lee la cola, elige el `approved` más antiguo no publicado y dispara /videopublish con
 * preApproved (exactamente el mismo payload que el nodo `🚀 Publicar` del scheduler).
 * Sirve para probar el caso real end-to-end. ⚠️ Publica de verdad (YouTube privado + Reel IG).
 */
const PUBLISH_URL = 'https://n8n.galacticaima.com/webhook/videopublish'

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

  const approved = rows
    .filter((r) => String(r.status || '').trim() === 'approved' && !String(r.publishedAt || '').trim())
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  const pick = approved[0]
  if (!pick) {
    console.log('No hay `approved` sin publicar. Nada que hacer (como el scheduler con cola vacía).')
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
  console.log(`Publicando aprobado más antiguo: queueId=${pick.id}`)
  console.log(`  caption: "${(pick.captionIG || '').slice(0, 80)}"`)
  const r = await fetch(PUBLISH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.webhooks.secret ? { 'x-galactic-auth': config.webhooks.secret } : {}),
    },
    body: JSON.stringify(payload),
  })
  console.log(`Respuesta webhook: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
  console.log('\nEl publish corre async (YouTube + poll de IG ~20-160s). Verifica con:')
  console.log('  npx tsx scripts/peek-queue.ts   (queueId', pick.id, 'debe quedar `published`)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
