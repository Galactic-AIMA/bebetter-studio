import { google } from 'googleapis'
import { getAuthenticatedClient } from './driveService'
import { config } from '../config'

/**
 * Servicio de la cola de publicación en Google Sheets (Fase 4).
 * Reutiliza el OAuth de Google de driveService (token con scope `spreadsheets`).
 * Fuente de verdad de la cola: la hoja "Cola bebetter" (id en GOOGLE_SHEET_ID).
 */

export type QueueStatus =
  | 'pending'        // enviado a aprobación, esperando decisión en Telegram
  | 'approved'       // aprobado, en cola para publicar en su franja
  | 'rejected'       // descartado por David
  | 'published'      // publicado OK
  | 'failed'         // falló la publicación (reintentando)
  | 'needs-attention' // falló tras los reintentos, requiere intervención

export interface QueueRow {
  id: string
  videoUrl: string
  thumbnailUrl?: string
  phrase: string
  captionIG?: string
  ytMeta?: string
  status: QueueStatus
  createdAt: string
  telegramMsgId?: string
  attempts?: number
  publishedAt?: string
  error?: string
}

/** Orden de columnas en la pestaña "Cola" — DEBE coincidir con setup-queue-sheet.ts */
export const QUEUE_COLUMNS: (keyof QueueRow)[] = [
  'id',
  'videoUrl',
  'thumbnailUrl',
  'phrase',
  'captionIG',
  'ytMeta',
  'status',
  'createdAt',
  'telegramMsgId',
  'attempts',
  'publishedAt',
  'error',
]

const COLA_SHEET = 'Cola'
const CONFIG_SHEET = 'config'

function getSheets() {
  const auth = getAuthenticatedClient()
  return google.sheets({ version: 'v4', auth })
}

function requireSheetId(): string {
  const id = config.google.sheetId
  if (!id) {
    throw new Error(
      'GOOGLE_SHEET_ID no configurado en .env. Corre: npx ts-node scripts/setup-queue-sheet.ts'
    )
  }
  return id
}

function rowToValues(row: QueueRow): (string | number)[] {
  return QUEUE_COLUMNS.map((c) => {
    const v = row[c]
    return v === undefined || v === null ? '' : (v as string | number)
  })
}

/** Agrega filas al final de la pestaña "Cola". */
export async function appendQueueRows(rows: QueueRow[]): Promise<void> {
  if (rows.length === 0) return
  const sheets = getSheets()
  await sheets.spreadsheets.values.append({
    spreadsheetId: requireSheetId(),
    range: `${COLA_SHEET}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows.map(rowToValues) },
  })
}

export interface CadenceConfig {
  times: string[] // franjas del día, p. ej. ['07:00','13:00','19:00']
  timezone: string
}

/** Lee la cadencia (horas de publicación) desde la pestaña "config" (key/value). */
export async function readCadenceConfig(): Promise<CadenceConfig> {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${CONFIG_SHEET}!A:B`,
  })
  const map = new Map<string, string>()
  for (const [k, v] of res.data.values || []) {
    if (k) map.set(String(k).trim(), String(v ?? '').trim())
  }
  return {
    times: (map.get('cadence_times') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    timezone: map.get('timezone') || 'America/Bogota',
  }
}
