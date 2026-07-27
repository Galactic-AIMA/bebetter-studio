import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ExternalLink, ArrowLeft, TriangleAlert } from 'lucide-react'
import { analyticsApi, PieceStats, DimensionSummary } from '../../api'
import { useVideoStore } from '../../store/videoStore'

/**
 * Panel de analítica: qué publicación rindió y con qué receta se hizo.
 *
 * Principio de diseño: **no fabricar certeza**. Los agregados muestran siempre el
 * `n` del grupo y los que no llegan al mínimo se marcan como insuficientes en vez
 * de pintar un ganador — con pocas piezas la diferencia entre grupos es ruido.
 */

type Orden = 'reach' | 'views' | 'saveRate' | 'shareRate' | 'engagementRate' | 'skipRate' | 'fecha'

const ETIQUETA_DIMENSION: Record<string, string> = {
  mood: 'Registro emocional',
  formato: 'Formato',
  imagen: 'Origen de la imagen',
  audio: 'Música de fondo',
  estilo: 'Estilo visual',
  efecto: 'Efecto de texto',
  energia: 'Nivel de energía',
  hora: 'Hora de publicación',
}

function pct(v?: number): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`
}

function num(v?: number): string {
  return v == null ? '—' : v.toLocaleString('es-CO')
}

/** Segundos con un decimal: "4,2 s". */
function seg(v?: number): string {
  return v == null ? '—' : `${v.toFixed(1).replace('.', ',')} s`
}

/** Veces vista por persona alcanzada: por encima de 1 hay replays. */
function veces(v?: number): string {
  return v == null ? '—' : `${v.toFixed(2).replace('.', ',')}×`
}

/**
 * Cobertura de la receta como cuatro puntos: contenido, visual, sonoro, render.
 *
 * Sustituye al antiguo "completa / parcial", que mentía por los dos lados: una
 * pieza con vídeo pero sin pista de audio salía como completa, y otra a la que se
 * le había reconocido la imagen se veía igual que una que solo tenía la frase.
 */
function Cobertura({ p }: { p: PieceStats }) {
  const bloques: [string, boolean][] = [
    ['Frase', p.hasPhrase],
    ['Imagen', p.hasImage],
    ['Audio', p.hasAudio],
    ['Render', p.hasRender],
  ]
  return (
    <span
      className="inline-flex gap-[3px] align-middle"
      title={bloques.map(([n, ok]) => `${ok ? '✓' : '·'} ${n}`).join('   ')}
    >
      {bloques.map(([n, ok]) => (
        <span
          key={n}
          className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-gold-500' : 'bg-carbon-600'}`}
        />
      ))}
    </span>
  )
}

