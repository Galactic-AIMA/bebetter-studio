import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, RefreshCw, Check, AlertCircle, Plus, X } from 'lucide-react'
import { carouselsApi, CarouselUpcoming } from '../../api'

/**
 * Cola de carruseles + cadencia semanal, en la pantalla inicial del Modo Carrusel.
 *
 * Equivalente al CadenceModal de los reels, pero la cadencia de carruseles es
 * SEMANAL (días + horas), no diaria: salen 2-3 veces por semana. Igual que allí,
 * el Sheet no guarda una hora por carrusel — la hora emerge de la posición en la
 * cola + la cadencia, así que se proyecta (GET /carousels/queue/upcoming).
 */

// Franja diurna permitida y máximo de franjas por día (mismas reglas que el backend).
const HOUR_OPTIONS = Array.from({ length: 22 - 6 + 1 }, (_, i) => 6 + i) // 6..22
const MAX_TIMES = 3

const DAYS: { iso: number; label: string; full: string }[] = [
  { iso: 1, label: 'Lun', full: 'lunes' },
  { iso: 2, label: 'Mar', full: 'martes' },
  { iso: 3, label: 'Mié', full: 'miércoles' },
  { iso: 4, label: 'Jue', full: 'jueves' },
  { iso: 5, label: 'Vie', full: 'viernes' },
  { iso: 6, label: 'Sáb', full: 'sábado' },
  { iso: 7, label: 'Dom', full: 'domingo' },
]

const hhmm = (h: number) => String(h).padStart(2, '0') + ':00'
const hourOf = (t: string) => Number(t.split(':')[0])

/** "martes y viernes a las 19:00" */
function resumen(days: number[], times: string[]): string {
  const ds = DAYS.filter((d) => days.includes(d.iso)).map((d) => d.full)
  if (!ds.length || !times.length) return 'sin cadencia'
  const dias = ds.length === 1 ? ds[0] : `${ds.slice(0, -1).join(', ')} y ${ds[ds.length - 1]}`
  return `${dias} a las ${[...times].sort().join(' y ')}`
}

/** "Mar 28 · 19:00" en la zona horaria de la cadencia. */
function etaLabel(iso: string | undefined, tz: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const dia = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', timeZone: tz })
  const hora = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: tz })
  return `${dia.charAt(0).toUpperCase() + dia.slice(1)} · ${hora}`
}

