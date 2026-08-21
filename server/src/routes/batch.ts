import { Router } from 'express'
import { planBatch, BatchDriver } from '../services/batchPlanner'
import { lanzarLote, verTrabajo, trabajosRecientes } from '../services/batchRunner'
import { PRESETS } from '../text/presets'

const router = Router()

// POST /api/batch/plan  { driver: 'phrases'|'images', count: number, allowRepeat?: boolean }
router.post('/plan', async (req, res) => {
  const driver = req.body?.driver as BatchDriver
  const count = Math.max(1, Math.min(parseInt(req.body?.count) || 0, 50))
  const allowRepeat = req.body?.allowRepeat === true
  if (driver !== 'phrases' && driver !== 'images') {
    return res.status(400).json({ error: "driver debe ser 'phrases' o 'images'" })
  }
  try {
    const pairs = await planBatch(driver, count, allowRepeat)
    res.json({ pairs, requested: count, produced: pairs.length })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/batch/run  { count, driver?, allowRepeat?, estilo?, duracion?, resolucion? }
//
// Genera el lote ENTERO en el servidor, sin navegador. Devuelve al momento el
// trabajo con su id y el TOPE REAL (`planificadas`): si se piden más frases en
// norma de las que hay, no inventa — planifica las que puede y lo dice.
//
// Las piezas nacen en `pendiente_revision`: no gastan frase ni copies hasta que
// alguien las apruebe. Ver `services/batchRunner.ts`.
router.post('/run', async (req, res) => {
  const count = Math.max(1, Math.min(parseInt(req.body?.count) || 0, 50))
  const driver = (req.body?.driver ?? 'phrases') as BatchDriver
  if (driver !== 'phrases' && driver !== 'images') {
    return res.status(400).json({ error: "driver debe ser 'phrases' o 'images'" })
  }
  const estilo = req.body?.estilo
  if (estilo && !(estilo in PRESETS)) {
    return res.status(400).json({ error: `estilo desconocido: ${estilo}` })
  }
  try {
    const trabajo = await lanzarLote({
      count,
      driver,
      allowRepeat: req.body?.allowRepeat === true,
      estilo,
      duracion: req.body?.duracion,
      resolucion: req.body?.resolucion,
      // De dónde salió la petición. Una máquina se identifica sola: si entró con
      // el token de servicio no hay una persona delante mirando la barra, y ese
      // es justo el caso que necesita los avisos.
      origen: typeof req.body?.origen === 'string'
        ? req.body.origen.slice(0, 24)
        : (req.identidad?.tipo === 'maquina' ? 'maquina' : 'app'),
    })
    res.status(202).json(trabajo)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/batch/run/:id — progreso del lote (el render va en segundo plano)
router.get('/run/:id', (req, res) => {
  const trabajo = verTrabajo(req.params.id)
  if (!trabajo) return res.status(404).json({ error: 'Trabajo no encontrado' })
  res.json(trabajo)
})

// GET /api/batch/runs — los últimos lotes lanzados
router.get('/runs', (_req, res) => res.json(trabajosRecientes()))

export default router
