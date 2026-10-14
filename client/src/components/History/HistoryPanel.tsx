import { useEffect, useState } from 'react'
import { Star, ArrowsClockwise, WarningCircle } from '@phosphor-icons/react'
import { historyApi } from '../../api'
import { HistoryItem } from '../../types'
import HistoryCard from './HistoryCard'
import HistoryModal from './HistoryModal'

export default function HistoryPanel({ active }: { active: boolean }) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)
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

  // Recarga cada vez que se abre la pestaña Historial (las pestañas usan `hidden`
  // y no se desmontan, así que sin esto la lista quedaba con datos viejos tras
  // generar/publicar un video).
  useEffect(() => { if (active) load() }, [active])

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
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-linea px-5 pb-4 pt-4 lg:pt-3">
        <span className="text-ui text-hueso-2"><span className="font-mono">{items.length}</span> piezas</span>
        <button className="chip ml-auto" aria-pressed={onlyViral} onClick={() => setOnlyViral((v) => !v)}>
          <Star size={14} weight={onlyViral ? 'fill' : 'regular'} className={onlyViral ? 'text-oro' : ''} /> Virales
        </button>
        <button onClick={load} disabled={loading} className="btn-fantasma grid h-10 w-10 place-items-center lg:h-auto lg:w-auto lg:p-1" aria-label="Recargar el historial">
          <ArrowsClockwise size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-5 py-6 text-ui text-hueso-3">Cargando el historial…</p>}
        {error && (
          <p role="alert" className="flex items-center gap-1.5 px-5 py-6 text-ui text-lacre">
            <WarningCircle size={16} /> {error}
          </p>
        )}
        {!loading && !error && displayed.length === 0 && (
          onlyViral ? (
            <p className="px-5 py-6 text-ui text-hueso-3">Aún no has marcado ninguna como viral.</p>
          ) : (
            <div className="flex flex-col items-start gap-3 px-5 py-10">
              <p className="pt-[.16em] font-display text-display uppercase text-hueso">Sin historial</p>
              <p className="text-body text-hueso-2">Lo que generes aparecerá aquí, con su frase y su fondo.</p>
            </div>
          )
        )}
        {!loading && (
          <ul>
            {displayed.map((item) => (
              <HistoryCard
                key={`${item.kind}-${item.id}`}
                item={item}
                onClick={() => setSelected(item)}
                onToggleViral={(e) => toggleViral(e, item)}
              />
            ))}
          </ul>
        )}
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
