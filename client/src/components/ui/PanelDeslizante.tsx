import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'

/** Duración de `t-panel` (DESIGN.md §7). La salida espera a que termine. */
const T_PANEL = 320

/**
 * Panel deslizante de la sala (DESIGN.md §6): 420 px, `s1`, radio 10 en las
 * esquinas interiores y `velo` detrás. Entra desde la derecha y sale por el mismo
 * lado en `t-panel`; Esc, el velo y la X lo cierran, y el foco vuelve a quien lo
 * abrió.
 *
 * Sustituye a los modales centrados de Registro, Cadencia y Audio: son consultas
 * laterales, no interrupciones, y así el escenario sigue a la vista detrás.
 */
export default function PanelDeslizante({
  titulo, meta, acciones, pie, onClose, children,
}: {
  titulo: string
  /** Dato corto junto al título (contadores en Mono). */
  meta?: React.ReactNode
  /** Botones de la cabecera, antes de la X. */
  acciones?: React.ReactNode
  /** Barra fija abajo (p. ej. Guardar). */
  pie?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  const cerrando = useRef(false)
  const cerrarRef = useRef<HTMLButtonElement>(null)
  const idTitulo = useId()

  // Entra en el fotograma siguiente al montaje, para que la transición tenga un
  // «antes». El foco va a la X y, al desmontar, vuelve a quien abrió el panel.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    const r = requestAnimationFrame(() => setAbierto(true))
    cerrarRef.current?.focus({ preventScroll: true })
    return () => { cancelAnimationFrame(r); previo?.focus?.({ preventScroll: true }) }
  }, [])

  const cerrar = useCallback(() => {
    if (cerrando.current) return
    cerrando.current = true
    setAbierto(false)
    const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches
    setTimeout(onClose, reducido ? 0 : T_PANEL)
  }, [onClose])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cerrar() } }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [cerrar])

  return (
    <div className="fixed inset-0 z-40">
      <div
        aria-hidden
        onClick={cerrar}
        className={`absolute inset-0 bg-velo transition-opacity duration-panel ease-sala ${abierto ? 'opacity-100' : 'opacity-0'}`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className={`absolute inset-y-0 right-0 flex w-[420px] max-w-full flex-col border-l border-linea bg-s1 shadow-[0_0_80px_-20px_rgb(0_0_0/.9)] transition-transform duration-panel ease-sala sm:rounded-l-panel ${
          abierto ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-linea py-3 pl-5 pr-3">
          <h2 id={idTitulo} className="min-w-0 truncate text-[20px] font-light leading-tight tracking-[-.01em] text-hueso">{titulo}</h2>
          {meta}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {acciones}
            <button
              ref={cerrarRef}
              onClick={cerrar}
              aria-label="Cerrar el panel"
              className="grid h-10 w-10 place-items-center rounded-control text-hueso-2 transition-colors duration-rapido ease-mesa hover:bg-s2 hover:text-hueso lg:h-8 lg:w-8"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {pie && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-linea px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {pie}
          </footer>
        )}
      </aside>
    </div>
  )
}