function fecha(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

export default function AnalyticsPanel() {
  const setMode = useVideoStore((s) => s.setMode)
  const [pieces, setPieces] = useState<PieceStats[]>([])
  const [dims, setDims] = useState<DimensionSummary[]>([])
  const [minN, setMinN] = useState(5)
  const [orden, setOrden] = useState<Orden>('reach')
  const [cargando, setCargando] = useState(true)
  const [recogiendo, setRecogiendo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  async function cargar() {
    setCargando(true)
    try {
      const [p, s] = await Promise.all([analyticsApi.pieces(), analyticsApi.summary()])
      setPieces(p)
      setDims(s.dimensions)
      setMinN(s.minN)
    } catch (err: any) {
      setAviso(err?.response?.data?.error ?? err.message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  async function recoger() {
    setRecogiendo(true)
    setAviso(null)
    try {
      const r = await analyticsApi.collect()
      setAviso(`Actualizado: ${r.ok} de ${r.total} publicaciones${r.fallidas.length ? ` · ${r.fallidas.length} sin métricas` : ''}`)
      await cargar()
    } catch (err: any) {
      setAviso(err?.response?.data?.error ?? err.message)
    } finally {
      setRecogiendo(false)
    }
  }

  const conDatos = useMemo(() => pieces.filter((p) => p.reach != null), [pieces])

  const ordenadas = useMemo(() => {
    const arr = [...conDatos]
    if (orden === 'fecha') return arr.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    return arr.sort((a, b) => ((b[orden] as number) ?? 0) - ((a[orden] as number) ?? 0))
  }, [conDatos, orden])

  const porDimension = useMemo(() => {
    const m = new Map<string, DimensionSummary[]>()
    for (const d of dims) {
      const arr = m.get(d.dimension) ?? []
      arr.push(d)
      m.set(d.dimension, arr)
    }
    return [...m.entries()]
  }, [dims])

  const completas = pieces.filter((p) => p.recipeBlocks === 4).length
  const medias = pieces.filter((p) => p.recipeBlocks > 0 && p.recipeBlocks < 4).length
  const cobertura = {
    frase: pieces.filter((p) => p.hasPhrase).length,
    imagen: pieces.filter((p) => p.hasImage).length,
    audio: pieces.filter((p) => p.hasAudio).length,
    render: pieces.filter((p) => p.hasRender).length,
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6 text-bone-500">
      {/* Cabecera */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMode('video')}
            className="flex items-center gap-1.5 text-xs text-bone-700 hover:text-bone-500 transition-colors"
          >
            <ArrowLeft size={13} />
            Volver
          </button>
          <h1 className="text-lg font-semibold tracking-wide">Analítica</h1>
        </div>

        <button
          onClick={recoger}
          disabled={recogiendo}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-carbon-700 hover:bg-carbon-600 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={recogiendo ? 'animate-spin' : ''} />
          {recogiendo ? 'Consultando Instagram…' : 'Actualizar métricas'}
        </button>
      </div>

      <p className="text-xs text-bone-700 mb-1">
        {pieces.length} publicaciones · {completas} con la receta entera · {medias} incompletas
        {conDatos.length < pieces.length && ` · ${pieces.length - conDatos.length} sin métricas todavía`}
      </p>
      <p className="text-[11px] text-bone-700 mb-5">
        Se conoce la <span className="text-bone-500">frase</span> de {cobertura.frase}, la{' '}
        <span className="text-bone-500">imagen</span> de {cobertura.imagen}, el{' '}
        <span className="text-bone-500">audio</span> de {cobertura.audio} y el{' '}
        <span className="text-bone-500">render</span> de {cobertura.render}. Una dimensión solo puede
        compararse sobre las piezas donde ese bloque se conoce.
      </p>

      {aviso && <div className="mb-4 text-xs text-gold-500 bg-carbon-800 rounded-md px-3 py-2">{aviso}</div>}

      {cargando ? (
        <p className="text-xs text-bone-700">Cargando…</p>
      ) : !conDatos.length ? (
        <div className="text-xs text-bone-700 bg-carbon-800 rounded-md px-4 py-6 text-center">
          Todavía no hay métricas. Dale a <span className="text-bone-500">Actualizar métricas</span> para
          traerlas de Instagram.
        </div>
      ) : (
        <>
          {/* --- Ranking ------------------------------------------------- */}
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium">Publicaciones</h2>
            <div className="flex items-center rounded-md overflow-hidden border border-carbon-600 text-[11px]">
              {([
                ['reach', 'Alcance'],
                ['views', 'Vistas'],
                ['saveRate', 'Guardados'],
                ['shareRate', 'Compartidos'],
                ['engagementRate', 'Interacción'],
                ['skipRate', 'Se lo saltan'],
                ['fecha', 'Fecha'],
              ] as [Orden, string][]).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setOrden(id)}
                  className={`px-2.5 py-1 transition-colors ${
                    orden === id
                      ? 'bg-carbon-700 text-bone-500'
                      : 'bg-carbon-800 text-bone-700 hover:text-bone-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-carbon-600 mb-8">
            <table className="w-full text-xs">
              <thead className="bg-carbon-800 text-bone-700">
                <tr>
                  <th className="text-left font-normal px-3 py-2">Fecha</th>
                  <th className="text-left font-normal px-3 py-2">Contenido</th>
                  <th className="text-left font-normal px-3 py-2">Registro</th>
                  <th className="text-right font-normal px-3 py-2">Alcance</th>
                  <th className="text-right font-normal px-3 py-2" title="Reproducciones totales">Vistas</th>
                  <th className="text-right font-normal px-3 py-2" title="Vistas por persona alcanzada: por encima de 1× hay quien lo repite">Repet.</th>
                  <th className="text-right font-normal px-3 py-2" title="Segundos de visionado medio (solo reels)">Reten.</th>
                  <th className="text-right font-normal px-3 py-2" title="Porcentaje que pasa de largo sin verlo. Cuanto más bajo, mejor engancha">Skip</th>
                  <th className="text-right font-normal px-3 py-2" title="Guardados sobre alcance">Guard.</th>
                  <th className="text-right font-normal px-3 py-2" title="Compartidos sobre alcance">Comp.</th>
                  <th className="text-right font-normal px-3 py-2" title="Likes + comentarios + guardados + compartidos, sobre alcance">Interac.</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((p) => (
                  <tr key={p.mediaId} className="border-t border-carbon-700 hover:bg-carbon-800/50">
                    <td className="px-3 py-2 text-bone-700 whitespace-nowrap">{fecha(p.publishedAt)}</td>
                    <td className="px-3 py-2 max-w-md">
                      <span className="line-clamp-1">{p.texto ?? <em className="text-bone-700">sin identificar</em>}</span>
                      <span className="ml-2">
                        <Cobertura p={p} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-bone-700 whitespace-nowrap">{p.moodCategory ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(p.reach)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(p.views)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-bone-700">{veces(p.viewsPerReach)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-bone-700">{seg(p.avgWatchTime)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-bone-700">{pct(p.skipRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(p.saveRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(p.shareRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(p.engagementRate)}</td>
                    <td className="px-2 py-2">
                      {p.permalink && (
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-bone-700 hover:text-bone-500"
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* --- Agregados ------------------------------------------------ */}
          <h2 className="text-sm font-medium mb-1">Qué funciona</h2>
          <p className="text-xs text-bone-700 mb-4 flex items-start gap-1.5">
            <TriangleAlert size={12} className="mt-0.5 shrink-0" />
            <span>
              Los grupos con menos de {minN} publicaciones se marcan como insuficientes: con tan pocas
              piezas la diferencia es ruido, no señal. Las tasas van sobre el alcance, para que una pieza
              muy vista no gane solo por serlo.
            </span>
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
            {porDimension.map(([dimension, valores]) => (
              <div key={dimension} className="rounded-md border border-carbon-600 overflow-hidden">
                <div className="bg-carbon-800 px-3 py-2 text-xs font-medium flex items-center justify-between">
                  <span>{ETIQUETA_DIMENSION[dimension] ?? dimension}</span>
                  {valores.length === 1 && (
                    <span className="text-[10px] text-bone-700 font-normal">
                      un solo valor — todavía no compara nada
                    </span>
                  )}
                </div>
                <table className="w-full text-xs">
                  <thead className="text-bone-700 text-[10px]">
                    <tr className="border-t border-carbon-700">
                      <th className="text-left font-normal px-3 py-1">Valor</th>
                      <th className="text-left font-normal px-2 py-1">Piezas</th>
                      <th className="text-right font-normal px-2 py-1">Alcance medio</th>
                      <th className="text-right font-normal px-2 py-1">Guardados</th>
                      <th className="text-right font-normal px-3 py-1">Compartidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valores.map((d) => {
                      const flojo = d.n < minN
                      return (
                        <tr
                          key={d.valor}
                          className={`border-t border-carbon-700 ${flojo ? 'opacity-40' : ''}`}
                        >
                          <td className="px-3 py-1.5">{d.valor}</td>
                          <td className="px-2 py-1.5 text-bone-700 tabular-nums">n={d.n}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{num(d.reachMedio)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums" title="Guardados sobre alcance">
                            {pct(d.saveRate)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums" title="Compartidos sobre alcance">
                            {flojo ? <span className="text-bone-700">insuficiente</span> : pct(d.shareRate)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
