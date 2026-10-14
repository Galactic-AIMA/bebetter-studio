import { useCallback, useEffect, useState } from 'react'
import { ArrowsClockwise, Check, WarningCircle, Plus, X } from '@phosphor-icons/react'
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
      setError('Hay dos horas iguales: cada franja necesita la suya.')
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
    <section className="mt-8 border-t border-linea pt-5">
      <header className="mb-3 flex items-center gap-2">
        <h2 className="rotulo">Cola de publicación</h2>
        {!!data?.count && <span className="font-mono text-meta tabular-nums text-hueso-3">{data.count} en cola</span>}
        <button onClick={load} disabled={loading} className="btn-fantasma ml-auto h-10 px-1 lg:h-8">
          <ArrowsClockwise size={16} /> Actualizar
        </button>
      </header>

      {/* ── Cadencia semanal ── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {DAYS.map((d) => (
          <button
            key={d.iso}
            onClick={() => toggleDay(d.iso)}
            aria-pressed={days.includes(d.iso)}
            aria-label={d.full}
            className="chip"
          >
            {d.label}
          </button>
        ))}

        <span className="mx-1 text-ui text-hueso-3">a las</span>

        {times.map((t, i) => (
          <span key={i} className="flex items-center">
            <select
              value={hourOf(t)}
              onChange={(e) => setTime(i, Number(e.target.value))}
              aria-label={`Hora ${i + 1}`}
              className="campo h-10 w-auto py-0 font-mono tabular-nums lg:h-8"
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>{hhmm(h)}</option>
              ))}
            </select>
            {times.length > 1 && (
              <button
                onClick={() => removeTime(i)}
                aria-label="Quitar esta franja"
                title="Quitar esta franja"
                className="btn-fantasma grid h-10 w-8 place-items-center hover:text-lacre lg:h-8"
              >
                <X size={14} />
              </button>
            )}
          </span>
        ))}

        {times.length < MAX_TIMES && (
          <button onClick={addTime} className="btn-sec px-2" title="Añadir otra franja">
            <Plus size={14} /> hora
          </button>
        )}

        {dirty && (
          <button onClick={save} disabled={saving || !days.length || !times.length} className="btn-sec ml-auto border-hueso">
            {saving ? 'Guardando…' : 'Guardar cadencia'}
          </button>
        )}
        {saved && !dirty && (
          <span className="ml-auto flex items-center gap-1.5 text-ui text-hueso-2">
            <Check size={16} className="text-oro" /> Guardada
          </span>
        )}
      </div>

      <p className="mb-4 text-ui text-hueso-3">
        Los carruseles en cola salen solos: {resumen(days, times)}
        {data?.timezone && <span className="font-mono text-meta"> · {data.timezone}</span>}
      </p>

      {error && (
        <p role="alert" className="mb-3 flex items-start gap-1.5 text-ui text-lacre">
          <WarningCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {/* ── Lo que hay en cola ── */}
      {loading && !data ? (
        <p className="text-ui text-hueso-3">Cargando la cola…</p>
      ) : !data || data.count === 0 ? (
        <p className="text-ui text-hueso-2">
          No hay carruseles en cola. Los que envíes con «Enviar a la cola» aparecerán aquí con su fecha.
        </p>
      ) : !data.days.length || !data.times.length ? (
        <p className="flex items-start gap-1.5 text-ui text-lacre">
          <WarningCircle size={16} className="mt-0.5 shrink-0" />
          Hay {data.count} en cola pero ningún día ni hora: no saldrán hasta que guardes una cadencia.
        </p>
      ) : (
        <ol>
          {data.items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-3 border-b border-linea py-2 last:border-0">
              <span className="w-4 shrink-0 font-mono text-meta tabular-nums text-hueso-3">{i + 1}</span>
              <span className="h-10 w-8 shrink-0 overflow-hidden rounded-[4px] bg-s2">
                {it.firstImage && <img src={it.firstImage} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
              </span>
              <span className="min-w-0 flex-1">
                {it.referencia && <span className="block font-mono text-meta text-hueso-3">{it.referencia}</span>}
                <span className="line-clamp-2 block text-ui text-hueso">{it.tema}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-right font-mono text-meta tabular-nums text-oro">
                {etaLabel(it.etaIso, data.timezone)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
