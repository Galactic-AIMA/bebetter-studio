import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import { syncWithGalleryDl } from '../services/galleryDlService'
import { syncBoardImages, listUserBoards } from '../services/pinterestService'

const router = Router()

const SYNC_DATA_PATH = path.join(__dirname, '../../../data/pinterest-sync.json')

interface SyncEntry {
  timestamp: string
  newImages: number
  totalChecked: number
  status: 'success' | 'error'
  error?: string
}

function loadLastSync(): SyncEntry | null {
  if (!fs.existsSync(SYNC_DATA_PATH)) return null
  try {
    const data = JSON.parse(fs.readFileSync(SYNC_DATA_PATH, 'utf-8'))
    return data.lastSync ?? null
  } catch { return null }
}

function saveLastSync(entry: SyncEntry) {
  const existing = fs.existsSync(SYNC_DATA_PATH)
    ? (() => { try { return JSON.parse(fs.readFileSync(SYNC_DATA_PATH, 'utf-8')) } catch { return {} } })()
    : {}
  fs.writeFileSync(SYNC_DATA_PATH, JSON.stringify({ ...existing, lastSync: entry }, null, 2))
}

router.get('/status', (_req, res) => {
  res.json({
    galleryDlConfigured: !!config.galleryDl.boardUrl,
    pinterestApiConfigured: !!(config.pinterest.appId && config.pinterest.boardId),
    lastSync: loadLastSync(),
  })
})

router.get('/boards', async (_req, res) => {
  try {
    const boards = await listUserBoards()
    res.json(boards)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Sync via gallery-dl (método actual)
router.post('/sync', async (_req, res) => {
  try {
    const result = await syncWithGalleryDl()
    saveLastSync({ ...result, timestamp: new Date().toISOString() })
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Sync via Pinterest API oficial
router.post('/sync/api', async (_req, res) => {
  try {
    const result = await syncBoardImages()
    saveLastSync({ ...result, timestamp: new Date().toISOString() })
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
