import { Router } from 'express'
import { planBatch, BatchDriver } from '../services/batchPlanner'

const router = Router()

// POST /api/batch/plan  { driver: 'phrases'|'images', count: number, allowRepeat?: boolean }
router.post('/plan', (req, res) => {
  const driver = req.body?.driver as BatchDriver
  const count = Math.max(1, Math.min(parseInt(req.body?.count) || 0, 50))
  const allowRepeat = req.body?.allowRepeat === true
  if (driver !== 'phrases' && driver !== 'images') {
    return res.status(400).json({ error: "driver debe ser 'phrases' o 'images'" })
  }
  try {
    const pairs = planBatch(driver, count, allowRepeat)
    res.json({ pairs, requested: count, produced: pairs.length })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
