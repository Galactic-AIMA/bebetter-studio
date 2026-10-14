import { ArrowsClockwise, Trash } from '@phosphor-icons/react'
import { useEffect, useState, useCallback } from 'react'
import { logsApi, LogEntry, LogLevel } from '../../api'
import PanelDeslizante from '../ui/PanelDeslizante'

interface Props {
  onClose: () => void
}

const CATEGORY_LABEL: Record<string, string> = {
  generate: 'Generación',
  drive: 'Drive',
  publish: 'Publicar',
  s3: 'R2',
  system: 'Sistema',
  carousel: 'Carrusel',
  insights: 'Analítica',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

/** Registro de actividad. Es la única pantalla donde se admite jerga técnica (DESIGN.md §8). */
export default function LogsModal({ onClose }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<'all' | LogLevel>('all')
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await logsApi.list({ limit: 300, level: filter === 'all' ? undefined : filter })
      setLogs(data)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [autoRefresh, load])

  const handleClear = async () => {
    await logsApi.clear()
    load()
  }

  const errorCount = logs.filter((l) => l.level === 'error').length

  return (
    <PanelDeslizante
      titulo="Registro"
      onClose={onClose}
      meta={errorCount > 0 && (
        <span className="shrink-0 font-mono text-meta tabular-nums text-lacre">
          {errorCount} error{errorCount !== 1 ? 'es' : ''}
        </span>
      )}
      acciones={
        <>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            aria-pressed={autoRefresh}
            aria-label={autoRefresh ? 'Pausar el refresco automático' : 'Reanudar el refresco automático'}
            title={autoRefresh ? 'Se refresca cada 3 s' : 'Refresco pausado'}
            className={`grid h-10 w-10 place-items-center rounded-control transition-colors duration-rapido ease-mesa hover:bg-s2 lg:h-8 lg:w-8 ${
              autoRefresh ? 'text-oro' : 'text-hueso-2 hover:text-hueso'
            }`}
          >
            <ArrowsClockwise size={16} />
          </button>
          <button
            onClick={handleClear}
            aria-label="Vaciar el registro"
            title="Vaciar el registro"
            className="grid h-10 w-10 place-items-center rounded-control text-hueso-2 transition-colors duration-rapido ease-mesa hover:bg-s2 hover:text-lacre lg:h-8 lg:w-8"
          >
            <Trash size={16} />
          </button>
        </>
      }
    >
      <div className="sticky top-0 z-10 flex gap-1.5 border-b border-linea bg-s1 px-5 py-2.5">
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todo</button>
        <button className="chip" aria-pressed={filter === 'error'} onClick={() => setFilter('error')}>Errores</button>
      </div>

      {loading ? (
        <p className="px-5 py-6 text-ui text-hueso-3">Cargando el registro…</p>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-5 py-10">
          <p className="pt-[.16em] font-display text-display uppercase text-hueso">
            {filter === 'error' ? 'Sin errores' : 'Sin actividad'}
          </p>
          <p className="text-body text-hueso-2">
            {filter === 'error'
              ? 'Nada ha fallado en lo que guarda el registro.'
              : 'Aquí aparece cada generación, subida y publicación.'}
          </p>
          {filter === 'error' && <button className="btn-sec mt-1" onClick={() => setFilter('all')}>Ver todo</button>}
        </div>
      ) : (
        <ul className="font-mono text-meta">
          {logs.map((l) => (
            // id + hora: si dos procesos del servidor escribieron el mismo logs.jsonl,
            // cada uno con su contador, los ids se repiten.
            <li key={`${l.id}-${l.ts}`} className="flex flex-col gap-0.5 border-b border-linea px-5 py-2 transition-colors duration-rapido ease-mesa hover:bg-s2">
              <span className="flex items-baseline gap-2">
                <span className="tabular-nums text-hueso-3">{formatTime(l.ts)}</span>
                <span className={l.level === 'error' ? 'text-lacre' : 'text-hueso-2'}>
                  {CATEGORY_LABEL[l.category] ?? l.category}
                </span>
              </span>
              <span className={`font-sans text-ui ${l.level === 'error' ? 'text-lacre' : 'text-hueso'}`}>{l.message}</span>
              {l.detail && <span className="break-words text-hueso-3">{l.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </PanelDeslizante>
  )
}