export default function CarouselQueue() {
  const [data, setData] = useState<CarouselUpcoming | null>(null)
  const [loading, setLoading] = useState(true)
  // Borrador editable de la cadencia (se siembra con lo que devuelve el server)
  const [days, setDays] = useState<number[]>([])
  const [times, setTimes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    carouselsApi
      .upcoming()
      .then((d) => {
        setData(d)
        setDays(d.days)
        setTimes(d.times)
      })
      .catch((e) => setError(e?.response?.data?.error || e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const toggleDay = (iso: number) => {
    setSaved(false)
    setError(null)
    setDays((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort((a, b) => a - b)))
  }

  const setTime = (idx: number, hour: number) => {
    setSaved(false)
    setError(null)
    setTimes((prev) => prev.map((t, i) => (i === idx ? hhmm(hour) : t)))
  }

  const addTime = () => {
    setSaved(false)
    const used = times.map(hourOf)
    const libre = HOUR_OPTIONS.find((h) => !used.includes(h)) ?? 19
    setTimes((prev) => [...prev, hhmm(libre)])
  }

  const removeTime = (idx: number) => {
    setSaved(false)
    setTimes((prev) => prev.filter((_, i) => i !== idx))
  }

  const dirty =
    !!data && (days.join(',') !== data.days.join(',') || [...times].sort().join(',') !== [...data.times].sort().join(','))
  const hasDupes = new Set(times.map(hourOf)).size !== times.length

  const save = async () => {
    setError(null)
    if (hasDupes) {
      setError('Hay horas repetidas — cada franja debe ser distinta')
      return
    }
    setSaving(true)
    try {
      await carouselsApi.saveCadence(days, times)
      setSaved(true)
      load() // la proyección depende de la cadencia recién guardada
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-6 bg-carbon-800 rounded-xl p-4 border border-carbon-700">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock size={13} className="text-gold-500" />
        <h2 className="text-[11px] font-medium text-bone-500">Cola de publicación</h2>
        {!!data?.count && <span className="text-[10px] text-bone-700">({data.count} en cola)</span>}
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1 text-[10px] text-bone-700 hover:text-bone-500 disabled:opacity-40"
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {/* ── Cadencia semanal ── */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {DAYS.map((d) => (
          <button
            key={d.iso}
            onClick={() => toggleDay(d.iso)}
            className={`text-[10px] rounded-md px-2 py-1 border transition-colors ${
              days.includes(d.iso)
                ? 'bg-gold-500 text-carbon-900 border-gold-500 font-medium'
                : 'bg-carbon-900 text-bone-700 border-carbon-600 hover:text-bone-500'
            }`}
          >
            {d.label}
          </button>
        ))}

        <span className="text-[10px] text-bone-700 mx-1">a las</span>

        {times.map((t, i) => (
          <span key={i} className="flex items-center gap-0.5">
            <select
              value={hourOf(t)}
              onChange={(e) => setTime(i, Number(e.target.value))}
              className="bg-carbon-900 border border-carbon-600 rounded-md px-1.5 py-1 text-[10px] text-bone-500 tabular-nums focus:outline-none focus:border-gold-500/60"
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {hhmm(h)}
                </option>
              ))}
            </select>
            {times.length > 1 && (
              <button
                onClick={() => removeTime(i)}
                className="p-0.5 text-bone-700 hover:text-neon-red"
                title="Quitar esta franja"
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}

        {times.length < MAX_TIMES && (
          <button
            onClick={addTime}
            className="flex items-center gap-0.5 text-[10px] text-bone-700 hover:text-bone-500 border border-carbon-600 rounded-md px-1.5 py-1"
            title="Añadir otra franja"
          >
            <Plus size={10} /> hora
          </button>
        )}

        {dirty && (
          <button
            onClick={save}
            disabled={saving || !days.length || !times.length}
            className="ml-auto text-[10px] font-medium text-carbon-900 bg-gold-500 hover:bg-gold-600 rounded-md px-2.5 py-1 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Guardando…' : 'Guardar cadencia'}
          </button>
        )}
        {saved && !dirty && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-gold-500">
            <Check size={11} /> Guardado
          </span>
        )}
      </div>

      <p className="text-[10px] text-bone-700 mb-3">
        Los carruseles en cola se publican solos: {resumen(days, times)}
        {data?.timezone ? ` · ${data.timezone}` : ''}
      </p>

      {error && (
        <p className="flex items-start gap-1.5 text-[10px] text-neon-red mb-2">
          <AlertCircle size={11} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {/* ── Lo que hay en cola ── */}
      {loading && !data ? (
        <p className="text-[11px] text-bone-700">Cargando…</p>
      ) : !data || data.count === 0 ? (
        <p className="text-[11px] text-bone-700">
          No hay carruseles en cola. Los que envíes con “Enviar a la cola” aparecerán aquí con su
          fecha estimada.
        </p>
      ) : !data.days.length || !data.times.length ? (
        <p className="text-[11px] text-neon-red">
          Hay {data.count} en cola pero no hay cadencia configurada — no se publicarán hasta elegir
          días y horas arriba.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.items.map((it, i) => (
            <li
              key={it.id}
              className="flex items-center gap-2.5 bg-carbon-900/60 rounded-lg px-2.5 py-1.5 border border-carbon-700"
            >
              <span className="text-[10px] text-bone-700 tabular-nums w-4 shrink-0">{i + 1}</span>
              {it.firstImage ? (
                <img src={it.firstImage} alt="" className="w-8 h-10 object-cover rounded shrink-0 bg-carbon-700" />
              ) : (
                <div className="w-8 h-10 rounded shrink-0 bg-carbon-700" />
              )}
              <span className="flex-1 min-w-0">
                {it.referencia && (
                  <span className="text-[9px] font-medium text-neon-red block leading-tight">{it.referencia}</span>
                )}
                <span className="text-[11px] text-bone-500 leading-snug line-clamp-2 block">{it.tema}</span>
              </span>
              <span className="text-[11px] text-gold-500 tabular-nums text-right shrink-0 whitespace-nowrap">
                {etaLabel(it.etaIso, data.timezone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
