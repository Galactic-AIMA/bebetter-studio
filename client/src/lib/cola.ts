import { UpcomingItem } from '../api'

/** Etiqueta legible del día proyectado: "Hoy" / "Mañana" / "Vie 8". */
export function dayLabel(item: UpcomingItem, tz: string): string {
  if (item.dayOffset === 0) return 'Hoy'
  if (item.dayOffset === 1) return 'Mañana'
  if (!item.etaIso) return ''
  const d = new Date(item.etaIso)
  const s = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', timeZone: tz })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
