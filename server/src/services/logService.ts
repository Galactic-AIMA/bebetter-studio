import fs from 'fs'
import path from 'path'
import { config } from '../config'

export type LogLevel = 'info' | 'error'
export type LogCategory = 'generate' | 'drive' | 'publish' | 's3' | 'system' | 'carousel'

export interface LogEntry {
  id: number
  ts: string
  level: LogLevel
  category: LogCategory
  message: string
  detail?: string
}

const MAX = 500
const LOG_FILE = path.join(path.dirname(config.paths.db), 'logs.jsonl')

let buffer: LogEntry[] = []
let seq = 0

// Carga las últimas MAX entradas al arrancar y compacta el archivo si creció de más.
function load() {
  try {
    if (!fs.existsSync(LOG_FILE)) return
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean)
    const recent = lines.slice(-MAX)
    buffer = recent.map((l) => JSON.parse(l)).filter(Boolean)
    seq = buffer.length ? buffer[buffer.length - 1].id : 0
    if (lines.length > recent.length) {
      fs.writeFileSync(LOG_FILE, recent.join('\n') + '\n')
    }
  } catch {
    /* archivo corrupto o ilegible: empezamos limpio en memoria */
  }
}
load()

function write(level: LogLevel, category: LogCategory, message: string, detail?: string): LogEntry {
  const entry: LogEntry = {
    id: ++seq,
    ts: new Date().toISOString(),
    level,
    category,
    message,
    ...(detail ? { detail } : {}),
  }
  buffer.push(entry)
  if (buffer.length > MAX) buffer = buffer.slice(-MAX)
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n')
  } catch {
    /* si no se puede persistir, seguimos con el buffer en memoria */
  }
  const line = `[${category}] ${message}${detail ? ' — ' + detail : ''}`
  if (level === 'error') console.error(line)
  else console.log(line)
  return entry
}

export const logInfo = (category: LogCategory, message: string, detail?: string) =>
  write('info', category, message, detail)

export const logError = (category: LogCategory, message: string, detail?: string) =>
  write('error', category, message, detail)

export function getLogs(opts: { limit?: number; level?: LogLevel; category?: LogCategory } = {}): LogEntry[] {
  let items = buffer
  if (opts.level) items = items.filter((e) => e.level === opts.level)
  if (opts.category) items = items.filter((e) => e.category === opts.category)
  const limit = opts.limit ?? 200
  return items.slice(-limit).reverse() // más reciente primero
}

export function clearLogs() {
  buffer = []
  try {
    fs.writeFileSync(LOG_FILE, '')
  } catch {
    /* ignore */
  }
}
