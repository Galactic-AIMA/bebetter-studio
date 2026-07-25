import { X, Music, Sparkles, Check, AlertCircle, Play, Pause } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { audioApi, AudioTrack } from '../../api'

interface Props {
  onClose: () => void
}

// Taxonomía de mood compartida con el backend (slugs sin acento + etiqueta bonita).
const MOODS = [
  { slug: 'reflexivo', label: 'Reflexivo / íntimo' },
  { slug: 'melancolico', label: 'Melancólico' },
  { slug: 'esperanzador', label: 'Esperanzador' },
  { slug: 'motivador', label: 'Motivador' },
  { slug: 'epico', label: 'Épico / heroico' },
  { slug: 'tenso', label: 'Tenso / oscuro' },
]

interface Draft {
  energia: number
  moodCategory: string
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
      setDrafts((prev) => {
        const next = { ...prev }
        for (const t of list) {
          if (!next[t.filename]) {
            next[t.filename] = {
              energia: t.energia ?? 5,
              moodCategory: t.moodCategory ?? 'motivador',
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
          next[p.filename] = { energia: p.energia, moodCategory: p.moodCategory, descripcion: p.descripcion }
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
      await audioApi.saveTags(filename, d.energia, d.moodCategory, d.descripcion)
      setSavedOk((s) => ({ ...s, [filename]: true }))
      setTracks((ts) =>
        ts.map((t) =>
          t.filename === filename
            ? { ...t, energia: d.energia, moodCategory: d.moodCategory, descripcion: d.descripcion, analyzed: true }
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-2xl bg-carbon-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-carbon-700 shrink-0">
          <Music size={15} className="text-gold-500" />
          <h2 className="text-sm font-semibold tracking-wide text-bone-500">Audio — energía y mood</h2>
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

        <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-2.5">
          {loading ? (
            <p className="text-bone-700 text-xs">Cargando…</p>
          ) : tracks.length === 0 ? (
            <p className="text-bone-700 text-xs">
              No hay pistas en <code>data/audio/</code>. Descarga pistas royalty-free ahí y recarga.
            </p>
          ) : (
            tracks.map((t) => {
              const d = drafts[t.filename]
              if (!d) return null
              return (
                <div key={t.filename} className="bg-carbon-900/60 rounded-lg px-3 py-2.5 border border-carbon-700 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => togglePlay(t.filename)}
                      title={playing === t.filename ? 'Pausar' : 'Escuchar pista'}
                      className="shrink-0 p-1 rounded bg-carbon-700 text-bone-500 hover:text-gold-500 transition-colors"
                    >
                      {playing === t.filename ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <span className="text-[12px] text-bone-500 flex-1 min-w-0 truncate">{t.name}</span>
                    {!t.analyzed && (
                      <span className="text-[10px] text-gold-500 bg-gold-500/10 px-1.5 py-0.5 rounded shrink-0">sin etiquetar</span>
                    )}
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
                    {/* Mood */}
                    <select
                      value={d.moodCategory}
                      onChange={(e) => patch(t.filename, { moodCategory: e.target.value })}
                      className="bg-carbon-900 border border-carbon-600 rounded-lg px-2 py-1 text-[11px] text-bone-500 focus:border-gold-500 outline-none"
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
