import { Books, Eye, SlidersHorizontal, type Icon } from '@phosphor-icons/react'

export type Seccion = 'banco' | 'vista' | 'ajustes'

interface Props {
  seccion: Seccion
  onSeccion: (s: Seccion) => void
}

const SECCIONES: { id: Seccion; icon: Icon; label: string }[] = [
  { id: 'banco', icon: Books, label: 'Banco' },
  { id: 'vista', icon: Eye, label: 'Vista' },
  { id: 'ajustes', icon: SlidersHorizontal, label: 'Ajustes' },
]

/**
 * La navegación de móvil — Fase 7 (2026-08-19).
 *
 * En escritorio los tres paneles (banco · vista · ajustes) se ven a la vez y esta
 * barra no existe. Por debajo de `lg` no caben —el banco pide 320 px, los ajustes
 * 300, y el preview 9:16 se queda sin sitio en cuanto la ventana baja de ~620 px—
 * así que se muestra UNO cada vez y esta barra elige cuál.
 *
 * Los tres siguen MONTADOS, solo ocultos con `hidden`: el banco carga imágenes y
 * frases al montarse y el editor guarda estado local, así que desmontarlos al
 * cambiar de pestaña recargaría el banco entero y perdería lo que estuvieras
 * ajustando. Ocultar cuesta memoria; desmontar cuesta el trabajo.
 *
 * `pb-[env(safe-area-inset-bottom)]` por la barra de gestos del móvil: sin eso, el
 * sistema se come la fila de botones en iPhone y Android con navegación por gestos.
 */
export default function BottomNav({ seccion, onSeccion }: Props) {
  return (
    <nav aria-label="Secciones" className="flex shrink-0 border-t border-linea bg-s1 pb-[env(safe-area-inset-bottom)] lg:hidden">
      {SECCIONES.map(({ id, icon: Icono, label }) => (
        <button
          key={id}
          onClick={() => onSeccion(id)}
          aria-current={seccion === id ? 'page' : undefined}
          // h-14: objetivo táctil cómodo para el pulgar (~44 px de alto real).
          className={`flex h-14 flex-1 flex-col items-center justify-center gap-1 transition-colors duration-rapido ease-mesa ${
            seccion === id ? 'text-hueso' : 'text-hueso-2 hover:text-hueso'
          }`}
        >
          <Icono size={20} className={seccion === id ? 'text-oro' : ''} weight={seccion === id ? 'fill' : 'regular'} />
          <span className="font-cond text-label font-medium uppercase">{label}</span>
        </button>
      ))}
    </nav>
  )
}
