import { X, Music, Sparkles, Check, AlertCircle, Play, Pause, Download, Link2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { audioApi, AudioTrack } from '../../api'

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
// reels, así que conviene juzgarla oyendo (botón ▶) y no por el nombre del archivo.
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
        if (r.audioTitle) partes.push(`🎵 ${r.audioTitle}${r.audioArtist ? ` — ${r.audioArtist}` : ''}`)
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-2xl bg-carbon-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-carbon-700 shrink-0">
          <Music size={15} className="text-gold-500" />
          <h2 className="text-sm font-semibold tracking-wide text-bone-500">Audio — cosecha y procedencia</h2>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${enPool > 0 ? 'text-gold-500 bg-gold-500/10' : 'text-neon-red bg-neon-red/10'}`}
            title="Cortes con frase de origen confirmada. Solo estos entran en el emparejamiento."
          >
            {enPool}/{tracks.length} en el pool
          </span>
          <button
            onClick={analyzeUntagged}
            disabled={analyzing || loading || untagged === 0}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-carbon-900 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 rounded-lg transition-colors font-medium"
            title="Analiza con IA las pistas sin etiquetar y propone energía/mood para confirmar"
          >
            <Sparkles size={12} />
            {analyzing ? 'Analizando…' : `Analizar sin etiquetar${untagged ? ` (${untagged})` : ''}`}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-carbon-700/80 text-bone-700 hover:text-bone-500 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Cosecha con procedencia. Un reel del nicho es un corte que ALGUIEN YA
            ELIGIÓ para este tipo de contenido: esa es la señal que empareja, y no
            hay algoritmo que la deduzca de la música. */}
        <div className="px-4 py-3 border-b border-carbon-700 shrink-0 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Link2 size={13} className="text-gold-500 shrink-0 self-start mt-2" />
            <textarea
              value={harvestUrl}
              onChange={(e) => setHarvestUrl(e.target.value)}
              rows={urlsDe(harvestUrl).length > 1 ? 4 : 1}
              placeholder="Pega links de reels del nicho, uno por línea…"
              className="flex-1 min-w-0 resize-y bg-carbon-900 border border-carbon-600 rounded-lg px-2 py-1.5 text-[11px] text-bone-500 focus:border-gold-500 outline-none"
            />
            <button
              onClick={harvest}
              disabled={harvesting || !harvestUrl.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-carbon-900 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 rounded-lg transition-colors font-medium shrink-0"
            >
              <Download size={12} />
              {harvesting
                ? 'Cosechando…'
                : `Cosechar${pendientes > 1 ? ` (${pendientes})` : ''}`}
            </button>
          </div>
          {aviso ? (
            <p className="text-[10px] text-gold-500">{aviso}</p>
          ) : (
            <p className="text-[10px] text-bone-700">
              Baja el corte tal cual suena en el reel y lee su frase en pantalla. Revisa lo que
              proponga antes de confirmar: la frase de origen es lo que empareja.
            </p>
          )}
        </div>

        <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-2.5">
          {loading ? (
            <p className="text-bone-700 text-xs">Cargando…</p>
          ) : tracks.length === 0 ? (
            <p className="text-bone-700 text-xs">
              No hay cortes en <code>data/audio/</code>. Pega arriba el link de un reel del nicho para cosechar el primero.
            </p>
          ) : (
            tracks.map((t) => {
              const d = drafts[t.filename]
              if (!d) return null
              return (
                <div
                  key={t.filename}
                  className={`bg-carbon-900/60 rounded-lg px-3 py-2.5 border flex flex-col gap-2 ${
                    recien === t.filename ? 'border-gold-500' : 'border-carbon-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => togglePlay(t.filename)}
                      title={playing === t.filename ? 'Pausar' : 'Escuchar pista'}
                      className="shrink-0 p-1 rounded bg-carbon-700 text-bone-500 hover:text-gold-500 transition-colors"
                    >
                      {playing === t.filename ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <span className="text-[12px] text-bone-500 min-w-0 truncate">
                      {t.sources?.find((f) => f.audioTitle)?.audioTitle ?? t.name}
                    </span>
                    {t.sources?.find((f) => f.audioArtist) && (
                      <span className="text-[10px] text-bone-700 truncate">
                        {t.sources.find((f) => f.audioArtist)!.audioArtist}
                      </span>
                    )}
                    <span className="flex-1" />
                    {(t.sources?.length ?? 0) > 1 && (
                      <span
                        className="text-[10px] text-gold-500 bg-gold-500/10 px-1.5 py-0.5 rounded shrink-0"
                        title="Reels del nicho distintos que usaron este mismo tema"
                      >
                        {t.sources!.length} reels
                      </span>
                    )}
                    {!t.enPool && (
                      t.mergedInto ? (
                        <span
                          className="text-[10px] text-bone-700 bg-carbon-700 px-1.5 py-0.5 rounded shrink-0"
                          title={`Mismo tema que ${t.mergedInto}: su procedencia vive allí`}
                        >
                          duplicado
                        </span>
                      ) : (
                        <span
                          className="text-[10px] text-neon-red bg-neon-red/10 px-1.5 py-0.5 rounded shrink-0"
                          title="Sin frase de origen confirmada: este corte no puede sonar"
                        >
                          fuera del pool
                        </span>
                      )
                    )}
                    {!t.analyzed && !t.mergedInto && (
                      <span className="text-[10px] text-bone-700 bg-carbon-700 px-1.5 py-0.5 rounded shrink-0">sin etiquetar</span>
                    )}
                  </div>

                  {/* Procedencia: el eje que empareja desde el 18-ago. Una pista
                      puede tener VARIOS reels de origen —varias cuentas del nicho
                      usando el mismo tema— y cada uno aporta su propia frase. */}
                  <div className="flex flex-col gap-1.5">
                    {(t.sources ?? []).length === 0 && (
                      // Dos motivos MUY distintos para no tener procedencia, y confundirlos
                      // hacía que el panel le dijera a David que un corte recién cosechado
                      // "es anterior a la cosecha".
                      t.mergedInto ? (
                        <p className="text-[10px] text-bone-700 italic">
                          Duplicado: es el mismo tema que <span className="text-bone-500">{t.mergedInto}</span>,
                          y su frase de origen vive allí. Este archivo ya no se elige.
                        </p>
                      ) : (
                        <p className="text-[10px] text-bone-700 italic">
                          Sin reel de origen. Este corte es anterior a la cosecha: no puede sonar.
                        </p>
                      )
                    )}
                    {(t.sources ?? []).map((f) => (
                      <div key={f.sourceUrl} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={srcDrafts[f.sourceUrl] ?? ''}
                          onChange={(e) => setSrcDrafts((p) => ({ ...p, [f.sourceUrl]: e.target.value }))}
                          placeholder="Frase que se leía en ese reel…"
                          title={`Contra esto se empareja. Reel: ${f.sourceUrl}`}
                          className="flex-1 min-w-0 bg-carbon-900 border border-carbon-600 rounded-lg px-2 py-1 text-[11px] text-bone-500 focus:border-gold-500 outline-none"
                        />
                        <a
                          href={f.sourceUrl} target="_blank" rel="noreferrer"
                          title={f.sourceUrl}
                          className="shrink-0 p-1 rounded bg-carbon-700 text-bone-700 hover:text-gold-500 transition-colors"
                        >
                          <Link2 size={11} />
                        </a>
                        <button
                          onClick={() => saveSource(f.sourceUrl)}
                          disabled={
                            savingSource === f.sourceUrl ||
                            !(srcDrafts[f.sourceUrl] ?? '').trim() ||
                            (srcDrafts[f.sourceUrl] ?? '').trim() === (f.sourcePhrase ?? '')
                          }
                          className="shrink-0 px-2.5 py-1 text-[11px] rounded-lg bg-carbon-700 text-bone-500 hover:bg-carbon-600 disabled:opacity-40 transition-colors"
                        >
                          {savingSource === f.sourceUrl
                            ? 'Vectorizando…'
                            : f.confirmada && (srcDrafts[f.sourceUrl] ?? '').trim() === (f.sourcePhrase ?? '')
                              ? 'Confirmada'
                              : 'Confirmar'}
                        </button>
                        <button
                          onClick={() => dropSource(f.sourceUrl)}
                          title="Quitar este reel de origen (no borra el audio)"
                          className="shrink-0 p-1 rounded bg-carbon-700 text-bone-700 hover:text-neon-red transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Energía */}
                    <label className="flex items-center gap-1.5 text-[11px] text-bone-700">
                      Energía
                      <input
                        type="range" min={0} max={10} step={1}
                        value={d.energia}
                        onChange={(e) => patch(t.filename, { energia: Number(e.target.value) })}
                        className="accent-gold-500"
                      />
                      <span className="tabular-nums text-bone-500 w-4">{d.energia}</span>
                    </label>
                    {/* Textura — decide el reparto de pistas entre reels */}
                    <select
                      value={d.textura}
                      onChange={(e) => patch(t.filename, { textura: e.target.value })}
                      title="Familia sonora: es lo que evita que dos reels seguidos suenen igual"
                      className="bg-carbon-900 border border-carbon-600 rounded-lg px-2 py-1 text-[11px] text-bone-500 focus:border-gold-500 outline-none"
                    >
                      {TEXTURAS.map((x) => (
                        <option key={x.slug} value={x.slug}>{x.label}</option>
                      ))}
                    </select>
                    {/* Mood — informativo desde 2026-08-03, ya no elige la pista */}
                    <select
                      value={d.moodCategory}
                      onChange={(e) => patch(t.filename, { moodCategory: e.target.value })}
                      title="Dato informativo: ya no interviene en qué pista se elige"
                      className="bg-carbon-900 border border-carbon-600 rounded-lg px-2 py-1 text-[11px] text-bone-700 focus:border-gold-500 outline-none"
                    >
                      {MOODS.map((m) => (
                        <option key={m.slug} value={m.slug}>{m.label}</option>
                      ))}
                    </select>
                    {/* Guardar */}
                    <button
                      onClick={() => save(t.filename)}
                      disabled={saving === t.filename}
                      className="ml-auto flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-carbon-700 text-bone-500 hover:bg-carbon-600 disabled:opacity-40 transition-colors"
                    >
                      {savedOk[t.filename] ? <><Check size={11} className="text-gold-500" /> Guardado</> : saving === t.filename ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={d.descripcion}
                    onChange={(e) => patch(t.filename, { descripcion: e.target.value })}
                    placeholder="Descripción (atmósfera, instrumentación)…"
                    className="bg-carbon-900 border border-carbon-600 rounded-lg px-2 py-1 text-[11px] text-bone-500 focus:border-gold-500 outline-none w-full"
                  />
                </div>
              )
            })
          )}

          {error && (
            <div className="flex items-start gap-1.5 text-[11px] text-neon-red">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Un solo elemento de audio; togglePlay fija `playing` al reproducir. */}
        <audio
          ref={audioRef}
          onPause={() => setPlaying(null)}
          onEnded={() => setPlaying(null)}
        />
      </div>
    </div>
  )
}
