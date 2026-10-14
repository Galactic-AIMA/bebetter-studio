import { useEffect, useMemo, useState } from 'react'
import { ArrowsClockwise, ArrowSquareOut, ArrowLeft, Warning, Check } from '@phosphor-icons/react'
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
  return v == null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')} %`
}

/** Miles con punto, a mano: `toLocaleString` no agrupa las cifras de 4 dígitos (`1687`). */
function num(v?: number): string {
  return v == null ? '—' : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
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
      title={bloques.map(([n, ok]) => `${n}: ${ok ? 'sí' : 'no'}`).join(' · ')}
    >
      {bloques.map(([n, ok]) => (
        <span
          key={n}
          className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-oro' : 'bg-s3'}`}
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

  const th = 'px-3 py-2 font-normal'
  const td = 'whitespace-nowrap px-3 py-2 text-right font-mono text-meta tabular-nums'

  return (
    <div className="h-full overflow-y-auto px-4 py-5 text-hueso sm:px-8 sm:py-6">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <button onClick={() => setMode('video')} className="btn-fantasma h-10 lg:h-8">
            <ArrowLeft size={16} /> Volver
          </button>
          <h1 className="text-title font-light">Analítica</h1>
        </div>
        <button onClick={recoger} disabled={recogiendo} className="btn-sec">
          <ArrowsClockwise size={16} />
          {recogiendo ? 'Consultando Instagram…' : 'Actualizar métricas'}
        </button>
      </header>

      <p className="mb-1 text-ui text-hueso-2">
        <span className="font-mono">{pieces.length}</span> publicaciones · <span className="font-mono">{completas}</span> con la receta entera ·{' '}
        <span className="font-mono">{medias}</span> incompletas
        {conDatos.length < pieces.length && <> · <span className="font-mono">{pieces.length - conDatos.length}</span> sin métricas todavía</>}
      </p>
      <p className="mb-5 max-w-[80ch] text-ui text-hueso-3">
        Se conoce la <span className="text-hueso-2">frase</span> de {cobertura.frase}, la{' '}
        <span className="text-hueso-2">imagen</span> de {cobertura.imagen}, el{' '}
        <span className="text-hueso-2">audio</span> de {cobertura.audio} y el{' '}
        <span className="text-hueso-2">render</span> de {cobertura.render}. Una dimensión solo se compara
        sobre las piezas donde ese bloque se conoce.
      </p>

      {aviso && (
        <p aria-live="polite" className="mb-4 flex items-center gap-1.5 text-ui text-hueso-2">
          <Check size={16} className="shrink-0 text-oro" /> {aviso}
        </p>
      )}

      {cargando ? (
        <p className="text-ui text-hueso-3">Cargando las métricas…</p>
      ) : !conDatos.length ? (
        <div className="flex flex-col items-start gap-3 py-10">
          <p className="pt-[.16em] font-display text-display uppercase text-hueso">Sin métricas</p>
          <p className="text-body text-hueso-2">Todavía no se ha traído nada de Instagram.</p>
          <button onClick={recoger} disabled={recogiendo} className="btn-sec mt-1">Actualizar métricas</button>
        </div>
      ) : (
        <>
          {/* --- Ranking ------------------------------------------------- */}
          {/* En columna por debajo de `sm`: siete criterios no caben en 390 px al
              lado del título. La tira se desplaza DENTRO de su caja, no la página. */}
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="rotulo shrink-0">Publicaciones</h2>
            <div className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Ordenar por">
              {([
                ['reach', 'Alcance'],
                ['views', 'Vistas'],
                ['saveRate', 'Guardados'],
                ['shareRate', 'Compartidos'],
                ['engagementRate', 'Interacción'],
                ['skipRate', 'Se lo saltan'],
                ['fecha', 'Fecha'],
              ] as [Orden, string][]).map(([id, label]) => (
                <button key={id} onClick={() => setOrden(id)} aria-pressed={orden === id} className="chip shrink-0">
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* `relative`: sin él, el `sr-only` (absolute) de la última columna escapa del
              recorte y da scroll horizontal a toda la página en móvil. */}
          <div className="relative mb-10 overflow-x-auto rounded-panel border border-linea-2">
            <table className="w-full text-ui">
              <thead className="bg-s1 text-meta text-hueso-3">
                <tr>
                  <th className={`${th} text-left`}>Fecha</th>
                  <th className={`${th} text-left`}>Contenido</th>
                  <th className={`${th} text-left`}>Registro</th>
                  <th className={`${th} text-right`}>Alcance</th>
                  <th className={`${th} text-right`} title="Reproducciones totales">Vistas</th>
                  <th className={`${th} text-right`} title="Vistas por persona alcanzada: por encima de 1× hay quien lo repite">Repet.</th>
                  <th className={`${th} text-right`} title="Segundos de visionado medio (solo reels)">Reten.</th>
                  <th className={`${th} text-right`} title="Porcentaje que pasa de largo sin verlo. Cuanto más bajo, mejor engancha">Skip</th>
                  <th className={`${th} text-right`} title="Guardados sobre alcance">Guard.</th>
                  <th className={`${th} text-right`} title="Compartidos sobre alcance">Comp.</th>
                  <th className={`${th} text-right`} title="Likes + comentarios + guardados + compartidos, sobre alcance">Interac.</th>
                  <th className="px-2 py-2"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((p) => (
                  <tr key={p.mediaId} className="border-t border-linea transition-colors duration-rapido ease-mesa hover:bg-s2">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-meta text-hueso-3">{fecha(p.publishedAt)}</td>
                    <td className="max-w-md px-3 py-2">
                      <span className="line-clamp-1">{p.texto ?? <span className="text-hueso-3">sin identificar</span>}</span>
                      <span className="mt-1 block"><Cobertura p={p} /></span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-hueso-2">{p.moodCategory ?? '—'}</td>
                    <td className={`${td} text-hueso`}>{num(p.reach)}</td>
                    <td className={`${td} text-hueso`}>{num(p.views)}</td>
                    <td className={`${td} text-hueso-2`}>{veces(p.viewsPerReach)}</td>
                    <td className={`${td} text-hueso-2`}>{seg(p.avgWatchTime)}</td>
                    <td className={`${td} text-hueso-2`}>{pct(p.skipRate)}</td>
                    <td className={`${td} text-hueso`}>{pct(p.saveRate)}</td>
                    <td className={`${td} text-hueso`}>{pct(p.shareRate)}</td>
                    <td className={`${td} text-hueso`}>{pct(p.engagementRate)}</td>
                    <td className="px-2 py-2">
                      {p.permalink && (
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Abrir en Instagram"
                          className="grid h-8 w-8 place-items-center rounded-control text-hueso-3 transition-colors duration-rapido ease-mesa hover:bg-s3 hover:text-hueso"
                        >
                          <ArrowSquareOut size={16} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* --- Agregados ------------------------------------------------ */}
          <h2 className="rotulo mb-2">Qué funciona</h2>
          <p className="mb-4 flex max-w-[80ch] items-start gap-1.5 text-ui text-hueso-2">
            <Warning size={16} className="mt-0.5 shrink-0 text-hueso-3" />
            <span>
              Los grupos con menos de <span className="font-mono">{minN}</span> publicaciones se marcan como
              insuficientes: con tan pocas piezas la diferencia es ruido, no señal. Las tasas van sobre el
              alcance, para que una pieza muy vista no gane solo por serlo.
            </span>
          </p>

          <div className="grid grid-cols-1 gap-4 pb-8 md:grid-cols-2">
            {porDimension.map(([dimension, valores]) => (
              <section key={dimension} className="overflow-hidden rounded-panel border border-linea-2">
                <h3 className="flex items-center justify-between gap-2 bg-s1 px-3 py-2 text-ui text-hueso">
                  <span>{ETIQUETA_DIMENSION[dimension] ?? dimension}</span>
                  {valores.length === 1 && (
                    <span className="text-meta text-hueso-3">un solo valor: aún no compara nada</span>
                  )}
                </h3>
                <table className="w-full text-ui">
                  <thead className="text-meta text-hueso-3">
                    <tr className="border-t border-linea">
                      <th className="px-3 py-1 text-left font-normal">Valor</th>
                      <th className="px-2 py-1 text-left font-normal">Piezas</th>
                      <th className="px-2 py-1 text-right font-normal">Alcance medio</th>
                      <th className="px-2 py-1 text-right font-normal">Guardados</th>
                      <th className="px-3 py-1 text-right font-normal">Compartidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valores.map((d) => {
                      // Insuficiente: se apaga a hueso-3 (legible), no con opacidad.
                      const flojo = d.n < minN
                      const c = flojo ? 'text-hueso-3' : 'text-hueso'
                      return (
                        <tr key={d.valor} className="border-t border-linea">
                          <td className={`px-3 py-1.5 ${c}`}>{d.valor}</td>
                          <td className="px-2 py-1.5 font-mono text-meta tabular-nums text-hueso-3">n={d.n}</td>
                          <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono text-meta tabular-nums ${c}`}>{num(d.reachMedio)}</td>
                          <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono text-meta tabular-nums ${c}`} title="Guardados sobre alcance">
                            {pct(d.saveRate)}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono text-meta tabular-nums ${c}`} title="Compartidos sobre alcance">
                            {flojo ? 'insuficiente' : pct(d.shareRate)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
