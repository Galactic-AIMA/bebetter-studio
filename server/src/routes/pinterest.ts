import { Router } from 'express'
import { syncBoardImages, getSyncStatus, listUserBoards } from '../services/pinterestService'

const router = Router()

router.get('/status', (_req, res) => {
  const status = getSyncStatus()
  res.json(status)
})

router.get('/boards', async (_req, res) => {
  try {
    const boards = await listUserBoards()
    res.json(boards)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/sync', async (_req, res) => {
  try {
    const result = await syncBoardImages()
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
