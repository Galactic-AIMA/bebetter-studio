import React, { useState } from 'react'
import { useVideoStore } from '../../store/videoStore'
import { TransitionType, TextAlign, TextEffect, VisualStyle } from '../../types'
import { PRESETS } from '../../presets'
import { usePresets, PresetConfig } from '../../hooks/usePresets'

const VISUAL_STYLES = Object.entries(PRESETS) as [VisualStyle, (typeof PRESETS)[VisualStyle]][]

const FONTS = [
  'Montserrat-Bold',
  'Montserrat-Regular',
  'Playfair-Bold',
  'Lato-Regular',
  'Oswald-Bold',
  'RobotoCondensed-Bold',
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

const SectionHeader = ({ label }: { label: string }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-bone-700 mb-3">{label}</p>
)

const activeBtn = 'border-neon-red text-neon-red bg-carbon-700'
const idleBtn   = 'border-carbon-600 text-bone-700 bg-carbon-700 hover:text-bone-500 hover:border-bone-700'

export default function VideoEditor() {
  const { config, setText, setConfig, setWatermark, setTextEffect, applyPreset, applyConfig } = useVideoStore()
  const { text, duration, transition, transitionDuration, watermark, textEffect, visualStyle, grain } = config
  const { presets, savePreset, removePreset } = usePresets()
  const [savingName, setSavingName] = useState<string | null>(null)

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

  return (
    <div className="flex flex-col gap-5 p-4">

      {/* Estilo visual */}
      <section>
        <SectionHeader label="Estilo visual" />
        <div className="grid grid-cols-3 gap-1">
          {VISUAL_STYLES.map(([key, preset]) => (
            <button
              key={key}
              onClick={() => applyPreset(key as VisualStyle)}
              className={`py-1.5 rounded text-xs border transition-colors ${
                visualStyle === key ? activeBtn : idleBtn
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      {/* Mis presets */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <SectionHeader label="Mis presets" />
          <button
            onClick={handleSave}
            className="text-[10px] text-gold-500 hover:text-gold-600 transition-colors -mt-3"
          >
            {savingName === null ? '+ Guardar actual' : 'Cancelar'}
          </button>
        </div>

        {savingName !== null && (
          <div className="flex gap-2 mb-2">
            <input
              autoFocus
              type="text"
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSavingName(null) }}
              placeholder="Nombre del preset..."
              className="flex-1 bg-carbon-700 border border-carbon-600 rounded-lg px-3 py-1.5 text-xs text-bone-500 focus:outline-none focus:ring-1 focus:ring-neon-red placeholder:text-bone-700"
            />
            <button
              onClick={handleSave}
              disabled={!savingName.trim()}
              className="px-3 py-1.5 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 disabled:cursor-not-allowed text-carbon-900 text-xs rounded-lg transition-colors font-medium"
            >
              Guardar
            </button>
          </div>
        )}

        {presets.length === 0 && savingName === null ? (
          <p className="text-xs text-bone-700">No hay presets guardados.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {presets.map((p) => (
              <div key={p.id} className="flex items-center gap-2 group">
                <button
                  onClick={() => applyConfig(p.config)}
                  className="flex-1 text-left px-3 py-1.5 rounded-lg bg-carbon-700 border border-carbon-600 hover:border-bone-700 text-xs text-bone-500 transition-colors truncate"
                >
                  {p.name}
                </button>
                <button
                  onClick={() => removePreset(p.id)}
                  className="opacity-0 group-hover:opacity-100 text-bone-700 hover:text-neon-red transition-all text-xs px-1"
                  title="Eliminar"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Frase */}
      <section>
        <SectionHeader label="Frase" />
        <textarea
          className="w-full bg-[#1C1C1C] border border-white/10 rounded-lg p-3 text-sm text-[#E8E4DC] resize-none focus:outline-none focus:ring-0 focus:border-white/30 placeholder:text-[#E8E4DC]/40"
          rows={3}
          value={text.content}
          onChange={(e) => setText({ content: e.target.value })}
          placeholder="Escribe tu frase..."
        />
      </section>

      {/* Tipografía */}
      <section>
        <SectionHeader label="Tipografía" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Fuente</label>
            <select
              className="w-full bg-carbon-700 border border-carbon-600 rounded-lg p-2 text-xs text-bone-500"
              value={text.font}
              onChange={(e) => setText({ font: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>{f.replace(/-/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Tamaño: {text.fontSize}px</label>
            <input type="range" min={24} max={120} value={text.fontSize}
              onChange={(e) => setText({ fontSize: Number(e.target.value) })}
              className="w-full accent-gold-500"
            />
          </div>
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Color</label>
            <input type="color" value={text.color}
              onChange={(e) => setText({ color: e.target.value })}
              className="w-full h-9 rounded-lg bg-carbon-700 border border-carbon-600 cursor-pointer"
            />
          </div>
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Alineación</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
                <button key={a} onClick={() => setText({ align: a })}
                  className={`flex-1 py-1 rounded text-xs border transition-colors ${text.align === a ? activeBtn : idleBtn}`}
                >
                  {a === 'left' ? '←' : a === 'center' ? '↔' : '→'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Posición */}
      <section>
        <SectionHeader label="Posición" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Horizontal: {text.position.x}%</label>
            <input type="range" min={0} max={100} value={text.position.x}
              onChange={(e) => setText({ position: { ...text.position, x: Number(e.target.value) } })}
              className="w-full accent-gold-500"
            />
          </div>
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Vertical: {text.position.y}%</label>
            <input type="range" min={5} max={95} value={text.position.y}
              onChange={(e) => setText({ position: { ...text.position, y: Number(e.target.value) } })}
              className="w-full accent-gold-500"
            />
          </div>
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Ancho máx: {text.maxWidth}%</label>
            <input type="range" min={30} max={95} value={text.maxWidth}
              onChange={(e) => setText({ maxWidth: Number(e.target.value) })}
              className="w-full accent-gold-500"
            />
          </div>
          <div className="flex items-center gap-2 pt-3">
            <input type="checkbox" id="shadow" checked={text.shadow}
              onChange={(e) => setText({ shadow: e.target.checked })}
              className="accent-gold-500"
            />
            <label htmlFor="shadow" className="text-xs text-bone-500">Sombra</label>
          </div>
        </div>
      </section>

      {/* Efectos */}
      <section>
        <SectionHeader label="Efectos" />
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Efecto de texto</label>
            <div className="grid grid-cols-2 gap-1">
              {TEXT_EFFECTS.map((ef) => (
                <button key={ef.value} onClick={() => setTextEffect(ef.value)}
                  className={`py-1.5 rounded text-xs border transition-colors ${textEffect === ef.value ? activeBtn : idleBtn}`}
                >
                  {ef.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="grain" checked={grain ?? false}
              onChange={(e) => setConfig({ grain: e.target.checked })}
              className="accent-gold-500"
            />
            <label htmlFor="grain" className="text-xs text-bone-500">Grano cinematográfico</label>
          </div>
        </div>
      </section>

      {/* Video */}
      <section>
        <SectionHeader label="Video" />
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-bone-700 mb-1 block">Resolución</label>
            <div className="flex gap-1">
              {([{ label: '9:16', w: 1080, h: 1920 }, { label: '1:1', w: 1080, h: 1080 }] as const).map((r) => {
                const active = config.resolution.width === r.w && config.resolution.height === r.h
                return (
                  <button key={r.label}
                    onClick={() => setConfig({ resolution: { width: r.w, height: r.h } })}
                    className={`flex-1 py-1 rounded text-xs border transition-colors ${active ? activeBtn : idleBtn}`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Duración: {duration}s</label>
            <input type="range" min={5} max={30} value={duration}
              onChange={(e) => setConfig({ duration: Number(e.target.value) })}
              className="w-full accent-gold-500"
            />
          </div>
          <div>
            <label className="text-xs text-bone-700 mb-1 block">Transición</label>
            <select
              className="w-full bg-carbon-700 border border-carbon-600 rounded-lg p-2 text-xs text-bone-500"
              value={transition}
              onChange={(e) => setConfig({ transition: e.target.value as TransitionType })}
            >
              {TRANSITIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {transition !== 'none' && (
            <div className="col-span-2">
              <label className="text-xs text-bone-700 mb-1 block">
                Dur. transición: {transitionDuration}s
              </label>
              <input type="range" min={0.3} max={2} step={0.1} value={transitionDuration}
                onChange={(e) => setConfig({ transitionDuration: Number(e.target.value) })}
                className="w-full accent-gold-500"
              />
            </div>
          )}
        </div>
      </section>

      {/* Watermark */}
      <section>
        <SectionHeader label="Marca de agua" />
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="wm-enabled" checked={watermark?.enabled ?? false}
              onChange={(e) => setWatermark({ enabled: e.target.checked })}
              className="accent-gold-500"
            />
            <label htmlFor="wm-enabled" className="text-xs text-bone-500">Activar watermark</label>
          </div>
          {watermark?.enabled && (
            <>
              {/* Tipo */}
              <div className="grid grid-cols-2 gap-1">
                {(['image', 'text'] as const).map((t) => (
                  <button key={t} onClick={() => setWatermark({ type: t })}
                    className={`py-1.5 rounded text-xs border transition-colors ${(watermark.type ?? 'text') === t ? activeBtn : idleBtn}`}
                  >
                    {t === 'image' ? 'Imagen' : 'Texto'}
                  </button>
                ))}
              </div>
              {/* Handle (solo texto) */}
              {(watermark.type ?? 'text') === 'text' && (
                <input
                  type="text"
                  value={watermark.text ?? '@bebetter.path'}
                  onChange={(e) => setWatermark({ text: e.target.value })}
                  className="w-full bg-[#1C1C1C] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-[#E8E4DC] focus:outline-none focus:ring-0 focus:border-white/30"
                />
              )}
              {/* Posición horizontal */}
              <div className="grid grid-cols-3 gap-1">
                {(['left', 'center', 'right'] as const).map((p) => (
                  <button key={p} onClick={() => setWatermark({ position: p })}
                    className={`py-1.5 rounded text-xs border transition-colors ${(watermark.position ?? 'right') === p ? activeBtn : idleBtn}`}
                  >
                    {p === 'left' ? '←' : p === 'center' ? '↔' : '→'}
                  </button>
                ))}
              </div>
              {/* Posición vertical */}
              <div>
                <label className="text-xs text-bone-700 mb-1 block">Vertical: {watermark.y ?? 90}%</label>
                <input type="range" min={0} max={100} value={watermark.y ?? 90}
                  onChange={(e) => setWatermark({ y: Number(e.target.value) })}
                  className="w-full accent-gold-500"
                />
              </div>
              {/* Opacidad (solo texto) */}
              {(watermark.type ?? 'text') === 'text' && (
                <div>
                  <label className="text-xs text-bone-700 mb-1 block">
                    Opacidad: {Math.round((watermark.opacity ?? 0.35) * 100)}%
                  </label>
                  <input type="range" min={5} max={100} value={Math.round((watermark.opacity ?? 0.35) * 100)}
                    onChange={(e) => setWatermark({ opacity: Number(e.target.value) / 100 })}
                    className="w-full accent-gold-500"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </section>

    </div>
  )
}
