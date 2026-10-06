import React, { useId } from 'react'

/* Controles de la MESA (DESIGN.md §6), compartidos por inspector y lotes.
   Lo elegido se marca con LUZ (fondo s2 + borde oro), nunca con lacre: el lacre
   significa error o giro (DESIGN.md §2). */

/** Grupo de opciones excluyentes. */
export function Segmentos<T extends string>({
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
              className={`flex h-10 items-center justify-center rounded-control border px-1.5 lg:h-8 text-ui transition-colors duration-rapido ease-mesa disabled:cursor-not-allowed disabled:opacity-30 ${
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
export function Rango({
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

/** Interruptor 34×20: apagado s3, encendido oro al 28 % con perilla oro. */
export function Interruptor({
  label, checked, onChange, disabled, title, children,
}: {
  label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void
  disabled?: boolean; title?: string; children?: React.ReactNode
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        title={title}
        onClick={() => onChange(!checked)}
        className="flex items-center gap-2.5 text-ui text-hueso disabled:cursor-not-allowed disabled:opacity-40"
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

/** Etiqueta encima de un control. */
export function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-ui text-hueso-3">{label}</span>
      {children}
    </label>
  )
}

/** Progreso determinado. scaleX y no width: solo se animan transform y opacity. */
export function Progreso({ actual, total, label }: { actual: number; total: number; label?: string }) {
  const f = total > 0 ? Math.min(1, actual / total) : 0
  return (
    <div
      className="h-0.5 w-full overflow-hidden rounded-full bg-s3"
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={actual}
    >
      <div className="h-full origin-left bg-oro transition-transform duration-base ease-mesa" style={{ transform: `scaleX(${f})` }} />
    </div>
  )
}
