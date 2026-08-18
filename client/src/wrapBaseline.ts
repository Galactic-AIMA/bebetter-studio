import './index.css'
import { wrapText } from './lib/wrapText'
import { fontToCSS } from './config/fonts'
import { PRESETS } from './presets'
import { VisualStyle } from './types'

/**
 * Página de verificación de la Fase 0.1 — SOLO desarrollo.
 *
 * Abrirla en `http://localhost:5173/wrap-baseline.html` con el servidor
 * levantado. Mide el wrap de todo el banco de frases en el navegador (que es la
 * referencia: es lo que ve el preview) y lo postea a `/api/dev/wrap-check`, que
 * recalcula midiendo el TTF y devuelve las diferencias.
 *
 * No entra en el build: Vite solo empaqueta `index.html`. Existe para poder
 * responder con datos —y no de palabra— a "¿corta igual el servidor?".
 */

const ANCHO = 1080
const raiz = document.getElementById('root')!

interface Phrase { id: string; text: string; usageCount: number }

async function esperarFuentes(estilos: VisualStyle[]) {
  // Sin esto, `measureText` mide con la fuente de reserva y la comparación no
  // valdría nada: el navegador estaría midiendo una tipografía que no es la suya.
  await Promise.all(estilos.map((e) => {
    const p = PRESETS[e]
    return document.fonts.load(fontToCSS(p.font, p.fontSize))
  }))
  await document.fonts.ready
}

function pinta(html: string) { raiz.innerHTML = html }

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function ejecutar(estilos: VisualStyle[]) {
  pinta('<p style="font-family:monospace">Cargando frases…</p>')
  const frases: Phrase[] = await (await fetch('/api/phrases')).json()
  await esperarFuentes(estilos)

  const casos = estilos.flatMap((estilo) => {
    const p = PRESETS[estilo]
    return frases.map((f) => ({
      id: `${estilo}:${f.id}`,
      text: f.text,
      font: p.font,
      fontSize: p.fontSize,
      maxWidth: p.maxWidth,
      resolutionWidth: ANCHO,
      lines: wrapText({
        text: f.text,
        font: p.font,
        fontSize: p.fontSize,
        maxWidth: p.maxWidth,
        resolutionWidth: ANCHO,
      }),
    }))
  })

  // Por tandas: `express.json()` corta el cuerpo en 100 KB y el banco entero por
  // los seis presets no cabe de una vez.
  const TANDA = 50
  const res = { total: 0, iguales: 0, diffs: [] as any[], baseline: '' }
  for (let i = 0; i < casos.length; i += TANDA) {
    pinta(`<p style="font-family:monospace">Comparando ${Math.min(i + TANDA, casos.length)}/${casos.length} casos…</p>`)
    const r = await fetch('/api/dev/wrap-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ casos: casos.slice(i, i + TANDA), append: i > 0 }),
    })
    if (!r.ok) {
      pinta(`<p style="font-family:monospace;color:#fca5a5">El servidor respondió ${r.status}: ${esc((await r.text()).slice(0, 300))}</p>`)
      return
    }
    const parcial = await r.json()
    res.total += parcial.total
    res.iguales += parcial.iguales
    res.diffs.push(...parcial.diffs)
    res.baseline = parcial.baseline
  }

  const porPreset = new Map<string, number>()
  for (const d of res.diffs ?? []) {
    const k = d.id.split(':')[0]
    porPreset.set(k, (porPreset.get(k) ?? 0) + 1)
  }

  const resumen = estilos.map((e) =>
    `<li><b>${e}</b> (${PRESETS[e].font} ${PRESETS[e].fontSize}px, ${PRESETS[e].maxWidth}%): ` +
    `${frases.length - (porPreset.get(e) ?? 0)}/${frases.length} idénticas</li>`
  ).join('')

  const diffs = (res.diffs ?? []).map((d: any) => `
    <details style="margin:8px 0;border:1px solid #333;padding:8px">
      <summary>${esc(d.id)} — ${esc(d.text.slice(0, 70))}…</summary>
      <pre style="color:#7dd3fc">navegador: ${esc(JSON.stringify(d.navegador, null, 1))}</pre>
      <pre style="color:#fca5a5">servidor : ${esc(JSON.stringify(d.servidor, null, 1))}</pre>
    </details>`).join('')

  pinta(`
    <div style="font-family:monospace;padding:24px;color:#E8E4DC;background:#0A0A0A;min-height:100vh">
      <h2>Wrap — navegador vs servidor</h2>
      <p><b>${res.iguales}/${res.total}</b> casos idénticos · ${res.diffs.length} diferencias</p>
      <ul>${resumen}</ul>
      <p style="opacity:.7">Base guardada en ${esc(res.baseline ?? '')}</p>
      ${diffs || '<p style="color:#86efac">Sin diferencias.</p>'}
    </div>`)
}

const TODOS = Object.keys(PRESETS) as VisualStyle[]

// `?auto=bebetter` o `?auto=todos` arranca sin clic, para poder lanzarla desde
// un navegador headless y que la verificación no dependa de que alguien mire.
const auto = new URLSearchParams(location.search).get('auto')
if (auto) {
  ejecutar(auto === 'todos' ? TODOS : ['bebetter'])
} else {
  pinta(`
    <div style="font-family:monospace;padding:24px;color:#E8E4DC;background:#0A0A0A;min-height:100vh">
      <h2>Wrap — navegador vs servidor</h2>
      <button id="b1" style="padding:8px 14px;margin-right:8px">Solo preset bebetter</button>
      <button id="b2" style="padding:8px 14px">Los ${TODOS.length} presets</button>
    </div>`)
  document.getElementById('b1')!.addEventListener('click', () => ejecutar(['bebetter']))
  document.getElementById('b2')!.addEventListener('click', () => ejecutar(TODOS))
}
