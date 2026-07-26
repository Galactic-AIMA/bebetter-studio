import { QueueRow } from '../services/sheetsService'

/**
 * Proyección de "próximas publicaciones" (Fase 4).
 *
 * El `[Sched]` de n8n no guarda una hora futura por video: en cada franja de
 * cadencia publica el `approved` MÁS ANTIGUO (orden por `createdAt`). Por eso la
 * hora de cada aprobado no es un dato del Sheet — emerge de su posición en la
 * cola + las horas de cadencia. Aquí la calculamos: `approved[i]` sale en la
 * i-ésima franja disponible a partir de ahora.
 *
 * Misma lógica de selección que `server/scripts/test-scheduler-pick.ts`.
 */

export interface UpcomingItem {
  id: string
  phrase: string
  thumbnailUrl?: string
  createdAt: string
  /** ISO absoluto de la publicación proyectada (ausente si no hay cadencia). */
  etaIso?: string
  /** 0 = hoy, 1 = mañana, … (en la zona horaria de la cadencia). */
  dayOffset?: number
  /** Hora en punto de la franja, "HH:00". */
  time?: string
}

/**
 * Offset (minutos a SUMAR a UTC para obtener la hora de pared de `tz`) para la
 * fecha dada. Colombia no tiene DST, así que es constante; para otras zonas es
 * el offset vigente en `date` (error despreciable en los bordes de DST).
 */
function tzOffsetMinutes(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return Math.round((asUTC - date.getTime()) / 60000)
}

/**
 * Empareja los aprobados (ya ordenados por `createdAt` asc) con las próximas
 * franjas de cadencia. Devuelve un item por aprobado; si no hay cadencia,
 * los items salen sin `etaIso`.
 */
export function projectSchedule(
  approved: QueueRow[],
  times: string[],
  timezone: string,
  now: Date = new Date()
): UpcomingItem[] {
  const base = approved.map((r) => ({
    id: r.id,
    phrase: r.phrase,
    thumbnailUrl: r.thumbnailUrl || undefined,
    createdAt: r.createdAt,
  }))

  const hours = times
    .map((t) => Number(String(t).split(':')[0]))
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
    .sort((a, b) => a - b)

  if (hours.length === 0 || base.length === 0) return base

  const tz = timezone || 'America/Bogota'
  const off = tzOffsetMinutes(tz, now)
  // "now" en hora de pared: sumando el offset, los getUTC* dan la hora local.
  const wall = new Date(now.getTime() + off * 60000)
  const Y = wall.getUTCFullYear()
  const Mo = wall.getUTCMonth()
  const D = wall.getUTCDate()
  const curHour = wall.getUTCHours()
  const curMin = wall.getUTCMinutes()

  const slots: { dayOffset: number; hour: number; etaMs: number }[] = []
  for (let day = 0; slots.length < base.length && day < 90; day++) {
    for (const h of hours) {
      // Hoy: descarta las franjas ya pasadas (el cron dispara en punto).
      if (day === 0 && (h < curHour || (h === curHour && curMin > 0))) continue
      const etaMs = Date.UTC(Y, Mo, D + day, h, 0, 0) - off * 60000
      slots.push({ dayOffset: day, hour: h, etaMs })
      if (slots.length >= base.length) break
    }
  }

  return base.map((item, i) => {
    const s = slots[i]
    if (!s) return item
    return {
      ...item,
      etaIso: new Date(s.etaMs).toISOString(),
      dayOffset: s.dayOffset,
      time: String(s.hour).padStart(2, '0') + ':00',
    }
  })
}

/**
 * Próximas franjas de la cadencia de CARRUSELES (bloque 2).
 *
 * A diferencia de los videos (todos los días a ciertas horas), los carruseles
 * usan una cadencia semanal: días concretos + horas. Devuelve las `count`
 * próximas franjas a partir de `now`, en orden.
 *
 * @param days  días ISO de la semana (1=lunes … 7=domingo)
 * @param times horas en punto, p. ej. ['19:00']
 */
export function nextCarouselSlots(
  cadence: { days: number[]; times: string[]; timezone: string },
  count: number,
  now: Date = new Date()
): Date[] {
  const out: Date[] = []
  if (count <= 0) return out

  const days = [...new Set(cadence.days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b)
  const hours = cadence.times
    .map((t) => Number(String(t).split(':')[0]))
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
    .sort((a, b) => a - b)
  if (!days.length || !hours.length) return out

  const tz = cadence.timezone || 'America/Bogota'
  const off = tzOffsetMinutes(tz, now)
  const wall = new Date(now.getTime() + off * 60000)
  const Y = wall.getUTCFullYear()
  const Mo = wall.getUTCMonth()
  const D = wall.getUTCDate()
  const curHour = wall.getUTCHours()
  const curMin = wall.getUTCMinutes()

  // Recorre hasta un año por delante; se corta al llenar `count`.
  for (let day = 0; out.length < count && day < 366; day++) {
    const d = new Date(Date.UTC(Y, Mo, D + day))
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay() // 1=lunes … 7=domingo
    if (!days.includes(iso)) continue
    for (const h of hours) {
      // Hoy: descarta las franjas ya pasadas (el cron dispara en punto).
      if (day === 0 && (h < curHour || (h === curHour && curMin > 0))) continue
      out.push(new Date(Date.UTC(Y, Mo, D + day, h, 0, 0) - off * 60000))
      if (out.length >= count) break
    }
  }
  return out
}
