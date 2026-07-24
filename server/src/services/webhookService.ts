import axios from 'axios'
import { WebhookPayload } from '../types'
import { config } from '../config'

export async function sendToWebhook(
  payload: WebhookPayload,
  env: 'test' | 'prod' = 'test'
): Promise<void> {
  const url = env === 'prod' ? config.webhooks.prod : config.webhooks.test

  if (!url) throw new Error(`Webhook URL for '${env}' is not configured`)

  await axios.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      ...(config.webhooks.secret ? { 'x-galactic-auth': config.webhooks.secret } : {}),
    },
    timeout: 15000,
  })
}

export interface ApprovalPayload {
  queueId: string
  videoUrl: string
  thumbnailUrl?: string
  phrase: string
  captionIG: string
}

/** Notifica a n8n que hay un video listo para aprobación (manda el paquete a Telegram). */
export async function sendToApprovalWebhook(payload: ApprovalPayload): Promise<void> {
  const url = config.webhooks.approval
  if (!url) throw new Error('WEBHOOK_APPROVAL_URL no está configurado')

  await axios.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      ...(config.webhooks.secret ? { 'x-galactic-auth': config.webhooks.secret } : {}),
    },
    timeout: 15000,
  })
}
