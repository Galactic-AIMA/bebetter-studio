import { Router } from 'express'
import { readCadenceConfig, writeCadenceConfig, readQueueRows } from '../services/sheetsService'
import { projectSchedule } from '../utils/schedule'
import { logInfo, logError } from '../services/logService'

const router = Router()

// Franja diurna permitida (nunca de madrugada) y máximo de publicaciones/día.
const MIN_HOUR = 6
const MAX_HOUR = 22
const MAX_SLOTS = 6

/**
 * Valida y normaliza una lista de horas de cadencia.
 * Reglas: solo horas EN PUNTO ("HH:00"), dentro de la franja diurna, únicas,
 * 1..MAX_SLOTS, ordenadas ascendentemente. Devuelve las horas normalizadas o lanza.
 */
function normalizeTimes(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Envía al menos una hora')
  }
  if (input.length > MAX_SLOTS) {
    throw new Error(`Máximo ${MAX_SLOTS} publicaciones por día`)
  }
  const hours = new Set<number>()
  for (const raw of input) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw).trim())
    if (!m) throw new Error(`Hora inválida: "${raw}" (usa formato HH:MM)`)
    const h = Number(m[1])
    const min = Number(m[2])
    if (min !== 0) throw new Error(`Solo horas en punto: "${raw}" (los minutos deben ser :00)`)
    if (h < MIN_HOUR || h > MAX_HOUR) {
      throw new Error(`"${raw}" fuera de la franja diurna (${MIN_HOUR}:00–${MAX_HOUR}:00)`)
    }
    hours.add(h)
  }
  return [...hours].sort((a, b) => a - b).map((h) => String(h).padStart(2, '0') + ':00')
}

// GET /api/cadence — lee la cadencia actual desde el Sheet
router.get('/', async (_req, res) => {
  try {
    const cfg = await readCadenceConfig()
    res.json(cfg)
  } catch (err: any) {
    logError('system', 'Leer cadencia falló', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/cadence/schedule — proyecta cuándo se publicará cada aprobado de la
// cola, según la cadencia guardada (el Sheet no guarda esa hora; se calcula).
router.get('/schedule', async (_req, res) => {
  try {
    const cfg = await readCadenceConfig()
    const rows = await readQueueRows()
    const approved = rows
      .filter(
        (r) => String(r.status || '').trim() === 'approved' && !String(r.publishedAt || '').trim()
      )
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    const items = projectSchedule(approved, cfg.times, cfg.timezone)
    res.json({ times: cfg.times, timezone: cfg.timezone, count: approved.length, items })
  } catch (err: any) {
    logError('system', 'Proyectar cola falló', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/cadence — persiste la cadencia (valida horas en punto + franja diurna)
router.post('/', async (req, res) => {
  try {
    const times = normalizeTimes(req.body?.times)
    await writeCadenceConfig(times)
    logInfo('system', `Cadencia actualizada: ${times.join(', ')}`)
    res.json({ success: true, times })
  } catch (err: any) {
    // Errores de validación → 400; fallos del Sheet → 500
    const isValidation = !/sheet|google|token|network/i.test(err.message)
    res.status(isValidation ? 400 : 500).json({ error: err.message })
  }
})

export default router
