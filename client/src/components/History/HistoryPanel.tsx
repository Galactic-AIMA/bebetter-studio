import { useEffect, useState } from 'react'
import { Star, RefreshCw } from 'lucide-react'
import { historyApi } from '../../api'
import { HistoryItem } from '../../types'
import HistoryCard from './HistoryCard'
import HistoryModal from './HistoryModal'

export default function HistoryPanel() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [onlyViral, setOnlyViral] = useState(false)
  const [selected, setSelected] = useState<HistoryItem | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await historyApi.list()
      setItems(data)
    } catch {
      setError('No se pudo cargar el historial')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleViral(e: React.MouseEvent, item: HistoryItem) {
    e.stopPropagation()
    const newViral = !item.viral
    // optimistic update
    setItems((prev) =>
      prev.map((i) => (i.id === item.id && i.kind === item.kind ? { ...i, viral: newViral } : i))
    )
    try {
      await historyApi.setViral(item.kind, item.id, newViral)
    } catch {
      // revert on error
      setItems((prev) =>
        prev.map((i) => (i.id === item.id && i.kind === item.kind ? { ...i, viral: item.viral } : i))
      )
    }
  }

  const displayed = onlyViral ? items.filter((i) => i.viral) : items

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-carbon-600">
        <span className="text-[11px] text-bone-700">{items.length} elementos</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setOnlyViral((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              onlyViral
                ? 'bg-gold-500/15 text-gold-500'
                : 'text-bone-700 hover:text-bone-500'
            }`}
          >
            <Star size={10} className={onlyViral ? 'fill-gold-500' : ''} />
            Virales
          </button>
          <button
            onClick={load}
            className="p-1 rounded text-bone-700 hover:text-bone-500 transition-colors"
            title="Recargar"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading && (
          <p className="text-center text-[11px] text-bone-700 py-6">Cargando...</p>
        )}
        {error && (
          <p className="text-center text-[11px] text-neon-red py-6">{error}</p>
        )}
        {!loading && !error && displayed.length === 0 && (
          <p className="text-center text-[11px] text-bone-700 py-6">
            {onlyViral ? 'Ningún elemento marcado como viral' : 'Sin historial todavía'}
          </p>
        )}
        {!loading && displayed.map((item) => (
          <HistoryCard
            key={`${item.kind}-${item.id}`}
            item={item}
            onClick={() => setSelected(item)}
            onToggleViral={(e) => toggleViral(e, item)}
          />
        ))}
      </div>

      {/* Modal */}
      {selected && (
        <HistoryModal
          item={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
