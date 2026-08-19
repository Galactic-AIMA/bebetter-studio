import { Library, Eye, SlidersHorizontal } from 'lucide-react'

export type Seccion = 'banco' | 'vista' | 'ajustes'

interface Props {
  seccion: Seccion
  onSeccion: (s: Seccion) => void
}

const SECCIONES: { id: Seccion; icon: typeof Eye; label: string }[] = [
  { id: 'banco',   icon: Library,          label: 'Banco'  },
  { id: 'vista',   icon: Eye,              label: 'Vista'  },
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
    <nav className="lg:hidden shrink-0 flex bg-carbon-700 border-t border-carbon-600 pb-[env(safe-area-inset-bottom)]">
      {SECCIONES.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onSeccion(id)}
          // h-14: objetivo táctil cómodo. Los iconos de 13 px del escritorio se
          // pulsan con ratón; con el pulgar hacen falta ~44 px de alto real.
          className={`flex-1 h-14 flex flex-col items-center justify-center gap-1 text-[10px] transition-colors ${
            seccion === id
              ? 'text-bone-500 border-t-2 border-neon-red -mt-px'
              : 'text-bone-700 border-t-2 border-transparent -mt-px hover:text-bone-500'
          }`}
        >
          <Icon size={17} />
          <span className="font-medium tracking-wide">{label}</span>
        </button>
      ))}
    </nav>
  )
}
