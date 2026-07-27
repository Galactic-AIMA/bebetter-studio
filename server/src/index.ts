import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import cron from 'node-cron'
import { config } from './config'
import videosRouter from './routes/videos'
import imagesRouter from './routes/images'
import phrasesRouter from './routes/phrases'
import uploadRouter from './routes/upload'
import pinterestRouter from './routes/pinterest'
import imagesOutputRouter from './routes/imagesOutput'
import historyRouter from './routes/history'
import imageTagsRouter from './routes/imageTags'
import audioRouter from './routes/audio'
import logsRouter from './routes/logs'
import cadenceRouter from './routes/cadence'
import batchRouter from './routes/batch'
import aiImagesRouter from './routes/aiImages'
import carouselsRouter from './routes/carousels'
import analyticsRouter from './routes/analytics'
import { collectInsights } from './services/insightsService'
import { syncBoardImages } from './services/pinterestService'
import { runCleanup } from './services/cleanupService'
import { logInfo } from './services/logService'

const app = express()

app.use(cors({ origin: config.clientUrl }))
app.use(express.json())

// Servir videos generados como archivos estáticos (URL pública directa para n8n/Meta)
app.use('/output', express.static(path.resolve(config.paths.output)))

app.use('/api/videos', videosRouter)
app.use('/api/images', imagesRouter)
app.use('/api/phrases', phrasesRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/pinterest', pinterestRouter)
app.use('/api/images-output', imagesOutputRouter)
app.use('/api/history', historyRouter)
app.use('/api/images', imageTagsRouter)
app.use('/api/audio', audioRouter)
app.use('/api/logs', logsRouter)
app.use('/api/cadence', cadenceRouter)
app.use('/api/batch', batchRouter)
app.use('/api/ai-images', aiImagesRouter)
app.use('/api/carousels', carouselsRouter)
app.use('/api/analytics', analyticsRouter)

app.get('/api/watermark', (req, res) => {
  const wmPath = config.watermark.path
  if (!wmPath || !fs.existsSync(wmPath)) return res.status(404).json({ error: 'Watermark not configured' })
  res.sendFile(path.resolve(wmPath))
})

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.listen(config.port, () => {
  logInfo('system', `Servidor iniciado en http://localhost:${config.port}`)
  console.log(`Server running on http://localhost:${config.port}`)
  console.log(`Output folder: ${config.paths.output}`)
  console.log(`Images folder: ${config.paths.images}`)

  cron.schedule('0 */6 * * *', () => { runCleanup() })
  console.log('Cleanup: activo (cada 6 horas, archivos >24h)')

  // Snapshot diario de insights. De madrugada porque no compite con nada y la
  // granularidad de la serie es el día. Best-effort: si el token o la red fallan,
  // se pierde un punto de la serie, no la app.
  cron.schedule('30 4 * * *', async () => {
    try {
      const r = await collectInsights(true)
      console.log(`Insights: snapshot de ${r.ok}/${r.total} publicaciones`)
    } catch (err: any) {
      console.error('Insights: fallo al recoger —', err.message)
    }
  })
  console.log('Insights: activo (snapshot diario 4:30)')

  // gallery-dl retirado (2026-07-26): duplicaba imágenes que la Pinterest API ya
  // baja. La sincronización queda solo por la Pinterest API v5 (abajo).
  if (config.pinterest.appId && config.pinterest.boardId) {
    console.log('Pinterest API: sincronizando al arranque...')
    syncBoardImages().then((r) => {
      console.log(`Pinterest API sync: ${r.newImages} nuevas imágenes de ${r.totalChecked} pines`)
    }).catch((err) => {
      console.error('Pinterest API sync (arranque) error:', err.message)
    })
  }
})
