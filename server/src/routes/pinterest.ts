import { Router } from 'express'
import { config } from '../config'
import { syncWithGalleryDl } from '../services/galleryDlService'
import { syncBoardImages, listUserBoards } from '../services/pinterestService'
import db from '../db'

const router = Router()

router.get('/status', (_req, res) => {
  const lastSyncRow = db.prepare(
    `SELECT * FROM pinterest_sync_log ORDER BY id DESC LIMIT 1`
  ).get() as any

  const lastSync = lastSyncRow
    ? {
        timestamp:     lastSyncRow.timestamp,
        newImages:     lastSyncRow.new_images,
        totalChecked:  lastSyncRow.total_checked,
        status:        lastSyncRow.status,
        error:         lastSyncRow.error ?? undefined,
      }
    : null

  res.json({
    galleryDlConfigured:    !!config.galleryDl.boardUrl,
    pinterestApiConfigured: !!(config.pinterest.appId && config.pinterest.boardId),
    lastSync,
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

function saveSyncLog(entry: { newImages: number; totalChecked: number; status: string; error?: string }) {
  db.prepare(`
    INSERT INTO pinterest_sync_log (timestamp, new_images, total_checked, status, error)
    VALUES (@timestamp, @new_images, @total_checked, @status, @error)
  `).run({
    timestamp:     new Date().toISOString(),
    new_images:    entry.newImages,
    total_checked: entry.totalChecked,
    status:        entry.status,
    error:         entry.error ?? null,
  })
}

// Sync via gallery-dl (método actual)
router.post('/sync', async (_req, res) => {
  try {
    const result = await syncWithGalleryDl()
    saveSyncLog(result)
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Sync via Pinterest API oficial
router.post('/sync/api', async (_req, res) => {
  try {
    const result = await syncBoardImages()
    saveSyncLog(result)
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
