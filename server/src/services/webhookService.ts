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
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  })
}
