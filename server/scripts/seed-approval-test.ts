import { randomUUID } from 'crypto'
import { appendQueueRows, QueueRow } from '../src/services/sheetsService'
import { sendToApprovalWebhook } from '../src/services/webhookService'
import { config } from '../src/config'

/**
 * Prueba e2e de la Etapa 3 (aprobación + edición de caption): inserta una fila `pending`
 * con un video real ya existente en R2 y dispara el paquete de aprobación a Telegram
 * (video + caption + botones ✅/❌). El workflow [Aprob] guarda el telegramMsgId en la fila.
 * Luego puedes: (a) responder al mensaje del caption para editarlo (3b), o (b) tocar ✅/❌ (3a).
 * Verifica con: npx tsx scripts/peek-queue.ts
 */
async function main() {
  const key = 'videos/La última libertad humana es elegir tu actitud frente a las circunstancias inevitables.mp4'
  const videoUrl = `${config.aws.publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`
  const phrase = 'La última libertad humana es elegir tu actitud frente a las circunstancias inevitables.'
  const captionIG =
    'La última libertad humana es elegir tu actitud frente a las circunstancias inevitables.\n\n@bebetter.path ⚔️\n\n#bebetter #disciplina #estoicismo #mentalidad'

  const queueId = randomUUID()
  const row: QueueRow = {
    id: queueId,
    videoUrl,
    phrase,
    captionIG,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  console.log('Insertando fila de prueba...  queueId =', queueId)
  await appendQueueRows([row])

  console.log('Disparando webhook de aprobación...')
  await sendToApprovalWebhook({ queueId, videoUrl, phrase, captionIG })
  console.log('\nListo. Revisa Telegram (video + mensaje con ✅/❌).')
  console.log('  · 3b: RESPONDE al mensaje del caption con un texto nuevo → debe cambiar captionIG.')
  console.log('  · 3a: TOCA ✅/❌ → debe cambiar status.')
  console.log('Verifica con:  npx tsx scripts/peek-queue.ts   (queueId:', queueId + ')')
}

main().catch((e) => {
  console.error(e?.response?.data || e)
  process.exit(1)
})
