import React, { useState, useRef, useEffect, useId } from 'react'
import {
  CaretDown, Play, Pause, X, Plus,
  TextAlignLeft, TextAlignCenter, TextAlignRight, type Icon,
} from '@phosphor-icons/react'
import { useVideoStore } from '../../store/videoStore'
import { TransitionType, TextAlign, TextEffect, VisualStyle } from '../../types'
import { PRESETS } from '../../presets'
import { usePresets, PresetConfig } from '../../hooks/usePresets'
import { FONT_FAMILIES, FontStyleKey, parseFontKey } from '../../config/fonts'
import { audioApi, AudioTrack, AutoPick } from '../../api'

const VISUAL_STYLES = Object.entries(PRESETS) as [VisualStyle, (typeof PRESETS)[VisualStyle]][]

const STYLE_LABELS: { key: FontStyleKey; label: string }[] = [
  { key: 'Regular', label: 'Normal' },
  { key: 'Thin',    label: 'Thin'   },
  { key: 'Italic',  label: 'Italic' },
  { key: 'Bold',    label: 'Bold'   },
]

const TRANSITIONS: { value: TransitionType; label: string }[] = [
  { value: 'fadeBlack', label: 'Fade desde negro' },
  { value: 'fade',      label: 'Fade suave' },
  { value: 'none',      label: 'Sin transición' },
]

const TEXT_EFFECTS: { value: TextEffect; label: string }[] = [
  { value: 'none',      label: 'Sin efecto' },
  { value: 'fadeIn',    label: 'Fade in' },
  { value: 'slideUp',   label: 'Deslizar' },
  { value: 'glowPulse', label: 'Glow' },
]

const ALIGN_ICONS: Record<TextAlign, { icon: Icon; label: string }> = {
  left:   { icon: TextAlignLeft,   label: 'Izquierda' },
  center: { icon: TextAlignCenter, label: 'Centro' },
  right:  { icon: TextAlignRight,  label: 'Derecha' },
}

/* ── Piezas del inspector ────────────────────────────────────────────────────
   Lo elegido se marca con LUZ (fondo s2 + borde oro), nunca con lacre: el lacre
   significa error o giro (DESIGN.md §2). */

