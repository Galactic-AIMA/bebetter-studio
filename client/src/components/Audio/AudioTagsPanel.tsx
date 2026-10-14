import { X, Sparkle, Check, WarningCircle, Play, Pause, DownloadSimple, ArrowSquareOut } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { audioApi, AudioTrack } from '../../api'
import PanelDeslizante from '../ui/PanelDeslizante'
import { Rango, Campo } from '../ui/mesa'

interface Props {
  onClose: () => void
}

// Taxonomía de mood compartida con el backend (slugs sin acento + etiqueta bonita).
// Ya NO decide qué pista suena en cada reel: es dato informativo (ver TEXTURAS).
const MOODS = [
  { slug: 'reflexivo', label: 'Reflexivo / íntimo' },
  { slug: 'melancolico', label: 'Melancólico' },
  { slug: 'esperanzador', label: 'Esperanzador' },
  { slug: 'motivador', label: 'Motivador' },
  { slug: 'epico', label: 'Épico / heroico' },
  { slug: 'tenso', label: 'Tenso / oscuro' },
]

// Familia sonora: CÓMO suena, no qué evoca. Es lo que reparte las pistas entre los
// reels, así que conviene juzgarla oyendo (botón de escuchar) y no por el nombre del archivo.
const TEXTURAS = [
  { slug: 'acustico', label: 'Acústico — guitarra, instrumento real' },
  { slug: 'etereo', label: 'Etéreo — sintes lentos, arpegios, pads' },
  { slug: 'pulsante', label: 'Pulsante — latido rítmico, hipnótico' },
  { slug: 'orquestal', label: 'Orquestal — metales, cuerdas, fanfarria' },
]

/**
 * Trocea lo pegado en el textarea: una URL por línea y sin los parámetros de
 * seguimiento (`?igsi=…`), que cambian en cada compartición y harían que el mismo
 * reel se cosechara dos veces.
 */
function urlsDe(texto: string): string[] {
  return texto.split(/\r?\n/).map((l) => l.trim().split('?')[0]).filter(Boolean)
}

interface Draft {
  energia: number
  moodCategory: string
  textura: string
  descripcion: string
}

