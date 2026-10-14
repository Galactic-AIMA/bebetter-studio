import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { wrapTextServer } from '../text/fontMeasure'

/**
 * Verificación de la Fase 0.1: ¿las líneas que calcula el SERVIDOR midiendo el
 * TTF salen idénticas a las que calcula el NAVEGADOR con `canvas.measureText`?
 *
 * El navegador es la única referencia que existe: es lo que David ve en el
 * preview y lo que ha decidido cada frase del banco. Si el servidor corta
 * distinto, el bot sacaría reels con la división por tiempos movida —y en
 * silencio, que es lo que hace grave el fallo.
 *
 * `client/wrap-baseline.html` mide en el navegador y postea aquí. Esta ruta
 * recalcula con el TTF, compara línea a línea, y guarda la base para que
 * `scripts/comparar-wrap.ts` pueda repetir la comparación sin navegador.
 *
 * ⚠️ SOLO desarrollo: se monta desde `index.ts` con NODE_ENV != production.
 */

const router = Router()

export const BASELINE_FILE = path.join(__dirname, '../../scripts/wrap-baseline-navegador.json')

export interface CasoWrap {
  id: string
  text: string
  font: string
  fontSize: number
  maxWidth: number
  resolutionWidth: number
  /** Líneas medidas en el navegador. */
  lines: string[]
}

export interface DiffWrap {
  id: string
  text: string
  navegador: string[]
  servidor: string[]
}

/** Compara los casos del navegador contra el wrap del servidor. */
export function compararCasos(casos: CasoWrap[]): { total: number; iguales: number; diffs: DiffWrap[] } {
  const diffs: DiffWrap[] = []
  for (const c of casos) {
    const servidor = wrapTextServer({
      text: c.text,
      font: c.font,
      fontSize: c.fontSize,
      maxWidth: c.maxWidth,
      resolutionWidth: c.resolutionWidth,
    })
    const iguales = servidor.length === c.lines.length && servidor.every((l, i) => l === c.lines[i])
    if (!iguales) diffs.push({ id: c.id, text: c.text, navegador: c.lines, servidor })
  }
  return { total: casos.length, iguales: casos.length - diffs.length, diffs }
}

// POST /api/dev/wrap-check — body: { casos: CasoWrap[], append?: boolean }
//
// Va por tandas porque `express.json()` corta el cuerpo en 100 KB y el banco
// entero por los seis presets son ~700 casos. La primera tanda estrena archivo;
// las siguientes van con `append` y se acumulan.
router.post('/wrap-check', (req, res) => {
  const casos = (req.body?.casos ?? []) as CasoWrap[]
  const append = req.body?.append === true
  if (!Array.isArray(casos) || casos.length === 0) {
    return res.status(400).json({ error: 'Faltan casos' })
  }
  const resultado = compararCasos(casos)

  let acumulado = casos
  if (append && fs.existsSync(BASELINE_FILE)) {
    const previo = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')) as { casos: CasoWrap[] }
    const porId = new Map(previo.casos.map((c) => [c.id, c]))
    for (const c of casos) porId.set(c.id, c)
    acumulado = [...porId.values()]
  }

  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true })
  fs.writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ generado: new Date().toISOString(), casos: acumulado }, null, 2),
    'utf-8'
  )
  res.json({ ...resultado, guardados: acumulado.length, baseline: BASELINE_FILE })
})

export default router
