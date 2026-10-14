/** @type {import('tailwindcss').Config} */

/*
 * Tokens de «Sala de montaje» — la fuente de verdad es DESIGN.md §2-§4 y §7.
 * Los carbones llevan el MISMO tono que el hueso (~80-85° en OKLCH): con grises
 * puros (croma 0) el hueso cálido no casaba con el fondo.
 */
const sala = {
  sala: '#0C0B0A',      // lienzo del escenario y fondo base
  s1: '#121110',        // barra lateral, banco, inspector
  s2: '#1A1815',        // fila seleccionada, tarjeta, popover
  s3: '#24211D',        // hover fuerte, control presionado
  linea: '#24231F',     // separador 1px (no texto)
  'linea-2': '#33312C', // borde de tarjeta y miniatura (no texto)
  'borde-control': '#6B665D', // borde de input/botón secundario, ≥3:1
  hueso: '#E8E4DC',     // texto principal, 13.9-15.5:1
  'hueso-2': '#A8A39A', // texto secundario, 6.4-7.8:1
  'hueso-3': '#8A857C', // metadatos; solo sobre sala/s1/s2, 4.8-5.1:1
  oro: '#C5A059',       // LUZ: activo, foco, «en pantalla», contador. Hex de marca
  sangre: '#8B1A1A',    // SOLO relleno de Generar (hueso encima 7.3:1). Nunca texto sobre carbón
  'sangre-hover': '#A52222',
  lacre: '#E2655B',     // error, destructivo y el giro. Mismo tono (27°) que sangre, con luz
  velo: 'rgb(12 11 10 / .72)',
}

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: sala,
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        cond: ['"IBM Plex Sans Condensed"', '"IBM Plex Sans"', 'sans-serif'],
        display: ['Anton', 'Impact', 'sans-serif'],
      },
      // [tamaño, interlineado]. Mínimo 11px, y solo en `label`.
      fontSize: {
        label: ['11px', { lineHeight: '1', letterSpacing: '.2em' }],
        meta: ['12px', '1.4'],
        ui: ['13px', '1.45'],
        body: ['14px', '1.5'],
        lead: ['16px', '1.5'],
        title: ['26px', { lineHeight: '1.1', letterSpacing: '-.01em' }],
        display: ['40px', '0.98'],
      },
      borderRadius: {
        control: '6px',
        panel: '10px',
        preview: '14px',
      },
      transitionDuration: {
        rapido: '120ms',
        base: '200ms',
        panel: '320ms',
        sala: '900ms',
      },
      transitionTimingFunction: {
        mesa: 'cubic-bezier(.2,.8,.2,1)',
        sala: 'cubic-bezier(.22,.8,.2,1)',
      },
    },
  },
  plugins: [],
}
