import React from 'react'
import { useVideoStore } from '../../store/videoStore'
import { TransitionType, TextAlign, WatermarkPosition, TextEffect, VisualStyle } from '../../types'
import { PRESETS } from '../../presets'

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
  { value: 'fade', label: 'Fade suave' },
  { value: 'none', label: 'Sin transición' },
]

const WATERMARK_POSITIONS: { value: WatermarkPosition; label: string }[] = [
  { value: 'topLeft',     label: '↖ Sup. izq.' },
  { value: 'topRight',    label: '↗ Sup. der.' },
  { value: 'bottomLeft',  label: '↙ Inf. izq.' },
  { value: 'bottomRight', label: '↘ Inf. der.' },
]

const TEXT_EFFECTS: { value: TextEffect; label: string }[] = [
  { value: 'none',      label: 'Sin efecto' },
  { value: 'fadeIn',    label: 'Fade in' },
  { value: 'slideUp',   label: 'Deslizar arriba' },
  { value: 'glowPulse', label: 'Glow pulse' },
]

export default function VideoEditor() {
  const { config, setText, setConfig, setWatermark, setTextEffect, applyPreset } = useVideoStore()
  const { text, duration, transition, transitionDuration, watermark, textEffect, visualStyle } = config

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* Estilo visual */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Estilo visual
        </h3>
        <div className="grid grid-cols-3 gap-1.5">
          {VISUAL_STYLES.map(([key, preset]) => (
            <button
              key={key}
              onClick={() => applyPreset(key as VisualStyle)}
              className={`py-1.5 rounded text-xs border transition-colors ${
                visualStyle === key
                  ? 'bg-brand-500 border-brand-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      {/* Texto */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Frase
        </h3>
        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-brand-500"
          rows={3}
          value={text.content}
          onChange={(e) => setText({ content: e.target.value })}
          placeholder="Escribe tu frase..."
        />
      </section>

      {/* Tipografía */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Tipografía
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Fuente</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm text-white"
              value={text.font}
              onChange={(e) => setText({ font: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f.replace(/-/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Tamaño: {text.fontSize}px
            </label>
            <input
              type="range"
              min={24}
              max={120}
              value={text.fontSize}
              onChange={(e) => setText({ fontSize: Number(e.target.value) })}
              className="w-full accent-brand-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Color</label>
            <input
              type="color"
              value={text.color}
              onChange={(e) => setText({ color: e.target.value })}
              className="w-full h-9 rounded-lg bg-gray-800 border border-gray-700 cursor-pointer"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Alineación</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setText({ align: a })}
                  className={`flex-1 py-1 rounded text-xs border transition-colors ${
                    text.align === a
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                  }`}
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
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Posición del texto
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Horizontal: {text.position.x}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={text.position.x}
              onChange={(e) =>
                setText({ position: { ...text.position, x: Number(e.target.value) } })
              }
              className="w-full accent-brand-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Vertical: {text.position.y}%
            </label>
            <input
              type="range"
              min={5}
              max={95}
              value={text.position.y}
              onChange={(e) =>
                setText({ position: { ...text.position, y: Number(e.target.value) } })
              }
              className="w-full accent-brand-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Ancho máx: {text.maxWidth}%
            </label>
            <input
              type="range"
              min={30}
              max={95}
              value={text.maxWidth}
              onChange={(e) => setText({ maxWidth: Number(e.target.value) })}
              className="w-full accent-brand-500"
            />
          </div>
          <div className="flex items-center gap-2 pt-4">
            <input
              type="checkbox"
              id="shadow"
              checked={text.shadow}
              onChange={(e) => setText({ shadow: e.target.checked })}
              className="accent-brand-500"
            />
            <label htmlFor="shadow" className="text-sm text-gray-300">
              Sombra
            </label>
          </div>
        </div>
      </section>

      {/* Video */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Video
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Duración: {duration}s
            </label>
            <input
              type="range"
              min={5}
              max={30}
              value={duration}
              onChange={(e) => setConfig({ duration: Number(e.target.value) })}
              className="w-full accent-brand-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Transición</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm text-white"
              value={transition}
              onChange={(e) =>
                setConfig({ transition: e.target.value as TransitionType })
              }
            >
              {TRANSITIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {transition !== 'none' && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Duración transición: {transitionDuration}s
              </label>
              <input
                type="range"
                min={0.3}
                max={2}
                step={0.1}
                value={transitionDuration}
                onChange={(e) =>
                  setConfig({ transitionDuration: Number(e.target.value) })
                }
                className="w-full accent-brand-500"
              />
            </div>
          )}
          <div className="col-span-2">
            <label className="text-xs text-gray-400 mb-1 block">Efecto de texto</label>
            <div className="grid grid-cols-2 gap-1">
              {TEXT_EFFECTS.map((ef) => (
                <button
                  key={ef.value}
                  onClick={() => setTextEffect(ef.value)}
                  className={`py-1.5 rounded text-xs border transition-colors ${
                    textEffect === ef.value
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {ef.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      {/* Watermark */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Marca de agua
        </h3>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="wm-enabled"
              checked={watermark?.enabled ?? false}
              onChange={(e) => setWatermark({ enabled: e.target.checked })}
              className="accent-brand-500"
            />
            <label htmlFor="wm-enabled" className="text-sm text-gray-300">
              Activar watermark bebetter
            </label>
          </div>
          {watermark?.enabled && (
            <div className="grid grid-cols-2 gap-1">
              {WATERMARK_POSITIONS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setWatermark({ position: p.value })}
                  className={`py-1.5 rounded text-xs border transition-colors ${
                    watermark.position === p.value
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
