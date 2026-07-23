import { Router } from 'express'
import { getLogs, clearLogs, LogLevel, LogCategory } from '../services/logService'

const router = Router()

// GET /api/logs?limit=200&level=error&category=publish
router.get('/', (req, res) => {
  const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined
  const level = req.query.level ? (String(req.query.level) as LogLevel) : undefined
  const category = req.query.category ? (String(req.query.category) as LogCategory) : undefined
  res.json(getLogs({ limit, level, category }))
})

// DELETE /api/logs — limpiar el historial de logs
router.delete('/', (_req, res) => {
  clearLogs()
  res.json({ success: true })
})

export default router