function SectionPanel({
  label, isOpen, onToggle, children,
}: {
  label: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <section className="border-b border-linea">
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-4 py-3 text-hueso-3 transition-colors duration-rapido ease-mesa hover:text-hueso"
      >
        <span className="font-cond text-label font-medium uppercase">{label}</span>
        <CaretDown
          size={14}
          className={`transition-transform duration-base ease-mesa ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && <div className="flex flex-col gap-3.5 px-4 pb-4">{children}</div>}
    </section>
  )
}

/** Grupo de opciones excluyentes. */
function Segmentos<T extends string>({
  label, value, options, onChange, cols,
}: {
  label?: string
  value: T
  options: { value: T; label: React.ReactNode; aria?: string; disabled?: boolean }[]
  onChange: (v: T) => void
  cols?: number
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-ui text-hueso-3">{label}</span>}
      <div
        role="radiogroup"
        aria-label={label}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols ?? options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => {
          const activo = o.value === value && !o.disabled
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={activo}
              aria-label={o.aria}
              disabled={o.disabled}
              onClick={() => !o.disabled && onChange(o.value)}
              className={`flex h-8 items-center justify-center rounded-control border px-1.5 text-ui transition-colors duration-rapido ease-mesa disabled:cursor-not-allowed disabled:opacity-30 ${
                activo
                  ? 'border-oro/60 bg-s2 text-hueso'
                  : 'border-linea-2 text-hueso-2 hover:bg-s2 hover:text-hueso'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Deslizador con su valor en Mono a la derecha. */
function Rango({
  label, valor, min, max, step = 1, value, onChange,
}: {
  label: string; valor: string; min: number; max: number; step?: number
  value: number; onChange: (n: number) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-baseline justify-between text-ui text-hueso-3">
        {label}
        <span className="font-mono text-meta text-hueso-2">{valor}</span>
      </label>
      <input
        id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-oro"
      />
    </div>
  )
}

/** Interruptor 34×20 (DESIGN.md §6): apagado s3, encendido oro al 28 % con perilla oro. */
function Interruptor({
  label, checked, onChange, children,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void; children?: React.ReactNode
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex items-center gap-2.5 text-ui text-hueso"
      >
        <span
          className={`relative h-5 w-[34px] shrink-0 rounded-full transition-colors duration-rapido ease-mesa ${
            checked ? 'bg-oro/30' : 'bg-s3'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-transform duration-rapido ease-mesa ${
              checked ? 'translate-x-[14px] bg-oro' : 'bg-hueso-3'
            }`}
          />
        </span>
        {label}
      </button>
      {children}
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-ui text-hueso-3">{label}</span>
      {children}
    </label>
  )
}

const selectCls = 'campo text-ui py-1.5'
const colorCls = 'h-8 w-full cursor-pointer rounded-control border border-borde-control bg-sala p-0.5'

export default function VideoEditor() {
  const { config, mode, selectedPhraseId, setText, setConfig, setWatermark, setTextEffect, applyPreset, applyConfig } = useVideoStore()
  const { text, duration, transition, transitionDuration, watermark, textEffect, visualStyle, grain, audioTrack } = config
  const { presets, savePreset, removePreset } = usePresets()
  const [savingName, setSavingName] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set(['frase', 'tipografia', 'video']))
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [autoPick, setAutoPick] = useState<AutoPick | null>(null)
  const [autoPickLoading, setAutoPickLoading] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const lastStrokeWidthRef = useRef(2)

  useEffect(() => {
    audioApi.list().then(setAudioTracks).catch(() => setAudioTracks([]))
  }, [])

  // Preview del "Auto (por mood)": muestra qué pista se elegiría ANTES de generar.
  useEffect(() => {
    if (audioTrack !== 'auto' || !selectedPhraseId) { setAutoPick(null); return }
    setAutoPickLoading(true)
    audioApi.pick(selectedPhraseId)
      .then(setAutoPick)
      .catch(() => setAutoPick(null))
      .finally(() => setAutoPickLoading(false))
  }, [audioTrack, selectedPhraseId])

  // Archivo a reproducir en el preview: la pista fija, o la auto-elegida en modo "auto".
  const previewFile = audioTrack === 'auto' ? autoPick?.filename : (audioTrack && audioTrack !== 'auto' ? audioTrack : undefined)

  // Al cambiar de pista (o de auto-elegida), detener cualquier preview en curso.
  useEffect(() => {
    const el = audioRef.current
    if (el) { el.pause(); el.currentTime = 0 }
    setAudioPlaying(false)
  }, [previewFile])

  function toggleAudioPreview() {
    const el = audioRef.current
    if (!el) return
    if (audioPlaying) el.pause()
    else el.play().catch(() => {})
  }

  const toggle = (id: string) =>
    setOpen(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const { family: currentFamily, style: currentStyle } = parseFontKey(text.font)
  const familyDef = FONT_FAMILIES.find(f => f.key === currentFamily)

  const handleFamilyChange = (familyKey: string) => {
    const fam = FONT_FAMILIES.find(f => f.key === familyKey)!
    const styleOk = !!fam.variants[currentStyle as FontStyleKey]
    setText({ font: `${familyKey}-${styleOk ? currentStyle : 'Regular'}` })
  }

  const handleStyleChange = (style: FontStyleKey) => {
    setText({ font: `${currentFamily}-${style}` })
  }

  const handleStrokeToggle = (checked: boolean) => {
    if (checked) {
      setText({ strokeWidth: lastStrokeWidthRef.current })
    } else {
      if ((text.strokeWidth ?? 0) > 0) lastStrokeWidthRef.current = text.strokeWidth!
      setText({ strokeWidth: 0 })
    }
  }

  const handleSave = () => {
    if (savingName === null) { setSavingName(''); return }
    if (!savingName.trim()) { setSavingName(null); return }
    const { content: _content, ...textWithoutContent } = text
    const presetConfig: PresetConfig = {
      text: textWithoutContent,
      textEffect: textEffect ?? 'none',
      visualStyle,
      watermark,
      duration,
      transition,
      transitionDuration,
    }
    savePreset(savingName, presetConfig)
    setSavingName(null)
  }

  const strokeEnabled = (text.strokeWidth ?? 0) > 0
  const alinear = (['left', 'center', 'right'] as TextAlign[]).map((a) => {
    const { icon: Icono, label } = ALIGN_ICONS[a]
    return { value: a, label: <Icono size={16} />, aria: label }
  })

  return (
    <div className="flex flex-col">

      {/* Estilo visual */}
      <SectionPanel label="Estilo visual" isOpen={open.has('estilos')} onToggle={() => toggle('estilos')}>
        <Segmentos
          value={visualStyle as VisualStyle}
          cols={3}
          options={VISUAL_STYLES.map(([key, preset]) => ({ value: key, label: preset.label }))}
          onChange={(k) => applyPreset(k)}
        />
      </SectionPanel>

      {/* Mis presets */}
      <SectionPanel label="Mis presets" isOpen={open.has('presets')} onToggle={() => toggle('presets')}>
        {savingName !== null ? (
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSavingName(null) }}
              placeholder="Nombre del preset"
              aria-label="Nombre del preset"
              className="campo text-ui"
            />
            <button onClick={handleSave} disabled={!savingName.trim()} className="btn-sec shrink-0">Guardar</button>
            <button onClick={() => setSavingName(null)} className="btn-fantasma shrink-0" aria-label="Cancelar">
              <X size={16} />
            </button>
          </div>
        ) : (
          <button onClick={handleSave} className="btn-fantasma self-start">
            <Plus size={16} /> Guardar el ajuste actual
          </button>
        )}
        {presets.length === 0 ? (
          savingName === null && <p className="text-ui text-hueso-3">Aún no has guardado ninguno.</p>
        ) : (
          <ul className="flex flex-col">
            {presets.map((p) => (
              <li key={p.id} className="group flex items-center border-b border-linea last:border-0">
                <button
                  onClick={() => applyConfig(p.config)}
                  className="h-8 flex-1 truncate rounded-control px-2 text-left text-ui text-hueso transition-colors duration-rapido ease-mesa hover:bg-s2"
                >
                  {p.name}
                </button>
                <button
                  onClick={() => removePreset(p.id)}
                  className="btn-fantasma p-1.5 opacity-0 hover:text-lacre focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Eliminar preset ${p.name}`}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>

      {/* Frase */}
      <SectionPanel label="Frase" isOpen={open.has('frase')} onToggle={() => toggle('frase')}>
        <textarea
          className="campo resize-none"
          rows={3}
          value={text.content}
          onChange={(e) => setText({ content: e.target.value })}
          placeholder="Escribe la frase. Marca el giro con //"
          aria-label="Texto de la frase"
        />
      </SectionPanel>

      {/* Tipografía */}
      <SectionPanel label="Tipografía" isOpen={open.has('tipografia')} onToggle={() => toggle('tipografia')}>
        <Campo label="Fuente">
          <select className={selectCls} value={currentFamily} onChange={(e) => handleFamilyChange(e.target.value)}>
            {FONT_FAMILIES.map((f) => (
              <option key={f.key} value={f.key}>{f.displayName}</option>
            ))}
          </select>
        </Campo>

        <Segmentos
          label="Estilo"
          value={currentStyle as FontStyleKey}
          options={STYLE_LABELS.map(({ key, label }) => ({ value: key, label, disabled: !familyDef?.variants[key] }))}
          onChange={handleStyleChange}
        />

        <div className="grid grid-cols-2 gap-3">
          <Rango label="Tamaño" valor={`${text.fontSize} px`} min={24} max={120}
            value={text.fontSize} onChange={(n) => setText({ fontSize: n })} />
          <Rango label="Espaciado" valor={`${text.letterSpacing ?? 0} px`} min={-5} max={30}
            value={text.letterSpacing ?? 0} onChange={(n) => setText({ letterSpacing: n })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Color">
            <input type="color" value={text.color} onChange={(e) => setText({ color: e.target.value })} className={colorCls} />
          </Campo>
          <Segmentos label="Alineación" value={text.align} options={alinear} onChange={(a) => setText({ align: a })} />
        </div>

        <Interruptor label="Contorno" checked={strokeEnabled} onChange={handleStrokeToggle}>
          {strokeEnabled && (
            <input
              type="color"
              value={text.strokeColor ?? '#000000'}
              onChange={(e) => setText({ strokeColor: e.target.value })}
              aria-label="Color del contorno"
              className={`${colorCls} w-12`}
            />
          )}
        </Interruptor>
        {strokeEnabled && (
          <Rango label="Grosor" valor={`${text.strokeWidth} px`} min={1} max={15}
            value={text.strokeWidth ?? 1} onChange={(n) => setText({ strokeWidth: n })} />
        )}
      </SectionPanel>

      {/* Posición */}
      <SectionPanel label="Posición" isOpen={open.has('posicion')} onToggle={() => toggle('posicion')}>
        <div className="grid grid-cols-2 gap-3">
          <Rango label="Horizontal" valor={`${text.position.x} %`} min={0} max={100}
            value={text.position.x} onChange={(n) => setText({ position: { ...text.position, x: n } })} />
          <Rango label="Vertical" valor={`${text.position.y} %`} min={5} max={95}
            value={text.position.y} onChange={(n) => setText({ position: { ...text.position, y: n } })} />
          <Rango label="Ancho máx." valor={`${text.maxWidth} %`} min={30} max={95}
            value={text.maxWidth} onChange={(n) => setText({ maxWidth: n })} />
          <Rango label="Interlineado" valor={text.lineHeight.toFixed(1)} min={0.8} max={2.5} step={0.1}
            value={text.lineHeight} onChange={(n) => setText({ lineHeight: n })} />
        </div>
        <Interruptor label="Sombra" checked={text.shadow} onChange={(v) => setText({ shadow: v })} />
      </SectionPanel>

      {/* Efectos */}
      <SectionPanel label="Efectos" isOpen={open.has('efectos')} onToggle={() => toggle('efectos')}>
        <Segmentos
          label="Efecto de texto"
          value={(textEffect ?? 'none') as TextEffect}
          cols={2}
          options={TEXT_EFFECTS.map((ef) => ({ value: ef.value, label: ef.label }))}
          onChange={setTextEffect}
        />
        <Interruptor label="Grano cinematográfico" checked={grain ?? false} onChange={(v) => setConfig({ grain: v })} />
      </SectionPanel>

      {/* Video */}
      <SectionPanel label="Video" isOpen={open.has('video')} onToggle={() => toggle('video')}>
        <Segmentos
          label="Formato"
          value={config.resolution.height === 1080 ? '1:1' : '9:16'}
          options={[{ value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }]}
          onChange={(r) => setConfig({ resolution: r === '1:1' ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 } })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Rango label="Duración" valor={`${duration} s`} min={5} max={30}
            value={duration} onChange={(n) => setConfig({ duration: n })} />
          <Campo label="Transición">
            <select className={selectCls} value={transition} onChange={(e) => setConfig({ transition: e.target.value as TransitionType })}>
              {TRANSITIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Campo>
        </div>
        {transition !== 'none' && (
          <Rango label="Duración de la transición" valor={`${transitionDuration} s`} min={0.3} max={2} step={0.1}
            value={transitionDuration} onChange={(n) => setConfig({ transitionDuration: n })} />
        )}
      </SectionPanel>

      {/* Audio de fondo (solo video) */}
      {mode === 'video' && (
        <SectionPanel label="Audio de fondo" isOpen={open.has('audio')} onToggle={() => toggle('audio')}>
          <div className="flex items-center gap-1.5">
            {/* min-w-0: sin él, una opción larga fija el ancho mínimo del select
                y desborda el panel derecho con scroll horizontal. */}
            <select
              className={`${selectCls} min-w-0 flex-1`}
              value={audioTrack ?? ''}
              onChange={(e) => setConfig({ audioTrack: e.target.value })}
              aria-label="Pista de audio"
            >
              <option value="">Sin audio</option>
              <option value="auto">Auto (rotando)</option>
              {audioTracks.map((t) => (
                <option key={t.filename} value={t.filename}>
                  {t.textura ? `${t.textura} · e${t.energia} · …${t.filename.slice(-10, -4)}` : t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={toggleAudioPreview}
              disabled={!previewFile}
              aria-label={audioPlaying ? 'Pausar la pista' : 'Escuchar la pista'}
              title={previewFile ? undefined : 'Elige una pista, o una frase si está en Auto'}
              className="btn-sec w-8 shrink-0 px-0"
            >
              {audioPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
          </div>
          <audio
            ref={audioRef}
            src={previewFile ? `/api/audio/file/${encodeURIComponent(previewFile)}` : undefined}
            onPlay={() => setAudioPlaying(true)}
            onPause={() => setAudioPlaying(false)}
            onEnded={() => setAudioPlaying(false)}
          />
          {audioTrack === 'auto' && (
            !selectedPhraseId ? (
              <p className="text-ui text-hueso-3">Elige una frase del banco para ver y oír la pista que saldrá.</p>
            ) : autoPickLoading ? (
              <p className="text-ui text-hueso-3">Buscando la pista que mejor encaja…</p>
            ) : autoPick ? (
              <p className="break-words text-ui text-hueso-2">
                Saldrá <span className="text-hueso">{autoPick.textura ?? 'sin textura'}</span>
                <span className="font-mono text-meta text-hueso-3"> · energía {autoPick.energia}</span>.
                Escúchala antes de generar.
              </p>
            ) : (
              <p className="text-ui text-hueso-3">No hay pistas etiquetadas para emparejar. Etiquétalas en Banco · Audio.</p>
            )
          )}
          {audioTracks.length === 0 && (
            <p className="text-ui text-hueso-3">
              No hay pistas en <span className="font-mono text-meta text-hueso-2">data/audio/</span>. Agrega archivos .mp3 libres de derechos.
            </p>
          )}
        </SectionPanel>
      )}

      {/* Marca de agua */}
      <SectionPanel label="Marca de agua" isOpen={open.has('watermark')} onToggle={() => toggle('watermark')}>
        <Interruptor label="Activar" checked={watermark?.enabled ?? false} onChange={(v) => setWatermark({ enabled: v })} />
        {watermark?.enabled && (
          <>
            <Segmentos
              label="Tipo"
              value={watermark.type ?? 'text'}
              options={[{ value: 'image', label: 'Imagen' }, { value: 'text', label: 'Texto' }]}
              onChange={(t) => setWatermark({ type: t })}
            />
            {(watermark.type ?? 'text') === 'text' && (
              <input
                type="text"
                value={watermark.text ?? '@bebetter.path'}
                onChange={(e) => setWatermark({ text: e.target.value })}
                aria-label="Texto de la marca de agua"
                className="campo text-ui"
              />
            )}
            <Segmentos
              label="Posición"
              value={watermark.position ?? 'right'}
              options={alinear}
              onChange={(p) => setWatermark({ position: p })}
            />
            <Rango label="Vertical" valor={`${watermark.y ?? 90} %`} min={0} max={100}
              value={watermark.y ?? 90} onChange={(n) => setWatermark({ y: n })} />
            {(watermark.type ?? 'text') === 'text' && (
              <Rango label="Opacidad" valor={`${Math.round((watermark.opacity ?? 0.35) * 100)} %`} min={5} max={100}
                value={Math.round((watermark.opacity ?? 0.35) * 100)} onChange={(n) => setWatermark({ opacity: n / 100 })} />
            )}
          </>
        )}
      </SectionPanel>

    </div>
  )
}
