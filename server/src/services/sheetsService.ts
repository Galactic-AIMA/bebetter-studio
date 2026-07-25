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

/** Lee todas las filas de la pestaña "Cola" (sin el header). */
export async function readQueueRows(): Promise<QueueRow[]> {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${COLA_SHEET}!A2:L`,
  })
  return (res.data.values || []).map((r) => {
    const o: Record<string, string> = {}
    QUEUE_COLUMNS.forEach((c, i) => (o[c] = r[i] ?? ''))
    return o as unknown as QueueRow
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

/**
 * Upsert de pares key/value en la pestaña "config" (crea la fila si no existe,
 * actualiza la celda B si ya existe). Se usa para la cadencia y el token de IG.
 */
export async function upsertConfig(entries: Record<string, string>): Promise<void> {
  const keys = Object.keys(entries)
  if (keys.length === 0) return
  const sheets = getSheets()
  const id = requireSheetId()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${CONFIG_SHEET}!A:B`,
  })
  const rows = res.data.values || []
  const updates: { range: string; values: string[][] }[] = []
  const appends: string[][] = []
  for (const key of keys) {
    const value = entries[key]
    let rowIdx = -1
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i]?.[0] ?? '').trim() === key) {
        rowIdx = i
        break
      }
    }
    if (rowIdx >= 0) {
      // fila 1-based en la hoja (rowIdx es 0-based sobre A:B, header incluido)
      updates.push({ range: `${CONFIG_SHEET}!B${rowIdx + 1}`, values: [[value]] })
    } else {
      appends.push([key, value])
      rows.push([key, value]) // defensivo: evita doble append si dos keys nuevas iguales
    }
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: { valueInputOption: 'RAW', data: updates },
    })
  }
  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${CONFIG_SHEET}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends },
    })
  }
}

/** Persiste la cadencia (horas de publicación) en la pestaña "config". */
export async function writeCadenceConfig(times: string[], timezone?: string): Promise<void> {
  const entries: Record<string, string> = { cadence_times: times.join(',') }
  if (timezone) entries.timezone = timezone
  await upsertConfig(entries)
}
