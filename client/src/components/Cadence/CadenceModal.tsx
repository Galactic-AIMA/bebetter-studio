import { Check, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { cadenceApi, ScheduleResult } from '../../api'
import { dayLabel } from '../../lib/cola'
import PanelDeslizante from '../ui/PanelDeslizante'
import { Segmentos } from '../ui/mesa'

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
      setError('Hay dos horas iguales: cada salida necesita su propia hora.')
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
    <PanelDeslizante
      titulo="Cadencia"
      onClose={onClose}
      pie={
        <>
          <span aria-live="polite" className="text-ui text-hueso-2">
            {saved && <span className="flex items-center gap-1.5"><Check size={16} className="text-oro" /> Guardada</span>}
          </span>
          <button
            onClick={handleSave}
            disabled={loading || saving || times.length === 0}
            className="btn-sec ml-auto"
          >
            {saving ? 'Guardando…' : 'Guardar cadencia'}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="px-5 py-6 text-ui text-hueso-3">Cargando la cadencia…</p>
      ) : (
        <div className="flex flex-col gap-6 px-5 py-5">
          <p className="text-ui text-hueso-2">
            A estas horas, todos los días, sale el aprobado más antiguo de la cola. Si a una hora no
            hay nada aprobado, no pasa nada.
          </p>

          <div className="flex flex-col gap-1.5">
            <Segmentos
              label="Publicaciones al día"
              value={String(times.length)}
              onChange={(v) => applyCount(Number(v))}
              options={Array.from({ length: MAX_SLOTS }, (_, i) => ({ value: String(i + 1), label: <span className="font-mono">{i + 1}</span> }))}
            />
            <p className="text-meta text-hueso-3">
              Se reparten entre las <span className="font-mono">{hhmm(DAY_START)}</span> y las{' '}
              <span className="font-mono">{hhmm(DAY_END)}</span>. Puedes mover cada hora.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-ui text-hueso-3">Horas</span>
            <div className="flex flex-wrap gap-1.5">
              {times.map((t, idx) => (
                <select
                  key={idx}
                  value={hourOf(t)}
                  onChange={(e) => setSlot(idx, Number(e.target.value))}
                  aria-label={`Hora ${idx + 1}`}
                  className={`campo h-10 w-auto font-mono tabular-nums lg:h-8 lg:py-0 ${
                    hasDupes && times.filter((x) => hourOf(x) === hourOf(t)).length > 1 ? 'border-lacre' : ''
                  }`}
                >
                  {HOUR_OPTIONS.map((h) => (
                    <option key={h} value={h}>{hhmm(h)}</option>
                  ))}
                </select>
              ))}
            </div>
            <p className="font-mono text-meta text-hueso-3">
              {evenGap ? `cada ${evenGap} h · ` : ''}{timezone}
            </p>
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-1.5 text-ui text-lacre">
              <WarningCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}

          {/* Próximas publicaciones: la proyección de la cola de aprobados. */}
          <section className="flex flex-col gap-2 border-t border-linea pt-5">
            <h3 className="flex items-baseline gap-2">
              <span className="rotulo">Próximas salidas</span>
              {schedule && schedule.count > 0 && (
                <span className="font-mono text-meta tabular-nums text-hueso-3">{schedule.count} en cola</span>
              )}
            </h3>
            {loadingSchedule ? (
              <p className="text-ui text-hueso-3">Calculando…</p>
            ) : !schedule || schedule.count === 0 ? (
              <p className="text-ui text-hueso-2">
                No hay nada aprobado en la cola. Lo que apruebes en Revisión aparecerá aquí con su hora.
              </p>
            ) : schedule.times.length === 0 ? (
              <p className="flex items-start gap-1.5 text-ui text-lacre">
                <WarningCircle size={16} className="mt-0.5 shrink-0" />
                Hay {schedule.count} aprobado{schedule.count === 1 ? '' : 's'} pero ninguna hora: no saldrán hasta que guardes una cadencia.
              </p>
            ) : (
              <ol>
                {schedule.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-3 border-b border-linea py-2 last:border-0">
                    <span className="h-10 w-[23px] shrink-0 overflow-hidden rounded-[4px] bg-s2">
                      {it.thumbnailUrl && <img src={it.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
                    </span>
                    <span className="line-clamp-2 min-w-0 flex-1 text-ui text-hueso">{it.phrase}</span>
                    <span className="shrink-0 whitespace-nowrap text-right font-mono text-meta tabular-nums text-hueso-2">
                      {it.time ? (<>{dayLabel(it, schedule.timezone)}<br /><span className="text-oro">{it.time}</span></>) : '—'}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </PanelDeslizante>
  )
}
