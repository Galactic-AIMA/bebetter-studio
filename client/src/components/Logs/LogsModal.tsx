import { X, RotateCw, Trash2 } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { logsApi, LogEntry, LogLevel } from '../../api'

interface Props {
  onClose: () => void
}

const CATEGORY_LABEL: Record<string, string> = {
  generate: 'Generación',
  drive: 'Drive',
  publish: 'Publicar',
  s3: 'R2',
  system: 'Sistema',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-2xl bg-carbon-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-carbon-700 shrink-0">
          <h2 className="text-sm font-semibold tracking-wide text-bone-500">Registro de actividad</h2>
          {errorCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-neon-red/15 text-neon-red">
              {errorCount} error{errorCount !== 1 ? 'es' : ''}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            {/* Filtro nivel */}
            <div className="flex items-center rounded-lg overflow-hidden border border-carbon-600 text-[11px] mr-1">
              {([
                { id: 'all', label: 'Todos' },
                { id: 'error', label: 'Errores' },
              ] as const).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setFilter(id as 'all' | LogLevel)}
                  className={`px-2.5 py-1 transition-colors ${
                    filter === id ? 'bg-carbon-600 text-bone-500' : 'bg-carbon-800 text-bone-700 hover:text-bone-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setAutoRefresh((v) => !v)}
              title={autoRefresh ? 'Auto-refresco activo' : 'Auto-refresco pausado'}
              className={`p-1.5 rounded-lg transition-colors ${
                autoRefresh ? 'text-gold-500' : 'text-bone-700 hover:text-bone-500'
              }`}
            >
              <RotateCw size={13} />
            </button>
            <button
              onClick={handleClear}
              title="Limpiar logs"
              className="p-1.5 rounded-lg text-bone-700 hover:text-neon-red transition-colors"
            >
              <Trash2 size={13} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-carbon-700/80 text-bone-700 hover:text-bone-500 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="overflow-y-auto flex-1 p-2 font-mono text-[11px]">
          {loading ? (
            <p className="p-4 text-bone-700">Cargando...</p>
          ) : logs.length === 0 ? (
            <p className="p-4 text-bone-700">Sin actividad registrada.</p>
          ) : (
            <div className="flex flex-col">
              {logs.map((l) => (
                <div
                  key={l.id}
                  className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-carbon-700/50 border-b border-carbon-700/40 last:border-0"
                >
                  <span className="shrink-0 text-bone-700 tabular-nums">{formatTime(l.ts)}</span>
                  <span
                    className={`shrink-0 w-14 uppercase tracking-wide ${
                      l.level === 'error' ? 'text-neon-red' : 'text-gold-500/80'
                    }`}
                  >
                    {CATEGORY_LABEL[l.category] ?? l.category}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className={l.level === 'error' ? 'text-neon-red' : 'text-bone-500'}>{l.message}</span>
                    {l.detail && <span className="block text-bone-700 break-words">{l.detail}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
