import { X, Clock, Check, AlertCircle, CalendarClock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cadenceApi, ScheduleResult, UpcomingItem } from '../../api'

interface Props {
  onClose: () => void
}

// Franja diurna en la que se reparten las publicaciones (horas en punto).
const DAY_START = 7
const DAY_END = 19
const HOUR_OPTIONS = Array.from({ length: 22 - 6 + 1 }, (_, i) => 6 + i) // 6..22
const MAX_SLOTS = 6

/** Reparte N publicaciones en horas EN PUNTO dentro de la franja diurna. */
function suggest(n: number): string[] {
  if (n <= 1) return ['13:00']
  const step = (DAY_END - DAY_START) / (n - 1)
  const hours = Array.from({ length: n }, (_, i) => Math.round(DAY_START + i * step))
  const uniq = [...new Set(hours)].sort((a, b) => a - b)
  return uniq.map((h) => String(h).padStart(2, '0') + ':00')
}

const hhmm = (h: number) => String(h).padStart(2, '0') + ':00'
const hourOf = (t: string) => Number(t.split(':')[0])

/** Etiqueta legible del día proyectado: "Hoy" / "Mañana" / "Vie 8". */
function dayLabel(item: UpcomingItem, tz: string): string {
  if (item.dayOffset === 0) return 'Hoy'
  if (item.dayOffset === 1) return 'Mañana'
  if (!item.etaIso) return ''
  const d = new Date(item.etaIso)
  const s = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', timeZone: tz })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function CadenceModal({ onClose }: Props) {
  const [times, setTimes] = useState<string[]>([])
  const [timezone, setTimezone] = useState('America/Bogota')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null)
  const [loadingSchedule, setLoadingSchedule] = useState(true)

  const loadSchedule = () => {
    setLoadingSchedule(true)
    cadenceApi
      .schedule()
      .then(setSchedule)
      .catch(() => setSchedule(null))
      .finally(() => setLoadingSchedule(false))
  }

  useEffect(() => {
    cadenceApi
      .get()
      .then((cfg) => {
        setTimes(cfg.times.length ? cfg.times : suggest(3))
        setTimezone(cfg.timezone || 'America/Bogota')
      })
      .catch((e) => setError(e?.response?.data?.error || e.message))
      .finally(() => setLoading(false))
    loadSchedule()
  }, [])

  const applyCount = (n: number) => {
    setSaved(false)
    setError(null)
    setTimes(suggest(n))
  }

  const setSlot = (idx: number, hour: number) => {
    setSaved(false)
    setError(null)
    setTimes((prev) => prev.map((t, i) => (i === idx ? hhmm(hour) : t)))
  }

  const hasDupes = new Set(times.map(hourOf)).size !== times.length

  const handleSave = async () => {
    setError(null)
    if (hasDupes) {
      setError('Hay horas repetidas — cada franja debe ser distinta')
      return
    }
    setSaving(true)
    try {
      const ordered = [...times].sort((a, b) => hourOf(a) - hourOf(b))
      const res = await cadenceApi.save(ordered)
      setTimes(res.times)
      setSaved(true)
      loadSchedule() // la proyección depende de la cadencia recién guardada
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  // Descripción del ritmo (si el reparto es parejo)
  const sorted = [...times].map(hourOf).sort((a, b) => a - b)
  const gaps = sorted.slice(1).map((h, i) => h - sorted[i])
  const evenGap = gaps.length > 0 && gaps.every((g) => g === gaps[0]) ? gaps[0] : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-md bg-carbon-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-carbon-700 shrink-0">
          <Clock size={15} className="text-gold-500" />
          <h2 className="text-sm font-semibold tracking-wide text-bone-500">Cadencia de publicación</h2>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg bg-carbon-700/80 text-bone-700 hover:text-bone-500 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-5">
          {loading ? (
            <p className="text-bone-700 text-xs">Cargando…</p>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-bone-700">
                A estas horas (todos los días) se publica el aprobado más antiguo de la cola. La cola
                se drena en orden; si un slot no tiene nada aprobado, no pasa nada.
              </p>

              {/* Nº de publicaciones/día */}
              <div>
                <label className="block text-[11px] font-medium text-bone-500 mb-1.5">
                  Publicaciones al día
                </label>
                <div className="flex items-center rounded-lg overflow-hidden border border-carbon-600 text-xs w-max">
                  {Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => applyCount(n)}
                      className={`px-3 py-1.5 transition-colors ${
                        times.length === n
                          ? 'bg-carbon-600 text-gold-500 font-medium'
                          : 'bg-carbon-800 text-bone-700 hover:text-bone-500'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-bone-700 mt-1">
                  Sugerencia repartida en la franja {hhmm(DAY_START)}–{hhmm(DAY_END)}. Puedes ajustar cada hora.
                </p>
              </div>

              {/* Horas (veto) */}
              <div>
                <label className="block text-[11px] font-medium text-bone-500 mb-1.5">Horas</label>
                <div className="flex flex-wrap gap-2">
                  {times.map((t, idx) => (
                    <select
                      key={idx}
                      value={hourOf(t)}
                      onChange={(e) => setSlot(idx, Number(e.target.value))}
                      className="bg-carbon-900 border border-carbon-600 rounded-lg px-2.5 py-1.5 text-xs text-bone-500 tabular-nums focus:border-gold-500 outline-none"
                    >
                      {HOUR_OPTIONS.map((h) => (
                        <option key={h} value={h}>
                          {hhmm(h)}
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
              </div>

              {/* Resumen */}
              <div className="text-[11px] text-bone-700 bg-carbon-900/60 rounded-lg px-3 py-2 border border-carbon-700">
                {sorted.map(hhmm).join(' · ')}
                {evenGap && <span className="text-bone-500"> — ~cada {evenGap}h</span>}
                <span className="block text-[10px] mt-0.5 text-bone-700/80">{timezone}</span>
              </div>

              {/* Próximas publicaciones (proyección de la cola de aprobados) */}
              <div className="border-t border-carbon-700 pt-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <CalendarClock size={13} className="text-gold-500" />
                  <label className="text-[11px] font-medium text-bone-500">Próximas publicaciones</label>
                  {schedule && schedule.count > 0 && (
                    <span className="text-[10px] text-bone-700">({schedule.count} en cola)</span>
                  )}
                </div>
                {loadingSchedule ? (
                  <p className="text-[11px] text-bone-700">Calculando…</p>
                ) : !schedule || schedule.count === 0 ? (
                  <p className="text-[11px] text-bone-700">
                    No hay videos aprobados en la cola. Los que apruebes por Telegram aparecerán aquí
                    con su hora estimada.
                  </p>
                ) : schedule.times.length === 0 ? (
                  <p className="text-[11px] text-neon-red">
                    Hay {schedule.count} aprobado(s) pero no hay cadencia configurada — no se
                    publicarán hasta definir horas arriba.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {schedule.items.map((it, i) => (
                      <li
                        key={it.id}
                        className="flex items-center gap-2.5 bg-carbon-900/60 rounded-lg px-2.5 py-1.5 border border-carbon-700"
                      >
                        <span className="text-[10px] text-bone-700 tabular-nums w-4 shrink-0">
                          {i + 1}
                        </span>
                        {it.thumbnailUrl ? (
                          <img
                            src={it.thumbnailUrl}
                            alt=""
                            className="w-7 h-10 object-cover rounded shrink-0 bg-carbon-700"
                          />
                        ) : (
                          <div className="w-7 h-10 rounded shrink-0 bg-carbon-700" />
                        )}
                        <span className="text-[11px] text-bone-500 leading-snug line-clamp-2 flex-1 min-w-0">
                          {it.phrase}
                        </span>
                        <span className="text-[11px] text-gold-500 tabular-nums text-right shrink-0 whitespace-nowrap">
                          {it.time ? (
                            <>
                              {dayLabel(it, schedule.timezone)}
                              <br />
                              {it.time}
                            </>
                          ) : (
                            '—'
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-1.5 text-[11px] text-neon-red">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-carbon-700 shrink-0">
          {saved && (
            <span className="flex items-center gap-1 text-[11px] text-gold-500">
              <Check size={13} /> Guardado
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={loading || saving || times.length === 0}
            className="ml-auto flex items-center gap-1.5 px-4 py-1.5 text-xs text-carbon-900 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 rounded-lg transition-colors font-medium"
          >
            {saving ? 'Guardando…' : 'Guardar cadencia'}
          </button>
        </div>
      </div>
    </div>
  )
}
