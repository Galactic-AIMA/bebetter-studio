import { Router } from 'express'
import { collectInsights, pieceStats, summaryByDimension, MIN_N } from '../services/insightsService'
import { logError } from '../services/logService'

const router = Router()

// POST /api/analytics/collect — recoge un snapshot de insights ahora mismo.
// `?recent=1` limita a los últimos 90 días (lo que la API mantiene vivo).
router.post('/collect', async (req, res) => {
  try {
    const result = await collectInsights(req.query.recent === '1')
    res.json(result)
  } catch (err: any) {
    logError('insights', 'Error recogiendo insights', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/analytics/pieces — ranking de publicaciones con su receta y métricas.
router.get('/pieces', (_req, res) => {
  try {
    res.json(pieceStats())
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/analytics/summary — agregados por dimensión de receta.
// `minN` se devuelve para que el cliente sepa a partir de cuándo un grupo es
// mirable: con menos piezas la diferencia entre grupos es ruido, no señal.
router.get('/summary', (_req, res) => {
  try {
    res.json({ minN: MIN_N, dimensions: summaryByDimension() })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