export default function AudioTagsPanel({ onClose }: Props) {
  const [tracks, setTracks] = useState<AudioTrack[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [harvestUrl, setHarvestUrl] = useState('')
  const [harvesting, setHarvesting] = useState(false)
  const [savingSource, setSavingSource] = useState<string | null>(null)
  // Borradores de frase de origen, uno por REEL (clave = sourceUrl). No van en
  // `drafts` porque una pista tiene N procedencias: varios reels del nicho usan el
  // mismo tema y cada uno lleva su propia frase.
  const [srcDrafts, setSrcDrafts] = useState<Record<string, string>>({})
  // Última pista cosechada: se resalta para que David no tenga que buscarla en la
  // lista después de pegar el link.
  const [recien, setRecien] = useState<string | null>(null)
  // Resultado de la última cosecha (canción, tramo, tema repetido). No es un error:
  // va en su propio hueco para no teñir de rojo lo que salió bien.
  const [aviso, setAviso] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const togglePlay = (filename: string) => {
    const el = audioRef.current
    if (!el) return
    if (playing === filename) {
      el.pause()
      return
    }
    el.src = `/api/audio/file/${encodeURIComponent(filename)}`
    el.play().then(() => setPlaying(filename)).catch(() => setPlaying(null))
  }

  const load = async () => {
    setLoading(true)
    try {
      const list = await audioApi.list()
      setTracks(list)
      setSrcDrafts((prev) => {
        const next = { ...prev }
        for (const t of list) {
          for (const f of t.sources ?? []) {
            if (next[f.sourceUrl] === undefined) next[f.sourceUrl] = f.sourcePhrase ?? ''
          }
        }
        return next
      })
      setDrafts((prev) => {
        const next = { ...prev }
        for (const t of list) {
          if (!next[t.filename]) {
            next[t.filename] = {
              energia: t.energia ?? 5,
              moodCategory: t.moodCategory ?? 'motivador',
              textura: t.textura ?? 'etereo',
              descripcion: t.descripcion ?? '',
            }
          }
        }
        return next
      })
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const analyzeUntagged = async () => {
    setAnalyzing(true)
    setError(null)
    try {
      const { proposals, errors } = await audioApi.analyze()
      setDrafts((prev) => {
        const next = { ...prev }
        for (const p of proposals) {
          next[p.filename] = {
            energia: p.energia,
            moodCategory: p.moodCategory,
            // La IA propone; si no devuelve textura se conserva la que hubiera.
            textura: p.textura ?? next[p.filename]?.textura ?? 'etereo',
            descripcion: p.descripcion,
          }
        }
        return next
      })
      if (errors.length) setError(errors.join(' · '))
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  // Cosecha: baja el corte del reel y trae la frase leída de sus fotogramas. No la
  // guarda — cae en el campo de procedencia de la tarjeta para revisarla y
  // confirmarla, que es lo que mete el corte en el pool.
  const harvest = async () => {
    const urls = urlsDe(harvestUrl)
    if (urls.length === 0) return
    setHarvesting(true)
    setError(null)
    setAviso(null)
    try {
      if (urls.length === 1) {
        const r = await audioApi.harvest(urls[0])
        await load()
        // La propuesta de Gemini manda sobre lo que hubiera: es lo que David acaba
        // de pedir que se lea.
        setSrcDrafts((p) => ({ ...p, [r.sourceUrl]: r.proposedPhrase || p[r.sourceUrl] || '' }))
        setRecien(r.filename)
        const partes: string[] = []
        if (r.audioTitle) partes.push(`«${r.audioTitle}»${r.audioArtist ? ` de ${r.audioArtist}` : ''}`)
        if (r.startMs != null) partes.push(`entra en el ${(r.startMs / 1000).toFixed(1)}s del tema`)
        if (r.temaRepetido) partes.push('mismo tema que un reel ya cosechado: se reutiliza el corte')
        if (!r.proposedPhrase) partes.push('no se leyó texto en pantalla: escribe la frase a mano')
        setAviso(`Corte de ${r.durationSeg}s${partes.length ? ` · ${partes.join(' · ')}` : ' cosechado.'}`)
      } else {
        const { results, errors } = await audioApi.harvestBatch(urls)
        await load()
        setSrcDrafts((p) => {
          const next = { ...p }
          for (const r of results) next[r.sourceUrl] = r.proposedPhrase || next[r.sourceUrl] || ''
          return next
        })
        const sinTexto = results.filter((r) => !r.proposedPhrase).length
        const repes = results.filter((r) => r.temaRepetido).length
        setAviso(
          `${results.length}/${urls.length} cosechados` +
          (repes ? ` · ${repes} comparten tema con otro` : '') +
          (sinTexto ? ` · ${sinTexto} sin texto legible` : '') +
          ' · revisa y confirma las frases abajo'
        )
        if (errors.length) setError(errors.slice(0, 3).join(' · ') + (errors.length > 3 ? ` (+${errors.length - 3})` : ''))
      }
      setHarvestUrl('')
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setHarvesting(false)
    }
  }

  // Confirmar la procedencia es lo ÚNICO que mete un corte en el pool: sin frase
  // de origen vectorizada no suena, por muy etiquetado que esté.
  const saveSource = async (sourceUrl: string) => {
    const frase = srcDrafts[sourceUrl]?.trim()
    if (!frase) return
    setSavingSource(sourceUrl)
    setError(null)
    try {
      await audioApi.saveSource(sourceUrl, frase)
      await load()
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setSavingSource(null)
    }
  }

  // Quita un reel mal cosechado. NO borra el audio: puede estar sosteniendo las
  // procedencias de otros reels que comparten tema.
  const dropSource = async (sourceUrl: string) => {
    try {
      await audioApi.deleteSource(sourceUrl)
      await load()
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    }
  }

  const patch = (filename: string, p: Partial<Draft>) => {
    setSavedOk((s) => ({ ...s, [filename]: false }))
    setDrafts((prev) => ({ ...prev, [filename]: { ...prev[filename], ...p } }))
  }

  const save = async (filename: string) => {
    const d = drafts[filename]
    if (!d) return
    setSaving(filename)
    setError(null)
    try {
      await audioApi.saveTags(filename, d.energia, d.moodCategory, d.descripcion, d.textura)
      setSavedOk((s) => ({ ...s, [filename]: true }))
      setTracks((ts) =>
        ts.map((t) =>
          t.filename === filename
            ? { ...t, energia: d.energia, moodCategory: d.moodCategory, textura: d.textura, descripcion: d.descripcion, analyzed: true }
            : t
        )
      )
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setSaving(null)
    }
  }

  const untagged = tracks.filter((t) => !t.analyzed).length
  // Cuántos cortes pueden sonar. Desde el 18-ago manda la procedencia, no las
  // etiquetas: con 0 aquí, los reels salen SIN música por mucho banco que haya.
  const enPool = tracks.filter((t) => t.enPool).length
  // Cuántos links hay escritos en el textarea (para el rótulo del botón).
  const pendientes = urlsDe(harvestUrl).length

  const meta = (
    <span
      className={`shrink-0 font-mono text-meta tabular-nums ${enPool > 0 ? 'text-hueso-2' : 'text-lacre'}`}
      title="Cortes con frase de origen confirmada. Solo estos entran en el emparejamiento."
    >
      {enPool}/{tracks.length} en el pool
    </span>
  )

  return (
    <PanelDeslizante titulo="Audio" meta={meta} onClose={onClose}>
      {/* Cosecha con procedencia. Un reel del nicho es un corte que ALGUIEN YA
          ELIGIÓ para este tipo de contenido: esa es la señal que empareja, y no
          hay algoritmo que la deduzca de la música. */}
      <section className="flex flex-col gap-2 border-b border-linea px-5 py-4">
        <label htmlFor="cosecha" className="text-ui text-hueso-3">Cosechar de reels del nicho</label>
        <textarea
          id="cosecha"
          value={harvestUrl}
          onChange={(e) => setHarvestUrl(e.target.value)}
          rows={pendientes > 1 ? 4 : 2}
          placeholder="Pega links de reels, uno por línea"
          className="campo resize-y text-ui"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={harvest} disabled={harvesting || !harvestUrl.trim()} className="btn-sec">
            <DownloadSimple size={16} />
            {harvesting ? 'Cosechando…' : `Cosechar${pendientes > 1 ? ` (${pendientes})` : ''}`}
          </button>
          <button
            onClick={analyzeUntagged}
            disabled={analyzing || loading || untagged === 0}
            title="Analiza con IA las pistas sin etiquetar y propone energía, textura y mood para confirmar"
            className="btn-fantasma ml-auto h-10 px-1 lg:h-8"
          >
            <Sparkle size={16} />
            {analyzing ? 'Analizando…' : `Analizar sin etiquetar${untagged ? ` (${untagged})` : ''}`}
          </button>
        </div>
        <div aria-live="polite" className="text-meta">
          {error ? (
            <p role="alert" className="flex items-start gap-1.5 text-ui text-lacre"><WarningCircle size={16} className="mt-0.5 shrink-0" /> {error}</p>
          ) : aviso ? (
            <p className="flex items-start gap-1.5 text-ui text-hueso-2"><Check size={16} className="mt-0.5 shrink-0 text-oro" /> {aviso}</p>
          ) : (
            <p className="text-hueso-3">
              Baja el corte tal cual suena en el reel y lee su frase en pantalla. Revísala antes de
              confirmar: la frase de origen es lo que empareja.
            </p>
          )}
        </div>
      </section>

      {loading ? (
        <p className="px-5 py-6 text-ui text-hueso-3">Cargando los cortes…</p>
      ) : tracks.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-5 py-10">
          <p className="pt-[.16em] font-display text-display uppercase text-hueso">Sin música</p>
          <p className="text-body text-hueso-2">Pega arriba el link de un reel del nicho para cosechar el primer corte.</p>
        </div>
      ) : (
        <ul>
          {tracks.map((t) => {
            const d = drafts[t.filename]
            if (!d) return null
            const titulo = t.sources?.find((f) => f.audioTitle)?.audioTitle ?? t.name
            const artista = t.sources?.find((f) => f.audioArtist)?.audioArtist
            return (
              <li
                key={t.filename}
                className={`flex flex-col gap-3 border-b border-linea px-5 py-4 ${recien === t.filename ? 'bg-s2' : ''}`}
              >
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => togglePlay(t.filename)}
                    aria-label={playing === t.filename ? `Pausar ${titulo}` : `Escuchar ${titulo}`}
                    aria-pressed={playing === t.filename}
                    className="btn-sec w-10 shrink-0 px-0 lg:w-8"
                  >
                    {playing === t.filename ? <Pause size={16} weight="fill" className="text-oro" /> : <Play size={16} />}
                  </button>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-ui text-hueso">{titulo}</span>
                    <span className="flex flex-wrap gap-x-2 font-mono text-meta text-hueso-3">
                      {artista && <span className="truncate font-sans">{artista}</span>}
                      {recien === t.filename && <span className="text-oro">recién cosechado</span>}
                      {(t.sources?.length ?? 0) > 1 && (
                        <span title="Reels del nicho distintos que usaron este mismo tema">{t.sources!.length} reels</span>
                      )}
                      {!t.enPool && (t.mergedInto
                        ? <span title={`Mismo tema que ${t.mergedInto}: su procedencia vive allí`}>duplicado</span>
                        : <span className="text-lacre" title="Sin frase de origen confirmada: este corte no puede sonar">fuera del pool</span>)}
                      {!t.analyzed && !t.mergedInto && <span>sin etiquetar</span>}
                    </span>
                  </span>
                </div>

                {/* Procedencia: el eje que empareja desde el 18-ago. Una pista
                    puede tener VARIOS reels de origen —varias cuentas del nicho
                    usando el mismo tema— y cada uno aporta su propia frase. */}
                <div className="flex flex-col gap-1.5">
                  {(t.sources ?? []).length === 0 && (
                    // Dos motivos MUY distintos para no tener procedencia; confundirlos
                    // hacía que el panel dijera que un corte recién cosechado
                    // «es anterior a la cosecha».
                    <p className="text-ui text-hueso-3">
                      {t.mergedInto
                        ? <>Es el mismo tema que <span className="text-hueso-2">{t.mergedInto}</span> y su frase de origen vive allí. Este archivo ya no se elige.</>
                        : 'Sin reel de origen: es anterior a la cosecha y no puede sonar.'}
                    </p>
                  )}
                  {(t.sources ?? []).map((f) => {
                    const borrador = (srcDrafts[f.sourceUrl] ?? '').trim()
                    const igual = borrador === (f.sourcePhrase ?? '')
                    return (
                      <div key={f.sourceUrl} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={srcDrafts[f.sourceUrl] ?? ''}
                          onChange={(e) => setSrcDrafts((p) => ({ ...p, [f.sourceUrl]: e.target.value }))}
                          placeholder="Frase que se leía en ese reel"
                          aria-label="Frase de origen"
                          title={`Contra esto se empareja. Reel: ${f.sourceUrl}`}
                          className="campo h-10 min-w-0 flex-1 py-0 text-ui lg:h-8"
                        />
                        <a
                          href={f.sourceUrl} target="_blank" rel="noreferrer"
                          aria-label="Abrir el reel de origen"
                          title={f.sourceUrl}
                          className="btn-fantasma grid h-10 w-8 shrink-0 place-items-center lg:h-8"
                        >
                          <ArrowSquareOut size={16} />
                        </a>
                        <button
                          onClick={() => saveSource(f.sourceUrl)}
                          disabled={savingSource === f.sourceUrl || !borrador || igual}
                          className="btn-sec shrink-0 px-2.5"
                        >
                          {savingSource === f.sourceUrl ? 'Vectorizando…' : f.confirmada && igual ? 'Confirmada' : 'Confirmar'}
                        </button>
                        <button
                          onClick={() => dropSource(f.sourceUrl)}
                          aria-label="Quitar este reel de origen"
                          title="Quitar este reel de origen (no borra el audio)"
                          className="btn-fantasma grid h-10 w-8 shrink-0 place-items-center hover:text-lacre lg:h-8"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )
                  })}
                </div>

                <Rango
                  label="Energía" valor={String(d.energia)} min={0} max={10}
                  value={d.energia} onChange={(n) => patch(t.filename, { energia: n })}
                />
                <div className="grid grid-cols-2 gap-2">
                  {/* La textura decide el reparto de pistas entre reels. */}
                  <Campo label="Textura">
                    <select
                      value={d.textura}
                      onChange={(e) => patch(t.filename, { textura: e.target.value })}
                      title="Familia sonora: es lo que evita que dos reels seguidos suenen igual"
                      className="campo h-10 py-0 text-ui lg:h-8"
                    >
                      {TEXTURAS.map((x) => <option key={x.slug} value={x.slug}>{x.label}</option>)}
                    </select>
                  </Campo>
                  {/* Mood: informativo desde 2026-08-03, ya no elige la pista. */}
                  <Campo label="Mood (informativo)">
                    <select
                      value={d.moodCategory}
                      onChange={(e) => patch(t.filename, { moodCategory: e.target.value })}
                      title="Dato informativo: ya no interviene en qué pista se elige"
                      className="campo h-10 py-0 text-ui lg:h-8"
                    >
                      {MOODS.map((m) => <option key={m.slug} value={m.slug}>{m.label}</option>)}
                    </select>
                  </Campo>
                </div>
                <input
                  type="text"
                  value={d.descripcion}
                  onChange={(e) => patch(t.filename, { descripcion: e.target.value })}
                  placeholder="Descripción: atmósfera, instrumentación"
                  aria-label="Descripción"
                  className="campo text-ui"
                />
                <div className="flex justify-end">
                  <button onClick={() => save(t.filename)} disabled={saving === t.filename} className="btn-sec">
                    {savedOk[t.filename] ? <><Check size={16} className="text-oro" /> Guardado</> : saving === t.filename ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Un solo elemento de audio; togglePlay fija `playing` al reproducir. */}
      <audio ref={audioRef} onPause={() => setPlaying(null)} onEnded={() => setPlaying(null)} />
    </PanelDeslizante>
  )
}
